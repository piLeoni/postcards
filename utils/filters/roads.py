import shapely
import geopandas as gpd
from utils.ops import geometry_to_linestrings
from utils.gdf_ops import gdf_polygons_to_lines, gdf_remove_points, gdf_remove_below_ground, gdf_to_all_linestrings
import pandas as pd  # Make sure pandas is imported
import re
from collections import defaultdict

from geopy.geocoders import Nominatim

def get_country_from_coordinates(lon, lat):
    geolocator = Nominatim(user_agent="test@gmail.com")
    location = geolocator.reverse((lat, lon), exactly_one=True)
    if location and 'country' in location.raw['address']:
        return location.raw['address']['country']
    return None

imperial_countries = ["United States", "Canada", "Liberia", "Myanmar"]

width_index = {
        "motorway": 15,          # Range 15-30m, 25 is a reasonable average
        "motorway_link": 7,     # Range 7-12m, 10 is a reasonable average
        "trunk": 10,             # Range 10-25m, 18 is a reasonable average
        "trunk_link": 6,         # Range 6-10m, 8 is a reasonable average
        "primary": 7,           # Range 7-15m, 12 is a reasonable average
        "primary_link": 6,       # Range 6-10m, 8 is a reasonable average
        "secondary": 6,          # Range 6-12m, 9 is a reasonable average
        "secondary_link": 5,     # Range 5-8m, 7 is a reasonable average
        "tertiary": 5,           # Range 5-10m, 7 is a reasonable average
        "tertiary_link": 5,      # Range 5-7m, 6 is a reasonable average
        "residential": 4,        # Range 4-8m, 6 is a reasonable average
        "living_street": 3,      # Range 3-6m, 4 is a reasonable average
        "service": 3,            # Range 3-6m, 4 is a reasonable average
        "pedestrian": 3,         # Range 3-10m, 5 is a reasonable average
        "footway": 1,          # Range 1-2m, 1.5 is a reasonable average
        "cycleway": 1.5,           # Range 1.5-3m, 2 is a reasonable average
        "bridleway": 2,        # Range 2-3m, 2.5 is a reasonable average
        "path": 1,             # Range 1-2m, 1.5 is a reasonable average
        "steps": 1,              # Roughly 1m
        "unclassified": 4,       # Range 4-8m, 6 is a reasonable average
        "construction": 5,       # Highly variable; assuming average 5m
        "elevator": 1.5,         # Not a road, but minimal width (~1.5m)
    }

def get_local_units_factor(params):
    country = get_country_from_coordinates(*params["center_coords"])
    if country in imperial_countries:
        return 0.3048
    else:
        return 1.0
    

def parse_width(value):
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        value = value.strip()

        # Handle multiple values like "15.2;18.6" — pick the maximum
        if ";" in value:
            parts = value.split(";")
            parsed_parts = [parse_width(part) for part in parts]
            parsed_parts = [p for p in parsed_parts if p is not None]
            if parsed_parts:
                return max(parsed_parts)

        # Handle feet-inches like 8'3"
        match = re.match(r"(\d+)'\s*(\d+)?", value)
        if match:
            feet = int(match.group(1))
            inches = int(match.group(2)) if match.group(2) else 0
            total_feet = feet + (inches / 12)
            return float(total_feet)

        # Try parsing as a simple float
        try:
            return float(value)
        except ValueError:
            pass

    return None

def establish_width(row, local_factor):
    # Try to get the width safely
    width = row.get("width", None)

    if pd.notna(width):
        parsed_width = parse_width(width)
        if parsed_width is not None:
            return parsed_width * local_factor

    # If width is missing, fallback to estimate from lanes
    lanes = row.get("lanes", None)
    if pd.notna(lanes):
        try:
            lanes_count = float(str(lanes).split(";")[0])  # handle cases like "2;3"
            return lanes_count * 3   # assume each lane is 3.5 meters
        except (ValueError, TypeError):
            pass

    # If no width and no lanes, fallback based on highway type
    highway = row.get("highway", None)
    if highway in width_index:
        return width_index[highway] 

    # As last resort, fallback to a default
    return 6 * local_factor  # 6 meters default


def get_layer(row):
    layer = row.get("layer", 0)  # Default to 0 if missing

    if pd.isna(layer):
        return 0

    if isinstance(layer, str):
        try:
            layer = int(layer)
        except ValueError:
            layer = 0

    return layer

