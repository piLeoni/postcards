from utils.patterns.test_grid import test_grid
from utils.patterns.waves import waves_pattern
from utils.patterns.dots import dots_pattern
from utils.patterns.new.elements_pattern import elements_pattern, GridType, ElementAlign

from utils.svg_tools import  SVG_composer
import geopandas as gpd
from shapely.geometry import LineString





def test_patterns(params):
    """
    Projects GeoJSON features to an SVG drawing using parameters from a dictionary.
    """
    print(params)

    grid = test_grid(params, grid_x=2, grid_y=2, element_size=30)
    
    composer = SVG_composer(params)
    
    triangle_geom = LineString([(0,0), (0,1), (1,1), (1,0), (0,0)])
    def my_geom(props):
        print(props)
        # size = props["index"] *0.1
        return LineString([(0,0), props["point"]])
        
    
    triangles = elements_pattern(
        [grid["by_grid"]["x1_y1"], grid["by_grid"]["x1_y2"]],
        grid_type=GridType.RECTANGULAR,
        rotation=0,
        spacing=2,
        buffer=0,
        grid_offset=(0,0),
        geometry=triangle_geom,
        element_scale= 1,
        element_rotation=0,
        clip_elements=False,
        filter_points=False,
        element_align=ElementAlign.CENTER
    )
    
    composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=grid["all_elements"]), "grid")
    composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=triangles), "lines")

    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=waves_pattern(params, 0.75, 0)).clip(grid["by_grid"]["x1_y1"]), "waves")
    # composer.add_gdf_to_layer(gpd.GeoDataFrame(geometry=dots_pattern(params, 0.5, 45, 0.3)).clip(grid["by_grid"]["x2_y1"]), "dots")

    composer.save_svg(params["output"])

  
p = {'width_mm': 152.4, 'height_mm': 101.6, 'scale': '1:10000', 'output': 'test.svg'}

test_patterns(p)