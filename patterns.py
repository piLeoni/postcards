from utils.patterns.test_grid import test_grid
from utils.patterns.waves import waves_pattern
from utils.patterns.dots import dots_pattern
from utils.patterns.new.elements_pattern import elements_pattern, GridType, ElementAlign

from utils.svg_tools import  SVG_composer
import geopandas as gpd
from shapely.geometry import LineString, MultiLineString





def test_patterns(params):
    """
    Projects GeoJSON features to an SVG drawing using parameters from a dictionary.
    """
    print(params)

    grid = test_grid(params, grid_x=5, grid_y=3, element_size=20, area_padding=3)
    
    composer = SVG_composer(params)
    
    triangle_geom = LineString([(0,0), (0,1), (1,1), (1,0), (0,0)])
    def my_geom(props):
        print(props)
        # size = props["index"] *0.1
        return LineString([(0,0), props["point"]])
        
    
    cross = MultiLineString([[(0,1), (0,-1)], [(-1,0), (1, 0)]])

    
    composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=grid["all_elements"]), "grid")
    
    composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
        grid["by_grid"]["x1_y1"],
        grid_type=GridType.RECTANGULAR,
        spacing=2,
        # geometry=cross,
        # element_scale=1,
        element_rotation=45,
        filter_points=False,
        clip_elements=False
        
        
    )), "lines")
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x1_y1"],
    #     grid_type=GridType.TRIANGULAR,
    #     spacing=2,
    #     grid_offset=(1,0)
    # )), "lines")

    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x2_y1"],
    #     grid_type=GridType.TRIANGULAR,
    #     spacing=1.5,
    # )), "lines")
    # composer.add_gdf_to_layer(gpd
    # .GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x3_y1"],
    #     grid_type=GridType.TRIANGULAR,
    #     spacing=1,
    # )), "lines")
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x4_y1"],
    #     grid_type=GridType.TRIANGULAR,
    #     spacing=0.75,
    # )), "lines")
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x5_y1"],
    #     grid_type=GridType.TRIANGULAR,
    #     spacing=0.5,
    # )), "lines")
    
    # longer_line = LineString([(-0.2, 0),(0.2, 0)])
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x1_y2"],
    #     grid_type=GridType.TRIANGULAR,
    #     geometry=longer_line,
    #     spacing=2,
    # )), "lines")
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x2_y2"],
    #     grid_type=GridType.TRIANGULAR,
    #     geometry=longer_line,
    #     spacing=1.5,
    # )), "lines")
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x3_y2"],
    #     grid_type=GridType.TRIANGULAR,
    #     geometry=longer_line,
    #     spacing=1,
    # )), "lines")
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x4_y2"],
    #     grid_type=GridType.TRIANGULAR,
    #     geometry=longer_line,
    #     spacing=0.75,
    # )), "lines")
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x5_y2"],
    #     grid_type=GridType.TRIANGULAR,
    #     geometry=longer_line,
    #     spacing=0.5,
    # )), "lines")
    
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x1_y3"],
    #     grid_type=GridType.POISSON,
    #     spacing=2,
    # )), "lines")
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x2_y3"],
    #     grid_type=GridType.POISSON,
    #     spacing=1.5,
    # )), "lines")
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x3_y3"],
    #     grid_type=GridType.POISSON,
    #     spacing=1,
    # )), "lines")
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x4_y3"],
    #     grid_type=GridType.POISSON,
    #     spacing=0.75,
    # )), "lines")
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=elements_pattern(
    #     grid["by_grid"]["x5_y3"],
    #     grid_type=GridType.POISSON,
    #     spacing=0.5,
    # )), "lines")



    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=waves_pattern(params, 0.75, 0)).clip(grid["by_grid"]["x1_y1"]), "waves")
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=dots_pattern(params, 0.5, 45, 0.3)).clip(grid["by_grid"]["x2_y1"]), "dots")

    composer.save_svg(params["output"])

  
p = {'width_mm': 152.4, 'height_mm': 101.6, 'scale': '1:10000', 'output': 'test.svg'}

test_patterns(p)