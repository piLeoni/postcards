#!/usr/bin/env python3
"""
Standalone script for optimizing SVG layers with vpype.
Can be run with command line arguments or JSON configuration.
Supports parallel processing of layers.
"""

import argparse
import json
import subprocess
import tempfile
import os
import sys
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
import xml.etree.ElementTree as ET
import re


class LayerOptimizer:
    def __init__(self, input_svg, output_svg):
        self.input_svg = input_svg
        self.output_svg = output_svg
        self.temp_dir = tempfile.mkdtemp()
    
    def get_default_configs(self):
        """Get universal default optimization configuration for any layer"""
        return {
            "linemerge": True,
            "linemerge_tolerance": 0.1,
            "linesort": True,
            "reloop": True,
            "snap": True,
            "snap_tolerance": 0.1,
            "simplify": True,
            "simplify_tolerance": 0.1,
            "filter": True,
            "min_length": 0.1
        }
    
    def get_layers_from_svg(self):
        """Extract layer names from the input SVG"""
        try:
            tree = ET.parse(self.input_svg)
            root = tree.getroot()
            layers = []
            print(f"Debug: Looking for layers in SVG with root tag: {root.tag}")
            ns = {'svg': 'http://www.w3.org/2000/svg'}
            for layer in root.findall('.//svg:g[@id]', ns):
                layer_id = layer.get('id')
                print(f"Debug: Found layer with id: {layer_id}")
                layers.append(layer_id)
            print(f"Debug: Total layers found: {len(layers)}")
            return layers
        except Exception as e:
            print(f"Error reading SVG: {e}")
            return []
    
    def optimize_layer(self, layer_name, config):
        """Optimize a single layer using vpype, using in-memory pipes."""
        print(f"Optimizing layer: {layer_name}")
        
        # Extract the specific layer from the SVG as a string
        svg_content = self._extract_layer_svg_string(layer_name)
        if svg_content is None:
            print(f"Debug: No SVG content for layer {layer_name}, skipping.")
            return layer_name, None, f"No SVG content for layer {layer_name}"
        
        # Build vpype command (no file IO)
        cmd = self._build_vpype_command('-', '-', config)  # '-' means stdin/stdout for vpype
        print(f"Running command: {' '.join(cmd)}")
        
        try:
            # Run vpype with pipes
            result = subprocess.run(cmd, input=svg_content, capture_output=True, text=True, check=True)
            print(f"Vpype stdout length: {len(result.stdout)}")
            optimized_svg = result.stdout
            return layer_name, optimized_svg, None
        except subprocess.CalledProcessError as e:
            print(f"Vpype stderr: {e.stderr}")
            return layer_name, None, f"Vpype optimization failed for layer {layer_name}: {e.stderr}"

    def _extract_layer_svg_string(self, layer_name):
        """Extract a specific layer from the SVG and return as SVG string."""
        try:
            print(f"Debug: Extracting layer '{layer_name}' as string")
            tree = ET.parse(self.input_svg)
            root = tree.getroot()
            ns = {'svg': 'http://www.w3.org/2000/svg'}
            layer_element = root.find(f".//svg:g[@id='{layer_name}']", ns)
            if layer_element is None:
                print(f"Debug: Layer '{layer_name}' not found in SVG, returning empty SVG string")
                return f'''<?xml version="1.0" encoding="UTF-8"?>\n<svg width="1000mm" height="1000mm" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">\n  <g id="{layer_name}"></g>\n</svg>'''
            # Create a new SVG with just this layer
            new_root = ET.Element('svg', 
                width=root.get('width', '1000mm'),
                height=root.get('height', '1000mm'),
                viewBox=root.get('viewBox', '0 0 1000 1000'),
                xmlns="http://www.w3.org/2000/svg"
            )
            for style in root.findall('.//svg:style', ns):
                new_root.append(style)
            new_root.append(layer_element)
            return ET.tostring(new_root, encoding='unicode')
        except Exception as e:
            print(f"Error extracting layer {layer_name}: {e}")
            import traceback
            traceback.print_exc()
            return None

    def _build_vpype_command(self, input_file, output_file, config):
        """Build the vpype command based on configuration"""
        cmd = ["vpype"]
        cmd.extend(["read", input_file])
        if config.get("linemerge", False):
            cmd.extend(["linemerge", "--tolerance", str(config.get("linemerge_tolerance", 0.1))])
        if config.get("linesort", False):
            cmd.extend(["linesort"])
        if config.get("reloop", False):
            cmd.extend(["reloop"])
        if config.get("snap", False):
            snap_tolerance = config.get("snap_tolerance", 0.1)
            cmd.extend(["snap", f"{snap_tolerance}mm"])
        if config.get("simplify", False):
            cmd.extend(["linesimplify", "--tolerance", f"{config.get('simplify_tolerance', 0.1)}mm"])
        if config.get("filter", False):
            min_length = config.get("min_length", 0.1)
            cmd.extend(["filter", "--min-length", f"{min_length}mm"])
        # Remove --precision, only use --format if output_file == '-'
        if output_file == '-':
            cmd.extend(["write", "--format", "svg", output_file])
        else:
            cmd.extend(["write", output_file])
        print(f"[DEBUG] Running command: {' '.join(cmd)}")
        return cmd

    def px_to_mm(self, px):
        """Convert px to mm (1 px = 25.4/96 mm)"""
        return float(px) * 25.4 / 96

    def convert_svg_px_to_mm(self, svg_path):
        """Post-process SVG file: convert all coordinates and attributes from px to mm, and set width/height/viewBox in mm."""
        tree = ET.parse(svg_path)
        root = tree.getroot()
        # Set width/height in mm
        width_px = float(re.sub(r'[^0-9.]+', '', root.get('width', '1000')))
        height_px = float(re.sub(r'[^0-9.]+', '', root.get('height', '1000')))
        width_mm = self.px_to_mm(width_px)
        height_mm = self.px_to_mm(height_px)
        root.set('width', f'{width_mm:.6f}mm')
        root.set('height', f'{height_mm:.6f}mm')
        # Set viewBox in mm
        if 'viewBox' in root.attrib:
            vb = [float(x) for x in root.attrib['viewBox'].split()]
            vb_mm = [self.px_to_mm(x) for x in vb]
            root.set('viewBox', ' '.join(f'{x:.6f}' for x in vb_mm))
        # Convert geometry attributes
        for elem in root.iter():
            for attr in ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height']:
                if attr in elem.attrib:
                    try:
                        elem.attrib[attr] = f'{self.px_to_mm(float(elem.attrib[attr])):.6f}'
                    except Exception:
                        pass
            # Convert points in polyline/polygon
            if elem.tag in ['polyline', 'polygon'] and 'points' in elem.attrib:
                pts = elem.attrib['points'].strip().split()
                new_pts = []
                for pt in pts:
                    coords = pt.split(',')
                    if len(coords) == 2:
                        try:
                            x = self.px_to_mm(float(coords[0]))
                            y = self.px_to_mm(float(coords[1]))
                            new_pts.append(f'{x:.6f},{y:.6f}')
                        except Exception:
                            new_pts.append(pt)
                    else:
                        new_pts.append(pt)
                elem.attrib['points'] = ' '.join(new_pts)
            # Convert path d attribute
            if elem.tag == 'path' and 'd' in elem.attrib:
                elem.attrib['d'] = self.convert_path_d_px_to_mm(elem.attrib['d'])
        tree.write(svg_path, encoding='utf-8', xml_declaration=True)

    def convert_path_d_px_to_mm(self, d):
        """Convert all numbers in a path d string from px to mm."""
        def repl(m):
            return str(round(self.px_to_mm(float(m.group())), 6))
        return re.sub(r'(?<![a-zA-Z])-?\d*\.?\d+', repl, d)

    def combine_optimized_layers(self, optimized_results):
        """Combine optimized layers back into the main SVG, creating clean SVG without namespace prefixes and restoring original viewBox, width, and height. Robustly extract geometry from any group or root in vpype output. Then convert all px to mm."""
        # Parse the original SVG to get the base structure
        tree = ET.parse(self.input_svg)
        root = tree.getroot()
        
        # Create a new clean SVG root without namespace prefixes
        new_root = ET.Element('svg')
        # Copy all attributes from the original root, especially viewBox, width, height
        for key, value in root.attrib.items():
            new_root.set(key, value)
        # If any of these are missing, set defaults
        if 'width' not in new_root.attrib:
            new_root.set('width', '1000mm')
        if 'height' not in new_root.attrib:
            new_root.set('height', '1000mm')
        if 'viewBox' not in new_root.attrib:
            new_root.set('viewBox', '0 0 1000 1000')
        
        # Copy all non-layer elements (like styles) from the original
        ns = {'svg': 'http://www.w3.org/2000/svg'}
        for child in root:
            if child.tag == '{http://www.w3.org/2000/svg}style':
                # Copy style without namespace
                new_style = ET.Element('style')
                new_style.text = child.text
                new_root.append(new_style)
            elif child.tag == '{http://www.w3.org/2000/svg}g' and child.get('id'):
                # This is a layer - we'll handle it below
                pass
            else:
                # Copy other elements without namespace
                tag_name = child.tag.split('}')[-1] if '}' in child.tag else child.tag
                new_elem = ET.Element(tag_name)
                for key, value in child.attrib.items():
                    new_elem.set(key, value)
                new_elem.text = child.text
                new_root.append(new_elem)
        
        # Process optimized layers
        for layer_name, optimized_svg, error in optimized_results:
            if error is not None:
                print(f"Warning: {error}")
                continue
            
            try:
                # Parse the optimized SVG
                optimized_root = ET.fromstring(optimized_svg)
                
                # Create a new group for this layer
                new_group = ET.Element('g', id=layer_name)
                
                # Find all geometry elements in the optimized SVG and copy them without namespace
                geometry_tags = ['{http://www.w3.org/2000/svg}path', '{http://www.w3.org/2000/svg}polyline', '{http://www.w3.org/2000/svg}line']
                found = 0
                # 1. Look for geometry directly under the root
                for tag in geometry_tags:
                    for elem in optimized_root.findall(f'.//{tag}'):
                        tag_name = elem.tag.split('}')[-1]
                        new_elem = ET.Element(tag_name)
                        for key, value in elem.attrib.items():
                            new_elem.set(key, value)
                        new_elem.text = elem.text
                        new_group.append(new_elem)
                        found += 1
                # 2. Look for geometry in any <g> group (not just by id)
                for g in optimized_root.findall('.//{http://www.w3.org/2000/svg}g'):
                    for tag in geometry_tags:
                        for elem in g.findall(f'.//{tag}'):
                            tag_name = elem.tag.split('}')[-1]
                            new_elem = ET.Element(tag_name)
                            for key, value in elem.attrib.items():
                                new_elem.set(key, value)
                            new_elem.text = elem.text
                            new_group.append(new_elem)
                            found += 1
                print(f"[DEBUG] Layer '{layer_name}': found {found} geometry elements in optimized SVG.")
                if found == 0:
                    print(f"[DEBUG] Layer '{layer_name}': No geometry found in optimized SVG! Check vpype output.")
                new_root.append(new_group)
                
            except ET.ParseError as e:
                print(f"Warning: Could not parse optimized SVG for layer '{layer_name}': {e}")
        
        # Write the new SVG
        new_tree = ET.ElementTree(new_root)
        new_tree.write(self.output_svg, encoding='utf-8', xml_declaration=True)
        # Post-process: convert px to mm
        print('[DEBUG] Post-processing SVG to convert px to mm...')
        self.convert_svg_px_to_mm(self.output_svg)
    
    def optimize_layers_parallel(self, layer_configs, max_workers=None):
        """Optimize multiple layers in parallel"""
        print(f"Starting parallel optimization of {len(layer_configs)} layers...")
        
        with ProcessPoolExecutor(max_workers=max_workers) as executor:
            # Submit optimization tasks
            future_to_layer = {
                executor.submit(self.optimize_layer, layer_name, config): layer_name
                for layer_name, config in layer_configs.items()
            }
            
            # Collect results
            results = []
            for future in as_completed(future_to_layer):
                layer_name = future_to_layer[future]
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    print(f"Error optimizing layer {layer_name}: {e}")
                    results.append((layer_name, None, str(e)))
        
        return results
    
    def cleanup(self):
        """Clean up temporary directory"""
        import shutil
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)


