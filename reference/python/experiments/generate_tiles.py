import geopandas as gpd
import shapely
import os

# Load the full ocean polygon
ocean = gpd.read_file("utils/water-polygons-split-4326/water_polygons.shp")
ocean = ocean.to_crs("EPSG:4326")  # ensure in lat/lon

# Directory to save tiles
os.makedirs("tiles/ocean_10deg", exist_ok=True)

# Create and save tiles
for lon in range(-180, 180, 10):
    for lat in range(-90, 90, 10):
        tile_bounds = shapely.geometry.box(lon, lat, lon + 10, lat + 10)
        tile_gdf = ocean.clip(tile_bounds)
        if not tile_gdf.empty:
            filename = f"tiles/ocean_10deg/ocean_{lat}_{lon}.gpkg"
            tile_gdf.to_file(filename, driver="GPKG")
            print(f"Saved {filename}")
