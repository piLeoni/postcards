import re 
from utils.gdf_ops import fully_flatten_gdf
import xml.etree.ElementTree as ET
import matplotlib.colors as mcolors
from utils.gdf_optimizer import gdf_optimize_paths, merge_consecutive_paths_by_distance, merge_paths_by_distance, tsp_order
import geopandas as gpd


class SVG_composer:
    def __init__(self, params):
        self.svg_elements = []
        self.params = params

    
    def save_svg(self, filename):
        with open(filename, 'w') as f: 
            output = f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
                    <svg width="{self.params['width_mm']}mm" height="{self.params['height_mm']}mm" 
                     viewBox="0 0 {self.params['width_mm']} {self.params['height_mm']}"
                     xmlns="http://www.w3.org/2000/svg"
                     style="background-color: white;">
                       <style>
                        * {{
                          fill: none;
                          stroke: black;
                          stroke-width: 0.1;
                        }}
                         </style>
                     \n
                    '''
            output += "\n".join(self.svg_elements)
            output += "\n</svg>"
                    
            f.write(output)
        return self
    
    def add_gdf(self, gdf, optimize_order=False, merge_close_paths=False, merge_tolerance=0.5, min_length=0):
        if isinstance(gdf, gpd.GeoSeries):
            gdf = gpd.GeoDataFrame(geometry=gdf)
        if not isinstance(gdf, gpd.GeoDataFrame) or gdf.empty:
            print("empty gdf")
            return self

        gdf= fully_flatten_gdf(gdf)

        if optimize_order == "Base":
            gdf= tsp_order(gdf)
        if optimize_order == "Advanced":
            gdf= gdf_optimize_paths(gdf)

        if merge_close_paths == "Base":
            gdf = merge_consecutive_paths_by_distance(gdf, merge_tolerance)
        if merge_close_paths == "Advanced":
            gdf = merge_paths_by_distance(gdf, merge_tolerance)

        if min_length > 0:
            gdf =  gdf[gdf.geometry.length >= min_length].copy()


        for geom in gdf.geometry:
            if geom.is_empty:
                continue
            element  = ET.fromstring(geom.svg())
            del element.attrib['fill']
            del element.attrib['stroke']
            del element.attrib['stroke-width']
            del element.attrib['opacity']
            self.svg_elements.append(ET.tostring(element, encoding='unicode'))
   
        return self
    
    def lerp_color(self, color1, color2, t):
        rgb1 = mcolors.hex2color(color1)  # Convert hex to RGB
        rgb2 = mcolors.hex2color(color2)  # Convert hex to RGB
        lerped_rgb = [(1 - t) * rgb1[i] + t * rgb2[i] for i in range(3)]
        return mcolors.to_hex(lerped_rgb)

    # Method to colorize the elements
    def colorize_elements(self, start_color="#ff0000", end_color="#0000ff"):
        total_elements = len(self.svg_elements)
        
        for i, element_str in enumerate(self.svg_elements):
            
            element = ET.fromstring(element_str)
            t = i / (total_elements - 1) if total_elements > 1 else 0
            lerped_color = self.lerp_color(start_color, end_color, t)
            element.set('style', f"stroke:{lerped_color}")
            
            self.svg_elements[i] = ET.tostring(element, encoding='unicode')
            
        return self
