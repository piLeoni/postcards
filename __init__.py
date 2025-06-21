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
from utils.timer import Timer
from concurrent.futures import ProcessPoolExecutor, as_completed
from utils.generate_bounds import generate_rectangle_polygon
from utils.gdf_projector import gdf_projector, gdf_projector_webmercator
from shapely_polyskel import StraightSkeleton

import osmnx as ox

ox.settings.timeout = 300  # seconds
ox.settings.use_cache = True
ox.settings.log_console = True
ox.settings.max_query_area_size = 1000 * 1000 * 1000  # 50 sq km

# https://osmdata.openstreetmap.de/info/formats.html#
import geopandas as gpd


import shapely


def create_skeleton(geometry):
    """Create skeleton from polygon or multipolygon geometry"""
    if geometry.geom_type == 'MultiPolygon':
        skeletons = []
        for polygon in geometry.geoms:
            try:
                skeleton = StraightSkeleton(polygon=polygon).straight_skeleton
                skeletons.append(skeleton)
            except:
                continue
        return shapely.ops.unary_union(skeletons) if skeletons else geometry
    else:
        try:
            return StraightSkeleton(polygon=geometry).straight_skeleton
        except:
            return geometry


def project_geojson_to_svg(params):
    """
    Projects GeoJSON features to an SVG drawing using parameters from a dictionary.
    """

    timer = Timer()
    
    # process_feature = process_feature_factory( params["trasformer"], **params)
    

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
        timer.log("Creating polygon")

    except ox._errors.InsufficientResponseError:
        print("No data found in this region or request timed out")

        gdf = gpd.GeoDataFrame(
            data=[],
            columns=['geometry'],
            geometry='geometry',
            crs="EPSG:4326"  # WGS84, the coordinate system used by OSM
        )
        timer.log("Fethcing data")

    gdf_projected = gdf_projector_webmercator(gdf, params)
    timer.log("Projecting data")

    
    buildings = filter_buildings(gdf_projected.copy(), params)["geometry"]()
    timer.log("Generating buildings")
    roads = filter_roads(gdf_projected.copy(), params)["geometry"]()
    timer.log("Generating roads")
    parks = filter_parks(gdf_projected.copy(), params)["geometry"]()
    timer.log("Generating parks")
    water = filter_water(gdf_projected.copy(), params)["geometry"]()
    timer.log("Generating water")

  

    # cl_a = gpd.GeoDataFrame(geometry=[clipping_area(params)], crs=gdf_projected.crs)
    # cl_a = clipping_area(params)

    composer = SVG_composer(params)
    

    # composer.add_gdf(roads['outlines'].clip(cl_a), optimize_order="Advanced", merge_close_paths="Base", merge_tolerance=0.25, min_length = 0.75)
    # composer.add_gdf(roads['details'].clip(cl_a), optimize_order="Advanced", merge_close_paths="Base", merge_tolerance=0.25, min_length = 0.75)

    # building_mask = buildings['mask'].difference(roads['mask'])
    
    # composer.add_gdf(buildings['outlines'].clip(cl_a).difference(roads['mask']), optimize_order="Base")
    # composer.add_gdf(buildings['details'].clip(cl_a).clip(building_mask), optimize_order="Advanced", merge_close_paths="Base", merge_tolerance=0.25, min_length = 0.75)
    # composer.add_gdf(buildings['filling'].clip(building_mask).clip(cl_a), optimize_order="Advanced", merge_close_paths="Base", merge_tolerance=0.55, min_length = 0.75)

    # composer.add_gdf(water['outlines'].difference(building_mask).difference(roads["mask"]).clip(cl_a))
    # composer.add_gdf(water['filling'].difference(building_mask).difference(roads["mask"]).clip(cl_a), optimize_order="Advanced", min_length = 0.35)

    # composer.add_gdf(parks['outlines'].difference(building_mask).difference(roads["mask"]).difference(water["mask"]).clip(cl_a))
    # composer.add_gdf(parks['filling'].difference(building_mask).difference(roads["mask"]).difference(water["mask"]).clip(cl_a))
    
    
    
    
    # composer.add_gdf_to_layer(roads['outlines'], "outlines")
    # composer.add_gdf_to_layer(roads['details'], "outlines")
    # # timer.log("Adding roads")
    # building_mask = buildings['mask'].difference(roads['mask'])
    # timer.log("Creating building mask")
    # composer.add_gdf(buildings['outlines'].difference(roads['mask']), "outlines")
    # timer.log("Adding builings outline")
    # composer.add_gdf(buildings['details'].clip(building_mask), "outlines")
    # timer.log("Adding builings details")
    # composer.add_gdf(buildings['filling'].clip(building_mask), "buildings_filling")

    # composer.add_gdf(water['outlines'].difference(building_mask).difference(roads["mask"]), "outlines")
    # composer.add_gdf(water['filling'].difference(building_mask).difference(roads["mask"]), "water_filling")

    # composer.add_gdf(parks['outlines'].difference(building_mask).difference(roads["mask"]).difference(water["mask"]), "outlines")
    # composer.add_gdf(parks['filling'].difference(building_mask).difference(roads["mask"]).difference(water["mask"]), "parks_filling")
    

            
   
    roads_mask = roads['mask'].buffer(0.1)
    building_mask = buildings['mask'].difference(roads_mask)
    
    outlines = [roads['outlines'],
                roads['details'],
                buildings['outlines'].difference(roads_mask),
                buildings['details'].clip(building_mask), 
                water['outlines'].difference(building_mask).difference(roads_mask),
                parks['outlines'].difference(building_mask).difference(roads_mask).difference(water["mask"])
                ]

    composer.add_gdf_to_layer(outlines, "outlines")
    composer.add_gdf_to_layer(buildings['filling'].clip(building_mask), "buildings_filling")
    composer.add_gdf_to_layer(water['filling'].difference(building_mask).difference(roads_mask),"water_filling")
    composer.add_gdf_to_layer(parks['filling'].difference(building_mask).difference(roads_mask).difference(water["mask"]), "parks_filling")

    composer.save_svg(params["output"])
    timer.log("Saving svg")

  

project_geojson_to_svg(parse_args())
