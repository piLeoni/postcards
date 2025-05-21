from shapely.affinity import  scale as shapely_scale
from pyproj import CRS, Transformer
from math import cos, radians
from pyproj import Transformer, Geod

def gdf_projector(gdf, params):
    """
    Converts the GeoDataFrame to:
    - Centered on given coordinate (lat, lon)
    - Scaled to match real-world scale (e.g. 1:1000)
    - Positioned to fit inside given SVG dimensions (in mm)

    Returns:
        GeoDataFrame with geometries in final SVG space (mm)
    """
    # --- Step 1: Project to UTM (meters) ---
    lon, lat = params["center_coords"]
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
    scale_factor = int(params['scale'].split(":")[1])
    mm_per_meter = 1000 / scale_factor
    gdf["geometry"] = gdf["geometry"].apply(
        lambda geom: shapely_scale(geom, xfact=mm_per_meter, yfact=-mm_per_meter, origin=(0, 0))
    )
    
    # --- Step 6: Shift everything so center is at middle of SVG ---
    gdf["geometry"] = gdf["geometry"].translate(xoff=params['width_mm'] / 2, yoff=params['height_mm'] / 2)
    
    if(params['bearing'] != 0):
        # --- Step 7: Rotate to match SVG bearing ---
        # Note: The rotation is clockwise, so we negate the bearing
        gdf["geometry"] = gdf["geometry"].rotate(-params['bearing'], origin=(params['width_mm'] / 2, params['height_mm'] / 2))

    return gdf


def gdf_projector_webmercator(gdf, params):
    """
    Projects GeoDataFrame to Web Mercator, then scales so that mm in SVG
    match true meters on the ground at center point. Suitable for accurate-looking
    vector postcards, aligned with raster tiles.
    """
    # --- Step 1: Project to Web Mercator ---
    gdf = gdf.to_crs("EPSG:3857")

    # --- Step 2: Center coords and transformer ---
    lon, lat = params["center_coords"]
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    cx, cy = transformer.transform(lon, lat)

    # --- Step 3: Translate geometries so center is at (0, 0) ---
    gdf = gdf.copy()
    gdf["geometry"] = gdf["geometry"].translate(xoff=-cx, yoff=-cy)

    # --- Step 4: Estimate real meter length per Web Mercator unit at center ---
    # We'll measure 1 Mercator unit in both X and Y directions and find real-world distances.
    delta = 1  # 1 Mercator unit
    geod = Geod(ellps="WGS84")
    # Project 1 Mercator unit right and up
    lon1, lat1 = transformer.transform(cx, cy, direction="INVERSE")
    lon2, lat2 = transformer.transform(cx + delta, cy, direction="INVERSE")
    lon3, lat3 = transformer.transform(cx, cy + delta, direction="INVERSE")
    # Measure ground distances
    x_meter_dist = geod.line_length([lon1, lon2], [lat1, lat2])
    y_meter_dist = geod.line_length([lon1, lon3], [lat1, lat3])

    # --- Step 5: Apply mm-per-meter scale (real-world) ---
    scale_factor = int(params["scale"].split(":")[1])
    mm_per_meter = 1000 / scale_factor
    x_mm = mm_per_meter * x_meter_dist
    y_mm = mm_per_meter * y_meter_dist

    gdf["geometry"] = gdf["geometry"].apply(
        lambda geom: shapely_scale(geom, xfact=x_mm, yfact=-y_mm, origin=(0, 0))
    )

    # --- Step 6: Move to center of SVG ---
    w, h = params["width_mm"], params["height_mm"]
    gdf["geometry"] = gdf["geometry"].translate(xoff=w / 2, yoff=h / 2)

    # --- Step 7: Rotate if needed ---
    if params["bearing"] != 0:
        gdf["geometry"] = gdf["geometry"].rotate(-params["bearing"], origin=(w / 2, h / 2))

    return gdf




