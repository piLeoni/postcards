from utils.process_feature_factory import process_feature_factory
from utils.geometry_to_svg import save_svg
from utils.filters.buildings import filter_buildings, process_buildings
from utils.filters.roads import filter_roads, process_roads
from utils.filters.parks import filter_parks, process_parks
from utils.filters.water import filter_water, process_water
from utils.patterns.waves import waves_pattern
from utils.cli_parser import parse_args
from utils.clipping_area import clipping_area, clip_by, cut_fast_by
from utils.filters.parks import filter_parks
from concurrent.futures import ProcessPoolExecutor, as_completed

import time



def project_geojson_to_svg(params):
    """
    Projects GeoJSON features to an SVG drawing using parameters from a dictionary.
    """

    
    # process_feature = process_feature_factory( params["trasformer"], **params)
    
    start = time.time()    
    
   
    with ProcessPoolExecutor(max_workers=8) as executor:
        future_buildings = executor.submit(process_buildings, params)
        future_roads = executor.submit(process_roads, params)
        future_parks = executor.submit(process_parks, params)
        future_water = executor.submit(process_water, params)

        building_geometry, building_patterns = future_buildings.result()
        parks_geometry, parks_patterns = future_parks.result()
        road_geometry = future_roads.result()
        water_geometry, water_patterns = future_water.result()

    
    end = time.time()
    print(f"Elapsed time: {end - start:.4f} seconds")

 
    
    drawing_area = clipping_area(params)
    toPrint = clip_by(
                        []
                    + building_geometry
                    + parks_geometry
                    + road_geometry
                    + water_geometry
                    
                    + building_patterns
                    + parks_patterns
                    + water_patterns
              
                    , drawing_area)
    
    save_svg(toPrint, params)

   




project_geojson_to_svg(parse_args())
