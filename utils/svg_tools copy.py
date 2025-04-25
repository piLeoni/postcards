# Import necessary libraries
from lxml import etree
import re
import math
import numpy as np # For distance calculations
from shapely.geometry import Point, LineString, Polygon, MultiPoint, MultiLineString, MultiPolygon
from shapely.ops import transform, unary_union # unary_union might be useful for merging later
import copy # To avoid modifying original geometries when reversing

# Helper function to convert hex color string to RGB tuple
def hex_to_rgb(hex_color):
    """Converts a hex color string (e.g., '#FF0000') to an RGB tuple (e.g., (255, 0, 0))."""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

# Helper function to convert RGB tuple to hex color string
def rgb_to_hex(rgb_color):
    """Converts an RGB tuple (e.g., (255, 0, 0)) to a hex color string (e.g., '#FF0000')."""
    # Ensure values are within the valid 0-255 range and are integers
    return '#{:02x}{:02x}{:02x}'.format(
        int(max(0, min(255, rgb_color[0]))),
        int(max(0, min(255, rgb_color[1]))),
        int(max(0, min(255, rgb_color[2])))
    )

# Helper function for linear interpolation between two colors
def lerp_color(t, start_rgb, end_rgb):
    """
    Linearly interpolates between start_rgb and end_rgb based on t (0.0 to 1.0).
    Returns the interpolated RGB tuple.
    """
    return (
        start_rgb[0] + (end_rgb[0] - start_rgb[0]) * t,
        start_rgb[1] + (end_rgb[1] - start_rgb[1]) * t,
        start_rgb[2] + (end_rgb[2] - start_rgb[2]) * t
    )

# --- Geometry Helper Functions ---

def flatten_geometry(geom):
    """
    Flattens a Shapely geometry into a list of simple, drawable components
    (Points, LineStrings, Polygon exteriors as LineStrings).

    Args:
        geom: A Shapely geometry object.

    Returns:
        list: A list of simple Shapely geometries.
    """
    if geom is None or geom.is_empty:
        return []

    if isinstance(geom, (Point, LineString)):
        return [geom]
    elif isinstance(geom, Polygon):
        # Return exterior ring as a LineString for plotting
        # Ignore interior holes for typical plotter outlines
        if geom.exterior is not None and not geom.exterior.is_empty:
             # Ensure exterior is LineString (it should be, but check)
             if isinstance(geom.exterior, LineString):
                 return [geom.exterior]
             else: # Should not happen with valid polygons
                 return []
        else:
            return []
    elif isinstance(geom, MultiPoint):
        # Return individual points
        return [pt for pt in geom.geoms if not pt.is_empty]
    elif isinstance(geom, MultiLineString):
        # Recursively flatten each LineString
        flat_list = []
        for line in geom.geoms:
            flat_list.extend(flatten_geometry(line))
        return flat_list
    elif isinstance(geom, MultiPolygon):
        # Recursively flatten each Polygon (getting its exterior)
        flat_list = []
        for poly in geom.geoms:
            flat_list.extend(flatten_geometry(poly))
        return flat_list
    elif hasattr(geom, 'geoms'): # Handle GeometryCollection or other potential multi-geoms
        flat_list = []
        for sub_geom in geom.geoms:
            flat_list.extend(flatten_geometry(sub_geom))
        return flat_list
    else:
        # Geometry type not handled for flattening (or already simple)
        print(f"Warning: Geometry type {type(geom)} not explicitly handled in flatten_geometry.")
        return [geom] # Return as is if unsure


