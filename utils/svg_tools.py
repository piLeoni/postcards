import re 
from utils.gdf_ops import fully_flatten_gdf
import xml.etree.ElementTree as ET
import matplotlib.colors as mcolors
from utils.gdf_optimizer import gdf_optimize_paths, merge_consecutive_paths_by_distance, merge_paths_by_distance, tsp_order
import geopandas as gpd


class SVG_composer:
    def __init__(self, params):
        # Create the root SVG element
        self.svg_root = ET.Element('svg', 
            width=f"{params['width_mm']}mm", 
            height=f"{params['height_mm']}mm",
            viewBox=f"0 0 {params['width_mm']} {params['height_mm']}",
            xmlns="http://www.w3.org/2000/svg",
            style="background-color: white;"
        )
        
        # Add style element
        style = ET.SubElement(self.svg_root, 'style')
        style.text = '''
        * {
          fill: none;
          stroke: black;
          stroke-width: 0.1;
        }
        '''
        
        self.layers = {}  # Dictionary to store layer groups
        self.params = params

    def add_layer(self, layer_name):
        """Create a new layer if it doesn't exist"""
        if layer_name not in self.layers:
            layer_group = ET.SubElement(self.svg_root, 'g', id=layer_name)
            self.layers[layer_name] = layer_group
        return self.layers[layer_name]

    def add_gdf_to_layer(self, gdf, layer_name, **kwargs):
        """Add GeoDataFrame to a specific layer"""
        return self.add_gdf(gdf, layer_name=layer_name, **kwargs)
    
    def save_svg(self, filename):
        tree = ET.ElementTree(self.svg_root)
        tree.write(filename, encoding='utf-8', xml_declaration=True)
        return self
    
    def get_svg_string(self):
        """Returns the SVG as a string instead of saving to file"""
        tree = ET.ElementTree(self.svg_root)
        # Convert to string with proper encoding and declaration
        import io
        buffer = io.StringIO()
        tree.write(buffer, encoding='unicode', xml_declaration=True)
        return buffer.getvalue()

    def get_svg_tree(self):
        """Returns the SVG as an ElementTree object for further manipulation"""
        return ET.ElementTree(self.svg_root)
    
    def get_layer_index(self, target_id):
        tree = ET.ElementTree(self.svg_root)
        root = tree.getroot()

        index = 1
        for elem in root.iter():
            if elem.tag.endswith('g') and 'id' in elem.attrib:
                if elem.attrib['id'] == target_id:
                    return index
                index += 1
        return None



    def add_gdf(self, gdf, layer_name="default", optimize_order=False, merge_close_paths=False, merge_tolerance=0.5, min_length=0):
        if isinstance(gdf, gpd.GeoSeries):
            gdf = gpd.GeoDataFrame(geometry=gdf)
        if not isinstance(gdf, gpd.GeoDataFrame) or gdf.empty:
            print("empty gdf")
            return self

        gdf = fully_flatten_gdf(gdf)

        if optimize_order == "Base":
            gdf = tsp_order(gdf)
        if optimize_order == "Advanced":
            gdf = gdf_optimize_paths(gdf)

        if merge_close_paths == "Base":
            gdf = merge_consecutive_paths_by_distance(gdf, merge_tolerance)
        if merge_close_paths == "Advanced":
            gdf = merge_paths_by_distance(gdf, merge_tolerance)

        if min_length > 0:
            gdf = gdf[gdf.geometry.length >= min_length].copy()

        # Create or get the layer group
        if layer_name not in self.layers:
            layer_group = ET.SubElement(self.svg_root, 'g', id=layer_name)
            self.layers[layer_name] = layer_group
        else:
            layer_group = self.layers[layer_name]

        # Add elements to the layer
        for geom in gdf.geometry:
            if geom.is_empty:
                continue
            element = ET.fromstring(geom.svg())
            del element.attrib['fill']
            del element.attrib['stroke']
            del element.attrib['stroke-width']
            del element.attrib['opacity']
            layer_group.append(element)
   
        return self
    
    def lerp_color(self, color1, color2, t):
        rgb1 = mcolors.hex2color(color1)  # Convert hex to RGB
        rgb2 = mcolors.hex2color(color2)  # Convert hex to RGB
        lerped_rgb = [(1 - t) * rgb1[i] + t * rgb2[i] for i in range(3)]
        return mcolors.to_hex(lerped_rgb)

    # Method to colorize the elements
    def colorize_elements(self, start_color="#ff0000", end_color="#0000ff"):
        # Get all path elements from all layers (including nested elements)
        all_elements = []
        for layer_group in self.layers.values():
            # Find all elements recursively, not just immediate children
            all_elements.extend(layer_group.findall('.//*'))
        
        total_elements = len(all_elements)
        
        for i, element in enumerate(all_elements):
            t = i / (total_elements - 1) if total_elements > 1 else 0
            lerped_color = self.lerp_color(start_color, end_color, t)
            element.set('style', f"stroke:{lerped_color}")
            
        return self

    def colorize_elements_spectrum(self):
        """Colorize elements using the full color spectrum for pen plotter order visualization"""
        # Get all path elements from all layers (including nested elements)
        all_elements = []
        for layer_group in self.layers.values():
            # Find all elements recursively, not just immediate children
            all_elements.extend(layer_group.findall('.//*'))
        
        total_elements = len(all_elements)
        
        # Define a full spectrum of colors
        spectrum_colors = [
            "#ff0000",  # Red
            "#ff8000",  # Orange
            "#ffff00",  # Yellow
            "#80ff00",  # Lime
            "#00ff00",  # Green
            "#00ff80",  # Spring Green
            "#00ffff",  # Cyan
            "#0080ff",  # Sky Blue
            "#0000ff",  # Blue
            "#8000ff",  # Purple
            "#ff00ff",  # Magenta
            "#ff0080"   # Pink
        ]
        
        for i, element in enumerate(all_elements):
            if total_elements > 1:
                # Map index to spectrum position
                spectrum_index = (i / (total_elements - 1)) * (len(spectrum_colors) - 1)
                # Get the two colors to interpolate between
                color1_index = int(spectrum_index)
                color2_index = min(color1_index + 1, len(spectrum_colors) - 1)
                # Calculate interpolation factor
                t = spectrum_index - color1_index
                # Interpolate between the two colors
                lerped_color = self.lerp_color(spectrum_colors[color1_index], spectrum_colors[color2_index], t)
            else:
                lerped_color = spectrum_colors[0]
            
            element.set('style', f"stroke:{lerped_color}")
            
        return self