def merge_polygons(polygons):
    merged = shapely.ops.unary_union(polygons)
    # If the result is a GeometryCollection, apply unary_union again
    if isinstance(merged, shapely.geometry.GeometryCollection):
        merged = shapely.ops.unary_union([geom for geom in merged])
    # Ensure that the merged result is always a MultiPolygon or Polygon
    if isinstance(merged, (shapely.geometry.Polygon, shapely.geometry.MultiPolygon)):
        return merged
    else:
        # If the result is still not a Polygon or MultiPolygon, return a MultiPolygon of the individual geometries
        return shapely.geometry.MultiPolygon([geom for geom in merged.geoms])

def filter_roads(gdf, params):

    if 'highway' not in gdf.columns:
        print("No 'highway' column found in gdf")
        empty = gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
        return {
            "geometry": lambda: {"outlines": empty,
                                 "details": empty,
                                 "filling": empty,
                                 "mask": empty,
                                 "above_ground_mask": empty,
                                 },
            "raw": empty,
            "projected": empty
        }
    
    
    gdf = gdf[gdf['highway'].notna()] 
    if 'footway' in gdf.columns:
        gdf = gdf[gdf['footway'] != 'crossing']
        gdf = gdf[gdf['footway'] != 'sidewalk']

    

 
    # buildings = gdf[gdf['building'].notna()] 
    gdf = gdf_remove_points(gdf)
    gdf = gdf_remove_below_ground(gdf)


    def geometry():
        
        base = gdf.copy()
        scale_ratio = 1/(int(params["scale"].split(":")[1])/1000) *1.25
        buffered = []
        local_factor = get_local_units_factor(params)
        buffered_layers = defaultdict(list)  # Dictionary: {layer_name: [geometries]}
        end_circles = []
        end_circles_layers = defaultdict(list)  # Dictionary: {layer_name: [geometries]}


        
        for i in range(len(base)): 
            if(base.iloc[i].geometry.geom_type == "LineString") or base.iloc[i].geometry.geom_type == "MultiLineString":
                layer = get_layer(base.iloc[i])
                                
                width = establish_width(base.iloc[i], local_factor)
                end_circles.append(shapely.geometry.Point(base.iloc[i].geometry.coords[0]).buffer(width* scale_ratio))
                end_circles.append(shapely.geometry.Point(base.iloc[i].geometry.coords[-1]).buffer(width* scale_ratio))

                buffered_highway =  base.iloc[i].geometry.buffer(width * scale_ratio)

                buffered.append(buffered_highway)
                buffered_layers[layer].append(buffered_highway) 
                end_circles_layers[layer].append(shapely.geometry.Point(base.iloc[i].geometry.coords[0]).buffer(width* scale_ratio))
                end_circles_layers[layer].append(shapely.geometry.Point(base.iloc[i].geometry.coords[-1]).buffer(width* scale_ratio))
                
            elif (base.iloc[i].geometry.geom_type == "Polygon" or base.iloc[i].geometry.geom_type == "MultiPolygon"):
                buffered.append(base.iloc[i].geometry)


        # try:
        mask = merge_polygons(buffered)
        mask = gpd.GeoDataFrame([mask], columns=['geometry'], crs=gdf.crs)
        outlines = mask.copy().dissolve(by=None, aggfunc='first')


        buffered_layers = {k: buffered_layers[k] for k in sorted(buffered_layers.keys()) if k >= 1}

        end_circles_layers = {k: end_circles_layers[k] for k in sorted(end_circles_layers.keys()) if k >= 1}
        
        for layer, geometries in buffered_layers.items():
            buffered_layers[layer] = merge_polygons(geometries)
        buffered_layers = list(buffered_layers.values())

        for layer, geometries in end_circles_layers.items():
            end_circles_layers[layer] = merge_polygons(geometries)
        end_circles_layers = list(end_circles_layers.values())

        
        for i, layer in enumerate(buffered_layers):
            for n in range(i+1, len(buffered_layers)):
                buffered_layers[i] = buffered_layers[i].difference(buffered_layers[n])
        details = []        
        
        for i, layer in enumerate(buffered_layers):
            temp = shapely.union_all(geometry_to_linestrings(buffered_layers[i])).difference(shapely.union_all(end_circles_layers[i]).buffer(0.005))
            details.extend(geometry_to_linestrings(temp))

        details = gpd.GeoDataFrame(geometry=details,  crs=gdf.crs)
        details = gdf_to_all_linestrings(details ).dissolve(by=None, aggfunc='first')
        
        
        return {"outlines": gdf_polygons_to_lines(outlines), 
                "details": details,  
                "mask": mask,
                }
    
    return {
        "geometry": geometry,
        "raw": gdf,
        "projected": gdf
        } 

