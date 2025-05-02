import geopandas as gpd
from shapely.geometry.base import BaseGeometry
from shapely.geometry import LineString, MultiLineString, Polygon, MultiPolygon, GeometryCollection
import pandas as pd

def gdf_polygons_to_lines(gdf):
    """
    Convert all Polygon and MultiPolygon geometries in a GeoDataFrame to LineString or MultiLineString.
    Preserves all other attributes.
    """
    # Make a copy to avoid modifying the original
    line_gdf = gdf.copy()
    
    # Function to convert a single geometry to lines
    def to_lines(geom):
        if isinstance(geom, Polygon):
            # Get exterior boundary as LineString
            exterior = LineString(geom.exterior.coords)
            # Get interior boundaries (holes) as LineStrings
            interiors = [LineString(interior.coords) for interior in geom.interiors]
            # Combine exterior and interiors
            if interiors:
                return MultiLineString([exterior] + interiors)
            else:
                return exterior
        elif isinstance(geom, MultiPolygon):
            # Apply the conversion to each polygon in the multipolygon
            lines = []
            for poly in geom.geoms:
                exterior = LineString(poly.exterior.coords)
                interiors = [LineString(interior.coords) for interior in poly.interiors]
                lines.append(exterior)
                lines.extend(interiors)
            return MultiLineString(lines)
        else:
            # If it's already a line or other geometry, return as is
            return geom
    
    # Apply the conversion to each geometry
    line_gdf['geometry'] = line_gdf['geometry'].apply(to_lines)
    
    return line_gdf

def gdf_to_all_linestrings(gdf):
    """
    Converts all suitable geometries in a GeoDataFrame to individual LineString geometries.
    - LineString geometries are kept as is.
    - MultiLineString geometries are exploded into individual LineStrings.
    - Polygon boundaries (exterior and interior) are converted to LineStrings.
    - MultiPolygon boundaries (exterior and interior of each polygon) are converted to LineStrings.
    - Point and other non-linear geometry types are ignored.
    """
    line_list = []
    attributes = []

    for _, row in gdf.iterrows():
        geom = row['geometry']
        attrs = row.drop('geometry').to_dict()

        if isinstance(geom, LineString):
            line_list.append(geom)
            attributes.append(attrs)
        elif isinstance(geom, MultiLineString):
            for line in geom.geoms:
                line_list.append(line)
                attributes.append(attrs.copy())
        elif isinstance(geom, Polygon):
            line_list.append(LineString(geom.exterior.coords))
            attributes.append(attrs.copy())
            for interior in geom.interiors:
                line_list.append(LineString(interior.coords))
                attributes.append(attrs.copy())
        elif isinstance(geom, MultiPolygon):
            for poly in geom.geoms:
                line_list.append(LineString(poly.exterior.coords))
                attributes.append(attrs.copy())
                for interior in poly.interiors:
                    line_list.append(LineString(interior.coords))
                    attributes.append(attrs.copy())
        # Other geometry types (Point, etc.) are implicitly ignored

    if line_list:
        return gpd.GeoDataFrame(attributes, geometry=line_list, crs=gdf.crs)
    else:
        return gpd.GeoDataFrame(geometry=[], crs=gdf.crs)

def gdf_remove_points(gdf):
    gdf = gdf[gdf.geometry.type != "Point"]
    return gdf

def gdf_remove_below_ground(gdf):
    """
    Filters a GeoDataFrame to remove geometries that are likely to represent
    below-ground features based on common attribute names.

    Args:
        gdf (gpd.GeoDataFrame): The input GeoDataFrame.

    Returns:
        gpd.GeoDataFrame: A new GeoDataFrame with potential below-ground
                          features removed.
    """
    # Make a copy to avoid modifying the original
    filtered_gdf = gdf.copy()

    # Keep only non-Point geometries (assuming below-ground are not typically points)
    filtered_gdf = filtered_gdf[filtered_gdf.geometry.type.isin(['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'])]

    # Check for and filter based on common "layer" or level-related columns
    for col in filtered_gdf.columns:
        if "layer" in col.lower() or "level" in col.lower():
            try:
                filtered_gdf[col] = pd.to_numeric(filtered_gdf[col], errors="coerce")
                filtered_gdf = filtered_gdf[~(filtered_gdf[col] < 0)]
            except (ValueError, TypeError):
                # Handle cases where the column might not be numeric
                pass

    # Check for and filter based on a "location" column
    if "location" in filtered_gdf.columns:
        filtered_gdf = filtered_gdf[filtered_gdf["location"].str.lower() != "underground"]

    # You might want to add more generic checks based on other common indicators
    # of below-ground features if you encounter them in your data.

    return filtered_gdf


def flatten_geometry(geom):
    """Recursively flatten GeometryCollections and Multi-geometries."""
    if geom is None:
        return []
    elif isinstance(geom, GeometryCollection):
        geoms = []
        for part in geom.geoms:
            geoms.extend(flatten_geometry(part))  # recurse
        return geoms
    elif geom.geom_type.startswith("Multi"):
        return list(geom.geoms)
    elif isinstance(geom, BaseGeometry):
        return [geom]
    else:
        return []

# Apply to a GeoDataFrame
def fully_flatten_gdf(gdf):
    records = []
    for _, row in gdf.iterrows():
        geometries = flatten_geometry(row.geometry)
        for geom in geometries:
            record = row.drop('geometry').to_dict()
            record['geometry'] = geom
            records.append(record)
    if not records:
        return gpd.GeoDataFrame(geometry=[], crs=gdf.crs)
    return gpd.GeoDataFrame(records, crs=gdf.crs)

