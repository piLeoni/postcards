import geopandas as gpd
import watermask
from shapely.geometry import shape


def load_ocean_tiles_by_polygon(selector_polygon, crs=None, clip=True, width=2048):
    """
    Loads the ocean inside a polygon from OpenStreetMap vector tiles (OpenFreeMap),
    via watermask. Tiles are downloaded on demand and cached on disk.

    Parameters:
        selector_polygon (shapely.geometry.Polygon): Input polygon in EPSG:4326.
        crs: CRS of the map frame being built. The ocean is reprojected to it so
            it joins the water layer seamlessly.
        clip (bool): Whether to clip the result to the selector polygon.
        width (int): Detail to fetch, as pixels across the polygon's bounds; picks
            the tile zoom (up to 14, full OpenStreetMap detail).

    Returns:
        GeoDataFrame: One merged ocean geometry, in ``crs``.
    """

    if not selector_polygon.is_valid:
        selector_polygon = selector_polygon.buffer(0)

    water = watermask.fetch(selector_polygon.bounds, width=width, areas=["ocean"], lines=[])
    # watermask joins the tile pieces and cuts to the box itself.
    features = water.geojson(bounds=selector_polygon.bounds if clip else None)["features"]
    oceans = [shape(f["geometry"]) for f in features if f["properties"]["class"] == "ocean"]
    if not oceans:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    ocean = oceans[0] if len(oceans) == 1 else oceans[0].union(oceans[1])
    if clip:
        ocean = ocean.intersection(selector_polygon)
    if ocean.is_empty:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")

    merged = gpd.GeoDataFrame(geometry=[ocean], crs="EPSG:4326")
    if crs is not None and not merged.crs.equals(crs):
        merged = merged.to_crs(crs)

    return merged
