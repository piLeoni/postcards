from shapely.affinity import  scale as shapely_scale
from pyproj import CRS, Transformer

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