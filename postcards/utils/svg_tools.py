"""Write a multi-layer SVG from projected GeoDataFrames.

One SVG group per layer, with the group ``id`` carrying the layer name. That id
is the contract between this module, ``optimize`` (which maps ids to vpype layer
numbers) and ``export_gcode`` (which writes one G-code file per layer).

This module deliberately does no path optimisation. Merging, sorting and
simplifying happen in vpype, driven by the ``[layers.*]`` pipelines in the plot
config. Duplicating that work here would only let the two disagree.
"""

from __future__ import annotations

import io
import xml.etree.ElementTree as ET

import geopandas as gpd
import shapely

STYLE = """
* {
  fill: none;
  stroke: black;
  stroke-width: 0.1;
}
"""

# Attributes shapely puts on each element that must be stripped, so the document
# style above is what actually applies.
_STRIP_ATTRS = ("fill", "stroke", "stroke-width", "opacity")

SVG_NS = "http://www.w3.org/2000/svg"


class SVG_composer:
    """Accumulates geometry into named layers and writes one SVG."""

    def __init__(self, params: dict):
        self.params = params
        self.svg_root = ET.Element(
            "svg",
            width=f"{params['width_mm']}mm",
            height=f"{params['height_mm']}mm",
            viewBox=f"0 0 {params['width_mm']} {params['height_mm']}",
            xmlns=SVG_NS,
        )
        style = ET.SubElement(self.svg_root, "style")
        style.text = STYLE
        self.layers: dict[str, ET.Element] = {}

    def add_layer(self, layer_name: str) -> ET.Element:
        """Get the group for ``layer_name``, creating it on first use."""
        if layer_name not in self.layers:
            self.layers[layer_name] = ET.SubElement(self.svg_root, "g", id=layer_name)
        return self.layers[layer_name]

    def add_gdf_to_layer(self, gdf, layer_name: str) -> "SVG_composer":
        """Add a GeoDataFrame's geometries to ``layer_name``."""
        return self.add_gdf(gdf, layer_name=layer_name)

    def add_gdf(self, gdf, layer_name: str = "default") -> "SVG_composer":
        """Append each geometry in ``gdf`` to a layer as an SVG element.

        Every geometry type shapely can serialise is accepted. Empty and
        unparseable geometries are skipped rather than aborting the layer.
        """
        layer_group = self.add_layer(layer_name)
        for geom in iter_geometries(gdf):
            if geom is None or geom.is_empty:
                continue
            try:
                element = ET.fromstring(geom.svg())
            except ET.ParseError:
                continue
            for attr in _STRIP_ATTRS:
                element.attrib.pop(attr, None)
            layer_group.append(element)
        return self

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
        """1-based position of ``target_id`` among all ``<g id>`` groups.

        Matches how vpype numbers layers.
        """
        index = 1
        for elem in self.svg_root.iter():
            if elem.tag.endswith("g") and "id" in elem.attrib:
                if elem.attrib["id"] == target_id:
                    return index
                index += 1
        return None


def iter_geometries(source) -> list:
    """Pull a flat list of Shapely geometries out of almost anything.

    Accepts a GeoDataFrame, a GeoSeries, a bare geometry, or a list (nested to
    any depth) of those. Anything unrecognised is ignored.
    """
    if source is None:
        return []
    if isinstance(source, gpd.GeoDataFrame):
        return [g for g in source.geometry if g is not None]
    if isinstance(source, gpd.GeoSeries):
        return [g for g in source if g is not None]
    if isinstance(source, (list, tuple, set)):
        geoms = []
        for item in source:
            geoms.extend(iter_geometries(item))
        return geoms
    if isinstance(source, shapely.geometry.base.BaseGeometry):
        return [source]
    return []
