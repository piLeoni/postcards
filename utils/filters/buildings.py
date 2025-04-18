from utils.ops import polygons_to_linestrings,geometry_to_linestrings, flatten
from utils.process_feature_factory import process_feature_factory
from utils.transformer_factory import get_utm_zone
import shapely
from shapely.geometry import MultiPolygon, Polygon
from utils.optimize import order_geometries_tsp, connect_nearby_paths
from utils.clipping_area import clipping_area, clip_by, cut_by
from utils.patterns.lines import lines_pattern
from utils.generate_bounds import generate_bounds
import pprint
import osmnx as ox
from shapely.ops import transform
import pyproj 
import geopandas as gpd

def filter_buildings(params):
    """
    Filters buildings from GeoJSON data.
    
    Args:
        geojson_data (dict): The GeoJSON data containing features.
        
    Returns:
        list: A list of filtered building features.
    """
    
    def get_highest_level(feature):
        """Extracts the highest numeric level from a feature's tags."""
        tags = feature.get('properties', {}).get('tags', {})
        level_str = str(tags.get('level', '0'))  # force to string, just in case

        try:
            # Split on ';' (even if there's no ';', split() still returns ['number'])
            levels = [
                int(lvl.strip()) 
                for lvl in level_str.split(';') 
                if lvl.strip().lstrip('-').isdigit()
            ]
            return max(levels) if levels else 0
        except Exception:
            return 0
        
    def get_highest_layer(feature):
        """Extracts the highest numeric layer from a feature's tags."""
        tags = feature.get('properties', {}).get('tags', {})
        layer_str = str(tags.get('layer', '0'))  # force to string, just in case

        try:
            # Split on ';' (even if there's no ';', split() still returns ['number'])
            layers = [
                int(lvl.strip()) 
                for lvl in layer_str.split(';') 
                if lvl.strip().lstrip('-').isdigit()
            ]
            return max(layers) if layers else 0
        except Exception:
            return 0
        
    print("filter buildings")
    buildings = []
    
    # Process the features into the buildings list
    process_feature = process_feature_factory( params["trasformer"], **params)

    north, south, east, west = generate_bounds(params).values()
    # print(north, south, east, west)
    gdf = ox.features_from_bbox([east, south, west, north], tags={"building": True})      

    utm_crs = get_utm_zone_number(*params["center_coords"])
    projected_gdf = project_and_prepare_gdf(gdf,params["center_coords"] , map_scale=10000, svg_size_mm=(params["width_mm"], params["height_mm"]))
    # projected_gdf = gdf.to_crs(utm_crs)
    # gdf_scaled = projected_gdf.copy().assign(
    #     geometry=gdf.geometry.apply(lambda geom: shapely.affinity.scale(geom, xfact=1, yfact=1, origin='center'))
    # )

    
    print(projected_gdf)


    # zone_number = get_utm_zone(params["center_coords"][0])
    # output_crs = f"+proj=utm +zone={zone_number} +ellps=WGS84 +datum=WGS84 +units=m +no_defs"
    # projected_gdf = ox.projection.project_gdf(gdf, to_crs=output_crs)
    # projected_gdf = gdf.to_crs(CRS.from_proj4(output_crs))
    # projected_gdf['geometry'] = projected_gdf['geometry'].apply(