def get_start_end_points(geom):
    """
    Extracts the start and end points of a simple Shapely geometry
    (Point, LineString). Returns (None, None) for others or empty.
    """
    if geom is None or geom.is_empty:
        return None, None
    # This function now expects simple geometries after flattening
    if isinstance(geom, Point):
        return geom, geom # Point is its own start and end
    elif isinstance(geom, LineString):
        # Check if LineString has at least 2 points
        if len(geom.coords) >= 2:
            return Point(geom.coords[0]), Point(geom.coords[-1])
        elif len(geom.coords) == 1: # LineString with single point
             pt = Point(geom.coords[0])
             return pt, pt
        else: # Empty LineString
            return None, None
    # Polygon exteriors are treated as LineStrings by flatten_geometry
    # Other types shouldn't reach here after flattening if flatten_geometry is used first.
    # print(f"Warning: get_start_end_points called with unexpected type {type(geom)}")
    return None, None

def reverse_geom(geom):
    """Reverses the coordinate order of LineString geometries. Returns a new geometry."""
    # Only makes sense for LineString after flattening
    if isinstance(geom, LineString):
        return LineString(geom.coords[::-1])
    # Return a copy for Points or other types
    return copy.deepcopy(geom)


# --- SVG Composer Class ---

class SVG_composer:
    """
    Composes an SVG file from GeoDataFrames. Offers options per GDF to:
    1. Optimize path drawing order (nearest neighbor with path reversal on flattened geometries).
    2. Attempt to merge close path endpoints (EXPERIMENTAL).
    Global styling (e.g., interpolated colors) can be applied afterwards.
    """
    def __init__(self, params):
        """
        Initializes the SVG composer.

        Args:
            params (dict): SVG parameters ('width_mm', 'height_mm', etc.)
                           Can include defaults: 'stroke_width', 'fill',
                           'start_color', 'end_color'.
        """
        self.params = params
        self.element_strings = [] # Stores final SVG element strings
        self.final_svg = None
        # Default styles
        self.default_stroke_width = params.get('stroke_width', 0.1)
        self.default_fill = params.get('fill', 'none')
        self.default_start_color = params.get('start_color', '#FF0000') # Default Red
        self.default_end_color = params.get('end_color', '#0000FF')     # Default Blue

    def _optimize_geometry_order(self, simple_geometries):
        """
        Internal helper to optimize the order of a list of *simple* geometries
        (Points, LineStrings). Uses a nearest-neighbor approach considering path reversal.

        Args:
            simple_geometries (list): List of simple Shapely geometry objects (Points, LineStrings).

        Returns:
            list: List of (geometry, reverse_flag) tuples in optimized order.
        """
        if not simple_geometries:
            return []

        num_geoms = len(simple_geometries)
        original_indices = list(range(num_geoms))
        optimized_result = [] # Stores (geometry, reverse_flag)

        # Calculate start/end points for the simple geometries
        geom_points = [get_start_end_points(g) for g in simple_geometries]

        # Check for geometries that couldn't get start/end points
        valid_indices = [i for i, p in enumerate(geom_points) if p[0] is not None and p[1] is not None]
        if not valid_indices:
             print("Warning: No geometries with valid start/end points found for optimization.")
             # Return original order for all input geoms
             return [(geom, False) for geom in simple_geometries]

        # Start with the first valid geometry
        current_original_index = valid_indices[0]
        remaining_original_indices = list(original_indices) # Keep all original indices initially
        processed_indices = set()

        # Add geometries before the first valid one in original order
        for i in range(current_original_index):
             if i in remaining_original_indices:
                 optimized_result.append((simple_geometries[i], False))
                 remaining_original_indices.remove(i)
                 processed_indices.add(i)


        # Start optimization loop with the first valid geometry
        current_geom = simple_geometries[current_original_index]
        _, current_end_point = geom_points[current_original_index] # Should be valid based on valid_indices check
        optimized_result.append((current_geom, False))
        if current_original_index in remaining_original_indices:
            remaining_original_indices.remove(current_original_index)
        processed_indices.add(current_original_index)


        while True:
            # Find remaining valid indices
            valid_remaining_indices = [i for i in remaining_original_indices if i in valid_indices]
            if not valid_remaining_indices:
                break # No more valid geometries to optimize

            best_next_original_index = -1
            best_reverse_flag = False
            min_dist_sq = float('inf')
            best_geom_end_point = None

            # Find the nearest start/end point among remaining *valid* geometries
            current_coords = np.array(current_end_point.coords[0])
            for idx in valid_remaining_indices:
                start_point, end_point = geom_points[idx] # Should be valid

                # Distance to candidate's start point
                start_coords = np.array(start_point.coords[0])
                dist_to_start_sq = np.sum((start_coords - current_coords)**2)

                # Distance to candidate's end point
                end_coords = np.array(end_point.coords[0])
                dist_to_end_sq = np.sum((end_coords - current_coords)**2)

                # Check if starting point is closer
                if dist_to_start_sq < min_dist_sq:
                    min_dist_sq = dist_to_start_sq
                    best_next_original_index = idx
                    best_reverse_flag = False
                    best_geom_end_point = end_point

                # Check if ending point is closer (requires reversal)
                # Only reverse if it's a LineString (Points can't be reversed)
                if dist_to_end_sq < min_dist_sq and isinstance(simple_geometries[idx], LineString):
                    min_dist_sq = dist_to_end_sq
                    best_next_original_index = idx
                    best_reverse_flag = True
                    best_geom_end_point = start_point # Next current point is the original start

            if best_next_original_index != -1:
                chosen_geom = simple_geometries[best_next_original_index]
                optimized_result.append((chosen_geom, best_reverse_flag))
                remaining_original_indices.remove(best_next_original_index)
                processed_indices.add(best_next_original_index)
                # Update current end point - check if it's valid
                if best_geom_end_point is not None:
                     current_end_point = best_geom_end_point
                else:
                     # This case should ideally not happen if we only consider valid indices
                     print(f"Warning: Chosen next geometry {best_next_original_index} resulted in None endpoint.")
                     # Find the next valid index to continue, or break
                     next_valid = next((i for i in remaining_original_indices if i in valid_indices), None)
                     if next_valid is not None:
                         current_original_index = next_valid
                         _, current_end_point = geom_points[current_original_index]
                         optimized_result.append((simple_geometries[current_original_index], False))
                         remaining_original_indices.remove(current_original_index)
                         processed_indices.add(current_original_index)
                     else:
                         break # No more valid points to continue from

            else:
                # No nearest geometry found among remaining valid ones (shouldn't happen if valid_remaining_indices is not empty)
                print(f"Warning: Could not find a nearest geometry among {len(valid_remaining_indices)} valid remaining options.")
                break # Exit optimization loop

        # Add any remaining geometries (those initially invalid or skipped) in their original order
        for i in original_indices:
             if i not in processed_indices:
                 optimized_result.append((simple_geometries[i], False))

        return optimized_result


    def _merge_close_geometries(self, ordered_simple_geometries, tolerance):
        """
        EXPERIMENTAL/PLACEHOLDER: Attempts to merge *simple* geometries (LineStrings)
        where the end of one is close to the start of the next.

        Args:
            ordered_simple_geometries (list): List of (geometry, reverse_flag) tuples
                                              containing Points or LineStrings.
            tolerance (float): The maximum distance between endpoints to consider merging.

        Returns:
            list: A potentially modified list of (geometry, reverse_flag) tuples.
                  Currently returns the input list unmodified.
        """
        print(f"--- Attempting to merge paths with tolerance {tolerance} (EXPERIMENTAL) ---")
        if tolerance is None or tolerance <= 0 or len(ordered_simple_geometries) < 2:
            return ordered_simple_geometries

        # Placeholder - Actual merging requires modifying geometries or SVG path data.
        print("--- WARNING: Path merging is complex and not fully implemented. Returning unmerged list. ---")
        merged_geometries = ordered_simple_geometries

        return merged_geometries


    def add_gdf(self, gdf, optimize_order=False, merge_close_paths=False, merge_tolerance=None):
        """
        Adds geometries from a GeoDataFrame to the SVG composer. Flattens complex
        geometries before applying optional optimization and merging.

        Args:
            gdf (geopandas.GeoDataFrame): The GeoDataFrame containing geometries.
            optimize_order (bool): If True, applies nearest-neighbor path order
                                   optimization (including path reversal) to the
                                   *flattened* simple geometries within this GDF. Defaults to False.
            merge_close_paths (bool): If True, attempts to merge *flattened* paths where the
                                      end of one is within `merge_tolerance` of the
                                      start of the next (EXPERIMENTAL). Defaults to False.
            merge_tolerance (float, optional): The distance threshold for merging paths
                                               if `merge_close_paths` is True.
        """
        print(f"\nProcessing GDF: optimize_order={optimize_order}, merge_close_paths={merge_close_paths}, merge_tolerance={merge_tolerance}")
        print(f"Initial element count: {len(self.element_strings)}")

        # --- Flatten geometries from the GDF into simple components ---
        all_simple_geometries = []
        print("Flattening geometries...")
        for idx, geom in enumerate(gdf.geometry):
            # Use deepcopy to avoid modifying original GDF geometries during flattening/processing
            flattened = flatten_geometry(copy.deepcopy(geom))
            all_simple_geometries.extend(flattened)

        if not all_simple_geometries:
            print("No valid simple geometries found after flattening this GDF.")
            return self
        print(f"Found {len(all_simple_geometries)} simple geometries after flattening.")

        # --- Determine the processing order for simple geometries ---
        ordered_simple_geoms_with_flags = [] # List of (simple_geometry, reverse_flag)
        if optimize_order:
            print("Optimizing order for simple geometries in this group...")
            ordered_simple_geoms_with_flags = self._optimize_geometry_order(all_simple_geometries)
            print(f"Order optimization complete. Resulting sequence length: {len(ordered_simple_geoms_with_flags)}")
        else:
            print("Using original flattened geometry order for this group.")
            ordered_simple_geoms_with_flags = [(geom, False) for geom in all_simple_geometries]

        # --- Attempt merging if requested (EXPERIMENTAL) ---
        final_geometries_to_process = ordered_simple_geoms_with_flags
        if merge_close_paths:
             if merge_tolerance is None or merge_tolerance <= 0:
                 print("Warning: `merge_close_paths` is True, but `merge_tolerance` is not set or invalid. Skipping merge step.")
             else:
                 # This step currently returns the list unmodified
                 final_geometries_to_process = self._merge_close_geometries(ordered_simple_geoms_with_flags, merge_tolerance)


        # --- Generate SVG strings for the final list of simple geometries ---
        print(f"Generating SVG elements for {len(final_geometries_to_process)} simple geometry items...")
        count_elements_added_this_gdf = 0
        # Define tags for cleaning SVG output from geom.svg()
        drawable_tags = {'path', 'polygon', 'polyline', 'circle', 'rect', 'line'}
        attrs_to_remove = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-rule', 'transform']

        for geom, reverse_flag in final_geometries_to_process:
            # Reverse geometry if flagged by optimization (only affects LineStrings now)
            processed_geom = reverse_geom(geom) if reverse_flag else geom

            # Skip if geometry became invalid/empty during processing
            if processed_geom is None or processed_geom.is_empty:
                continue

            try:
                # Get SVG representation (should be simple now, e.g., <path> or <circle>)
                svg_repr = processed_geom.svg()
                if not svg_repr:
                    # Handle Points specifically if geom.svg() doesn't render them usefully
                    # if isinstance(processed_geom, Point):
                    #     x, y = processed_geom.coords[0]
                    #     svg_repr = f'<circle cx="{x}" cy="{y}" r="0.1" fill="none" stroke="black" stroke-width="0.1"/>' # Example dot
                    # else:
                        continue # Skip if no SVG representation

                # Parse the single element SVG string (might be wrapped in <g> by geom.svg())
                # Add namespace for robust parsing
                svg_fragment = f'<g xmlns="http://www.w3.org/2000/svg">{svg_repr}</g>'
                root = etree.fromstring(svg_fragment.encode('utf-8'))

                # Find the actual drawable element(s) - usually just one after flattening
                elements_in_geom = root.xpath(".//*[local-name()='path' or local-name()='polygon' or local-name()='polyline' or local-name()='circle' or local-name()='rect' or local-name()='line']")

                # Handle case where the root <g> *was* the element (e.g., geom.svg() returned just <path ... />)
                if not elements_in_geom:
                     tag_name = etree.QName(root.tag).localname
                     if tag_name in drawable_tags:
                         elements_in_geom = [root]

                # Clean and store each element string
                for element in elements_in_geom:
                    # Remove potentially conflicting attributes set by geom.svg()
                    for attr in attrs_to_remove:
                        if attr in element.attrib:
                            del element.attrib[attr]
                    # Convert element back to string
                    element_string = etree.tostring(element, encoding='unicode', pretty_print=False)
                    self.element_strings.append(element_string)
                    count_elements_added_this_gdf += 1

            except etree.XMLSyntaxError as e:
                print(f"Warning: XML Parsing Error for a simple geometry. SVG: '{svg_repr[:100]}...' Error: {e}")
            except Exception as e:
                print(f"Warning: Unexpected Error processing simple geometry. Type: {type(processed_geom)}. Error: {e}")

        print(f"Added {count_elements_added_this_gdf} SVG element strings from this GDF.")
        print(f"Total element count now: {len(self.element_strings)}")
        return self


    def apply_global_styles(self, start_color=None, end_color=None, stroke_width=None, fill=None):
        """
        Parses all accumulated SVG elements, applies interpolated stroke colors
        and other specified styles across them based on their final appended order.

        Args:
            start_color (str, optional): Start color (hex). Defaults to init param.
            end_color (str, optional): End color (hex). Defaults to init param.
            stroke_width (float, optional): Stroke width. Defaults to init param.
            fill (str, optional): Fill color. Defaults to init param.
        """
        print("\nApplying global styles to all accumulated element strings...")
        if not self.element_strings:
            print("No elements to style.")
            return self

        # --- Use provided styles or fall back to defaults ---
        current_start_color = start_color if start_color is not None else self.default_start_color
        current_end_color = end_color if end_color is not None else self.default_end_color
        current_stroke_width = stroke_width if stroke_width is not None else self.default_stroke_width
        current_fill = fill if fill is not None else self.default_fill

        start_rgb = hex_to_rgb(current_start_color)
        end_rgb = hex_to_rgb(current_end_color)

        total_elements = len(self.element_strings)
        styled_element_strings = []

        # --- Wrap all element strings for parsing ---
        all_elements_svg = '<root xmlns="http://www.w3.org/2000/svg">' + "".join(self.element_strings) + '</root>'

        try:
            root = etree.fromstring(all_elements_svg.encode('utf-8'))
            elements_to_style = root.xpath('./*') # Get direct children

            if len(elements_to_style) != total_elements:
                 print(f"Warning: Mismatch in element count during styling. Expected {total_elements}, found {len(elements_to_style)}. Styling based on found elements.")
                 total_elements = len(elements_to_style)

            if total_elements == 0:
                print("No elements found after parsing to apply styles.")
                return self

            print(f"Styling {total_elements} elements...")
            for i, element in enumerate(elements_to_style):
                t = i / (total_elements - 1) if total_elements > 1 else 0.0
                interpolated_rgb = lerp_color(t, start_rgb, end_rgb)
                interpolated_hex = rgb_to_hex(interpolated_rgb)

                element.set('stroke', interpolated_hex)
                element.set('fill', current_fill)
                element.set('stroke-width', str(current_stroke_width))

                styled_string = etree.tostring(element, encoding='unicode', pretty_print=False)
                styled_element_strings.append(styled_string)

            self.element_strings = styled_element_strings
            print("Global styles applied.")

        except etree.XMLSyntaxError as e:
            print(f"Error: Could not parse accumulated SVG elements for styling. Error: {e}")
        except Exception as e:
             print(f"Error: An unexpected error occurred during styling. Error: {e}")

        return self


    def generate_final_svg(self):
        """
        Generates the complete SVG string (header, elements, footer).
        Stores the result in self.final_svg.
        """
        print("\nGenerating final SVG structure...")
        header = f'''<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg width="{self.params['width_mm']}mm" height="{self.params['height_mm']}mm"
     viewBox="0 0 {self.params['width_mm']} {self.params['height_mm']}"
     xmlns="http://www.w3.org/2000/svg"
     style="background-color: white;">
'''
        elements_combined = "\n".join(["  " + el for el in self.element_strings])
        footer = "\n</svg>"
        self.final_svg = header + elements_combined + footer
        print("Final SVG generated.")
        return self


    def save_svg(self, filename):
        """
        Saves the generated final SVG content to a file.
        Ensures final SVG is generated if it hasn't been already.
        """
        if self.final_svg is None:
            print("Final SVG not generated yet, generating now...")
            self.generate_final_svg()

        if self.final_svg:
            try:
                with open(filename, 'w', encoding='utf-8') as f:
                    f.write(self.final_svg)
                print(f"SVG saved to {filename}")
            except IOError as e:
                print(f"Error saving SVG file: {e}")
        else:
            print("Error: No final SVG content available to save.")
        return self

