from utils.process_feature_factory import process_feature_factory
from utils.svg_tools import  SVG_composer
from utils.filters.buildings import filter_buildings
from utils.filters.roads import filter_roads
from utils.filters.parks import filter_parks
from utils.filters.water import filter_water
from utils.patterns.waves import waves_pattern
from utils.cli_parser import parse_args
from utils.clipping_area import clipping_area, clip_by, cut_fast_by
from utils.filters.parks import filter_parks
from concurrent.futures import ProcessPoolExecutor, as_completed
from utils.generate_bounds import generate_rectangle_polygon
from utils.gdf_projector import gdf_projector, gdf_projector_webmercator

import osmnx as ox

ox.settings.timeout = 300  # seconds
ox.settings.use_cache = True
ox.settings.log_console = True
ox.settings.max_query_area_size = 1000 * 1000 * 1000  # 50 sq km

# https://osmdata.openstreetmap.de/info/formats.html#
import geopandas as gpd

import time



def project_geojson_to_svg(params):
    """
    Projects GeoJSON features to an SVG drawing using parameters from a dictionary.
    """

    
    # process_feature = process_feature_factory( params["trasformer"], **params)
    
    start = time.time()    

    # gdf = ox.features_from_polygon(generate_rectangle_polygon(params), tags={"building": True}) 
    tags = {
        "building": True,
        "highway": True,
        "railway": True,
        "natural": True,
        "water": True, 
        "landuse": True,
        "amenity": True,
        "leisure": True,
        # "man_made": True,
        "waterway": True,
        # "power": True
    }
    # tags = { "building": True }

    try:
        gdf = ox.features_from_polygon(params["polygon"], tags=tags)
    except ox._errors.InsufficientResponseError:
        print("No data found in this region or request timed out")

        gdf = gpd.GeoDataFrame(
            data=[],
            columns=['geometry'],
            geometry='geometry',
            crs="EPSG:4326"  # WGS84, the coordinate system used by OSM
        )

    print(f"Fetching time: {time.time() - start:.4f} seconds")
    gdf_projected = gdf_projector_webmercator(gdf, params)
    print(f"Projecting time: {time.time() - start:.4f} seconds")

    
    buildings = filter_buildings(gdf_projected.copy(), params)["geometry"]()
    roads = filter_roads(gdf_projected.copy(), params)["geometry"]()
    parks = filter_parks(gdf_projected.copy(), params)["geometry"]()
    water = filter_water(gdf_projected.copy(), params)["geometry"]()

  
    
    print(f"Conversion time: {time.time() - start:.4f} seconds")

    # cl_a = gpd.GeoDataFrame(geometry=[clipping_area(params)], crs=gdf_projected.crs)
    cl_a = clipping_area(params)

    composer = SVG_composer(params)
    
    building_mask = buildings['mask'].difference(roads['mask'])

    composer.add_gdf(roads['outlines'].clip(cl_a), optimize_order="Advanced", merge_close_paths="Base", merge_tolerance=0.25, min_length = 0.75)
    composer.add_gdf(roads['details'].clip(cl_a), optimize_order="Advanced", merge_close_paths="Base", merge_tolerance=0.25, min_length = 0.75)

    composer.add_gdf(buildings['outlines'].clip(cl_a).difference(roads['mask']), optimize_order="Base")
    composer.add_gdf(buildings['details'].clip(cl_a).clip(building_mask), optimize_order="Advanced", merge_close_paths="Base", merge_tolerance=0.25, min_length = 0.75)
    composer.add_gdf(buildings['filling'].clip(building_mask).clip(cl_a), optimize_order="Advanced", merge_close_paths="Base", merge_tolerance=0.55, min_length = 0.75)

    composer.add_gdf(parks['outlines'].difference(building_mask).difference(roads["mask"]).clip(cl_a))
    composer.add_gdf(parks['filling'].difference(building_mask).difference(roads["mask"]).clip(cl_a))
    
    composer.add_gdf(water['outlines'].difference(building_mask).difference(roads["mask"]).clip(cl_a))
    composer.add_gdf(water['filling'].difference(building_mask).difference(roads["mask"]).clip(cl_a), optimize_order="Advanced", min_length = 0.35)


    composer.colorize_elements()
    composer.save_svg(params["output"])
    print(f"Composing time: {time.time() - start:.4f} seconds")

  




project_geojson_to_svg(parse_args())