#     lambda geom: shapely.affinity.scale(geom, xfact=0.0001, yfact=0.0001, origin='center')
# )

    # projected_gdf["geometry"] = projected_gdf["geometry"].apply(    
    #     lambda geom: shapely.affinity.scale(geom, xfact=0.0001, yfact=0.0001, origin='center')
    # )
    # print(projected_gdf["geometry"])
 


   
    # for idx, row in gdf.iterrows():
    #     geom = row.geometry  # Already a Shapely object
    #     if geom.is_valid:
    #         print("Type:", geom.geom_type, row["name"])
            
  


    # for feature in params['geojson_data']['features']:
    #     tags = feature.get('properties', {}).get('tags', {})
    #     if ('building' in tags 
    #         and feature.get('geometry', {}).get('type') != "Point"
    #         and get_highest_level(feature) >= 0 
    #         and get_highest_layer(feature) >= 0 
    #         ):
    #         buildings.append(process_feature(feature))
    
   
    # mask = [g for g in flatten(shapely.union_all(buildings)) if isinstance(g, (Polygon, MultiPolygon))]

    def geometry():
        return projected_gdf
        # contour_lines = flatten([polygons_to_linestrings(g) for g in mask])
        # countour_mask = shapely.union_all([g.buffer(0.02) for g in contour_lines])
        # building_lines = flatten([polygons_to_linestrings(g) for g in buildings])
        # buildings_lines = shapely.MultiLineString(shapely.union_all(building_lines))
        # buildings_details = order_geometries_tsp(connect_nearby_paths(list(buildings_lines.difference(countour_mask).geoms), 0.35))
        # buildings_outlines = order_geometries_tsp(flatten([geometry_to_linestrings(g) for g in mask]))
        # return flatten([buildings_outlines, buildings_details])
    
    # def patterns():
    #     return clip_by(lines_pattern(params, 0.5, 45), mask)

    return {
        # "geometry": flatten([buildings, [polygons_to_linestrings(g) for g in mask] ]),
        # "geometry": flatten([[polygons_to_linestrings(g) for g in mask], buildings_details ]),
        "geometry": geometry,
        # "patterns": patterns,
        # "internal_details": flatten(buildings_details),
        # "outlines": buildings_outlines,
        "mask": projected_gdf
        }  # Ensure that flatten works as expected

def process_buildings(params):
    return []
    # buildings = filter_buildings(params)
    # geometry = buildings["geometry"]()
    # patterns = buildings["patterns"]()
    # return [geometry, patterns]

def get_utm_zone_number(lon, lat):
    # Automatically determine the UTM CRS for the given lat/lon
    utm_crs = pyproj.CRS.from_epsg(32600 + ((int((lon + 180) / 6) % 60) + 1) if lat >= 0 else 32700 + ((int((lon + 180) / 6) % 60) + 1))
    return utm_crs.to_string()


from shapely.affinity import translate, scale as shapely_scale
from pyproj import CRS, Transformer

def project_and_prepare_gdf(gdf, center_coords, map_scale=1000, svg_size_mm=(200, 200)):
    """
    Converts the GeoDataFrame to:
    - Centered on given coordinate (lat, lon)
    - Scaled to match real-world scale (e.g. 1:1000)
    - Positioned to fit inside given SVG dimensions (in mm)

    Returns:
        GeoDataFrame with geometries in final SVG space (mm)
    """
    # --- Step 1: Project to UTM (meters) ---
    lon, lat = center_coords
    utm_zone = int((lon + 180) / 6) + 1
    is_northern = lat >= 0
    epsg_code = 32600 + utm_zone if is_northern else 32700 + utm_zone
    utm_crs = CRS.from_epsg(epsg_code)
    gdf = gdf.to_crs(utm_crs)

    # --- Step 2: Transform center point to UTM ---
    transformer = Transformer.from_crs("EPSG:4326", utm_crs, always_xy=True)
    cx, cy = transformer.transform(lon, lat)

    # --- Step 3: Translate so center is at (0, 0) ---
    gdf = gdf.copy()
    gdf["geometry"] = gdf["geometry"].translate(xoff=-cx, yoff=-cy)

    # --- Step 4: Scale from meters to mm (real-world map scale) ---
    mm_per_meter = 1000 / map_scale
    gdf["geometry"] = gdf["geometry"].apply(
        lambda geom: shapely_scale(geom, xfact=mm_per_meter, yfact=mm_per_meter, origin=(0, 0))
    )

    # --- Step 5: Shift everything so center is at middle of SVG ---
    svg_w_mm, svg_h_mm = svg_size_mm
    gdf["geometry"] = gdf["geometry"].translate(xoff=svg_w_mm / 2, yoff=svg_h_mm / 2)

    return gdf