# --- Example Usage (requires geopandas, shapely, numpy) ---
# import geopandas as gpd
# from shapely.geometry import Point, LineString, Polygon, MultiPolygon, MultiLineString

# # 1. Create sample geometries including multi-part
# # Layer 1: Text - No optimization
# line_T1 = LineString([(10, 70), (30, 70)])
# line_T2 = LineString([(20, 70), (20, 60)])
# gdf_text = gpd.GeoDataFrame({'id': ['T1', 'T2']}, geometry=[line_T1, line_T2], crs="EPSG:4326")

# # Layer 2: Fill - Optimize order (will flatten MultiLineString)
# poly_F1 = Polygon([(40, 10), (60, 10), (60, 30), (40, 30), (40, 10)])
# # MultiLineString - should be flattened into two lines for optimization
# mline_F2 = MultiLineString([((45, 40), (55, 50)), ((48, 45), (58, 55))])
# poly_F3 = Polygon([(70, 60), (90, 60), (90, 75), (70, 75), (70, 60)])
# line_F4 = LineString([(5, 5), (35, 35)])
# gdf_fill = gpd.GeoDataFrame({'id': ['F1', 'F2', 'F3', 'F4']}, geometry=[poly_F1, mline_F2, poly_F3, line_F4], crs="EPSG:4326")

