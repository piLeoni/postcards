"""Write a multi-layer SVG from projected GeoDataFrames.

One SVG group per layer, with the group ``id`` carrying the layer name. That id
is the contract between this module, ``optimize.py`` (which maps ids to vpype
layer numbers) and ``export_gcode.py`` (which can write one G-code file per
layer).
"""

from __future__ import annotations

import io
import xml.etree.ElementTree as ET

import geopandas as gpd

from utils.gdf_ops import fully_flatten_gdf
from utils.gdf_optimizer import (
    extract_geometries,
    gdf_optimize_paths,
    merge_consecutive_paths_by_distance,
    merge_paths_by_distance,
    tsp_order,
)

STYLE = """
* {
  fill: none;
  stroke: black;
  stroke-width: 0.1;
}
"""

# Attributes shapely emits that must be stripped so the document style applies.
_STRIP_ATTRS = ("fill", "stroke", "stroke-width", "opacity")


class SVG_composer:
    """Accumulates geometry into named layers and writes one SVG."""

    def __init__(self, params: dict):
        self.params = params
        self.svg_root = ET.Element(
            "svg",
            width=f"{params['width_mm']}mm",
            height=f"{params['height_mm']}mm",
            viewBox=f"0 0 {params['width_mm']} {params['height_mm']}",
            xmlns="http://www.w3.org/2000/svg",
        )
        style = ET.SubElement(self.svg_root, "style")
        style.text = STYLE
        self.layers: dict[str, ET.Element] = {}

    def add_layer(self, layer_name: str) -> ET.Element:
        """Get the group for ``layer_name``, creating it on first use."""
        if layer_name not in self.layers:
            self.layers[layer_name] = ET.SubElement(self.svg_root, "g", id=layer_name)
        return self.layers[layer_name]

    def add_gdf_to_layer(self, gdf, layer_name: str, **kwargs) -> "SVG_composer":
        """Add a GeoDataFrame's geometries to ``layer_name``."""
        return self.add_gdf(gdf, layer_name=layer_name, **kwargs)

    def save_svg(self, filename) -> "SVG_composer":
        ET.ElementTree(self.svg_root).write(
            filename, encoding="utf-8", xml_declaration=True
        )
        return self

    def get_svg_string(self) -> str:
        """The SVG as a string, rather than written to a file."""
        buffer = io.StringIO()
        ET.ElementTree(self.svg_root).write(
            buffer, encoding="unicode", xml_declaration=True
        )
        return buffer.getvalue()

    def get_svg_tree(self) -> ET.ElementTree:
        return ET.ElementTree(self.svg_root)

    def get_layer_index(self, target_id: str) -> int | None:
        """1-based position of ``target_id`` among all ``<g id>`` groups."""
        index = 1
        for elem in self.svg_root.iter():
            if elem.tag.endswith("g") and "id" in elem.attrib:
                if elem.attrib["id"] == target_id:
                    return index
                index += 1
        return None

    def add_gdf(
        self,
        gdf,
        layer_name: str = "default",
        optimize_order=False,
        merge_close_paths=False,
        merge_tolerance: float = 0.5,
        min_length: float = 0,
    ) -> "SVG_composer":
        """Flatten, optionally reorder, and append geometries to a layer.

        ``optimize_order`` and ``merge_close_paths`` accept ``"Base"`` or
        ``"Advanced"``; both are off by default because vpype does this better
        downstream. They remain available for quick previews.
        """
        flat_geoms = extract_geometries(gdf)
        if not flat_geoms:
            print("empty gdf or no valid geometries found")
            return self

        gdf = fully_flatten_gdf(gpd.GeoDataFrame(geometry=flat_geoms, crs=getattr(gdf, "crs", None)))

        if optimize_order == "Base":
            gdf = tsp_order(gdf)
        elif optimize_order == "Advanced":
            gdf = gdf_optimize_paths(gdf)

        if merge_close_paths == "Base":
            gdf = merge_consecutive_paths_by_distance(gdf, merge_tolerance)
        elif merge_close_paths == "Advanced":
            gdf = merge_paths_by_distance(gdf, merge_tolerance)

        if min_length > 0:
            gdf = gdf[gdf.geometry.length >= min_length].copy()

        layer_group = self.add_layer(layer_name)

        for geom in gdf.geometry:
            if geom is None or geom.is_empty:
                continue
            element = ET.fromstring(geom.svg())
            for attr in _STRIP_ATTRS:
                element.attrib.pop(attr, None)
            layer_group.append(element)

        return self
