from utils.process_feature_factory import process_feature_factory
from utils.svg_tools import  SVG_composer
from utils.filters.buildings import filter_buildings
from utils.filters.roads import filter_roads, process_roads
from utils.filters.parks import filter_parks, process_parks
from utils.filters.water import filter_water, process_water
from utils.patterns.waves import waves_pattern
from utils.cli_parser import parse_args
from utils.clipping_area import clipping_area, clip_by, cut_fast_by
from utils.filters.parks import filter_parks
from concurrent.futures import ProcessPoolExecutor, as_completed
from utils.generate_bounds import generate_rectangle_polygon

import osmnx as ox

ox.settings.timeout = 300  # seconds
ox.settings.use_cache = True
ox.settings.log_console = True
ox.settings.max_query_area_size = 1000 * 1000 * 1000  # 50 sq km


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
        "natural": True,
        "water": True, 
        "landuse": True,
        "amenity": True,
        "leisure": True,
        "man_made": True,
        "waterway": True,
        "railway": True,
        "power": True
    }
    # tags = { "building": True }

    try:
        gdf = ox.features_from_polygon(generate_rectangle_polygon(params), tags=tags)
    except ox._errors.InsufficientResponseError:
        print("No data found in this region or request timed out")
        # Maybe try with specific tags instead
        gdf = gpd.GeoDataFrame(
            data=[],
            columns=['geometry'],
            geometry='geometry',
            crs="EPSG:4326"  # WGS84, the coordinate system used by OSM
        )



    
    buildings = filter_buildings(gdf, params)["geometry"]()
    # with ProcessPoolExecutor(max_workers=8) as executor:
        # future_buildings = executor.submit(process_buildings, params)
        # future_roads = executor.submit(process_roads, params)
        # future_parks = executor.submit(process_parks, params)
        # future_water = executor.submit(process_water, params)

        # building_geometry, building_patterns = future_buildings.result()
        # parks_geometry, parks_patterns = future_parks.result()
        # road_geometry = future_roads.result()
        # water_geometry, water_patterns = future_water.result()

    
    # end = time.time()
    # print(f"Elapsed time: {end - start:.4f} seconds")

 
    
    # drawing_area = clipping_area(params)
    # toPrint = clip_by(
    #                     []
    #                 + building_geometry
    #                 + parks_geometry
    #                 + road_geometry
    #                 + water_geometry
                    
    #                 + building_patterns
    #                 + parks_patterns
    #                 + water_patterns
              
    #                 , drawing_area)
    
    
    cl_a = clipping_area(params)
    print(buildings['details'].clip(cl_a))
    composer = SVG_composer(params)
    # composer.add_gdf(buildings['outlines'].clip(cl_a))
    composer.add_gdf(buildings['details'].clip(cl_a), optimize_order=True, merge_close_paths=True, merge_tolerance=0.5)
    # composer.add_gdf(buildings['filling'].clip(cl_a))
    composer.colorize_elements()
    # composer.apply_global_styles(start_color='#FF0000', end_color='#0000FF', stroke_width=0.3, fill='none') 
    # composer.generate_final_svg()
    composer.save_svg(params["output"])
    # import pprint
    # from utils.gdf_ops import fully_flatten_gdf
    # pprint.pprint(fully_flatten_gdf(buildings['filling'].clip(cl_a)))
    # save_svg(buildings["mask"], params)
    # gdf_to_svg(buildings['outlines'], params)   
    # all_geometries = gpd.pd.concat([
    #     # buildings['outlines'],
    #     buildings['details'],
    #     # buildings['filling']
    # ]).dropna() # Drop any NaN values that might arise

    # if not all_geometries.empty:
    #     combined_all_gdf = gpd.GeoDataFrame(geometry=all_geometries)
    #     gdf_to_svg(combined_all_gdf, params)
    # else:
    #     print("No valid geometries to combine.")


   




project_geojson_to_svg(parse_args())