# # Layer 3: Details - Optimize order and try merging (on flattened geoms)
# line_D1 = LineString([(75, 5), (85, 5)])
# line_D2 = LineString([(85.1, 5.1), (95, 5.1)]) # Start very close to D1 end
# line_D3 = LineString([(75, 15), (95, 15)]) # Separate line
# gdf_details = gpd.GeoDataFrame({'id': ['D1', 'D2', 'D3']}, geometry=[line_D1, line_D2, line_D3], crs="EPSG:4326")


# # 2. Define SVG parameters
# svg_params = {
#     'width_mm': 100,
#     'height_mm': 80,
#     'stroke_width': 0.3,
#     'fill': 'none',
#     'start_color': '#1f77b4', # Blue
#     'end_color': '#ff7f0e',   # Orange
# }

# # 3. Create SVG composer instance
# composer = SVG_composer(svg_params)

# # 4. Add layers with different options
# composer.add_gdf(gdf_text, optimize_order=False)
# composer.add_gdf(gdf_fill, optimize_order=True, merge_close_paths=False)
# composer.add_gdf(gdf_details, optimize_order=True, merge_close_paths=True, merge_tolerance=0.5)

# # 5. Apply global styling
# composer.apply_global_styles()

# # 6. Generate and Save
# composer.generate_final_svg()
# composer.save_svg("flattened_optimized.svg")