def load_config_from_json(config_file):
    """Load optimization configuration from JSON file"""
    with open(config_file, 'r') as f:
        return json.load(f)


def main():
    parser = argparse.ArgumentParser(description="Optimize SVG layers with vpype")
    parser.add_argument("input_svg", help="Input SVG file")
    parser.add_argument("output_svg", help="Output SVG file")
    parser.add_argument("--layers", nargs="+", help="Specific layers to optimize")
    parser.add_argument("--config", help="JSON configuration file")
    parser.add_argument("--parallel", action="store_true", help="Enable parallel processing")
    parser.add_argument("--workers", type=int, default=None, help="Number of parallel workers")
    parser.add_argument("--list-layers", action="store_true", help="List available layers and exit")
    # Config options
    parser.add_argument("--linemerge", action="store_true", help="Enable linemerge")
    parser.add_argument("--linemerge_tolerance", type=float, help="Linemerge tolerance (mm)")
    parser.add_argument("--linesort", action="store_true", help="Enable linesort")
    parser.add_argument("--reloop", action="store_true", help="Enable reloop")
    parser.add_argument("--snap", action="store_true", help="Enable snap")
    parser.add_argument("--snap_tolerance", type=float, help="Snap tolerance (mm)")
    parser.add_argument("--simplify", action="store_true", help="Enable linesimplify")
    parser.add_argument("--simplify_tolerance", type=float, help="Linesimplify tolerance (mm)")
    parser.add_argument("--filter", action="store_true", help="Enable filter by min length")
    parser.add_argument("--min_length", type=float, help="Minimum length for filter (mm)")
    
    args = parser.parse_args()
    
    # Check if input file exists
    if not os.path.exists(args.input_svg):
        print(f"Error: Input file {args.input_svg} does not exist")
        sys.exit(1)
    
    optimizer = LayerOptimizer(args.input_svg, args.output_svg)
    
    # List layers if requested
    if args.list_layers:
        layers = optimizer.get_layers_from_svg()
        print("Available layers:")
        for layer in layers:
            print(f"  - {layer}")
        sys.exit(0)
    
    available_layers = optimizer.get_layers_from_svg()
    if not available_layers:
        print("No layers found in SVG.")
        sys.exit(1)

    # Determine if any CLI config options are set
    cli_config_keys = [
        'linemerge', 'linemerge_tolerance', 'linesort', 'reloop', 'snap', 'snap_tolerance',
        'simplify', 'simplify_tolerance', 'filter', 'min_length'
    ]
    cli_config = {k: getattr(args, k) for k in cli_config_keys if getattr(args, k) is not None}
    cli_config_used = any(
        getattr(args, k) is not None and not (isinstance(getattr(args, k), bool) and getattr(args, k) is False)
        for k in cli_config_keys
    )

    # Load configuration
    layer_configs = {}
    if args.config:
        if cli_config_used:
            print("Warning: --config provided, ignoring all CLI config options.")
        config_data = load_config_from_json(args.config)
        # If --layers is given, only consider those layers
        if args.layers:
            for layer in args.layers:
                if layer in available_layers:
                    if layer in config_data:
                        layer_configs[layer] = config_data[layer]
                    else:
                        print(f"Warning: Layer '{layer}' not found in config file, skipping.")
                else:
                    print(f"Warning: Layer '{layer}' not found in SVG, skipping.")
        else:
            # No --layers: optimize all layers present in both SVG and config
            for layer in available_layers:
                if layer in config_data:
                    layer_configs[layer] = config_data[layer]
    elif cli_config_used:
        # Use CLI config for all requested or available layers
        config_for_all = {}
        # Only set keys that were actually provided
        for k in cli_config_keys:
            v = getattr(args, k)
            if v is not None:
                config_for_all[k] = v
        if args.layers:
            for layer in args.layers:
                if layer in available_layers:
                    layer_configs[layer] = config_for_all.copy()
                else:
                    print(f"Warning: Layer '{layer}' not found in SVG, skipping.")
        else:
            for layer in available_layers:
                layer_configs[layer] = config_for_all.copy()
    else:
        # No config file and no CLI config: use universal default config
        default_config = optimizer.get_default_configs()
        if args.layers:
            for layer in args.layers:
                if layer in available_layers:
                    layer_configs[layer] = default_config.copy()
                else:
                    print(f"Warning: Layer '{layer}' not found in SVG, skipping.")
        else:
            # No --layers: optimize all layers in SVG with default config
            for layer in available_layers:
                layer_configs[layer] = default_config.copy()

    if not layer_configs:
        print("No layers to optimize.")
        sys.exit(1)
    
    print(f"Optimizing layers: {list(layer_configs.keys())}")
    
    # Optimize layers
    if args.parallel:
        results = optimizer.optimize_layers_parallel(layer_configs, args.workers)
    else:
        results = []
        for layer_name, config in layer_configs.items():
            result = optimizer.optimize_layer(layer_name, config)
            results.append(result)
    
    # Combine results
    optimizer.combine_optimized_layers(results)
    
    # Cleanup
    optimizer.cleanup()
    
    print(f"Optimization complete. Output saved to: {args.output_svg}")


if __name__ == "__main__":
    main() 