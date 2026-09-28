"""The plot config is the pipeline's single source of truth."""

from __future__ import annotations

import pytest

from postcards.utils.plot_config import (
    expand_feed_placeholders,
    feeds_section,
    gwrite_plotter,
    layers_section,
    optimize_section,
    placement_section,
)


def test_every_configured_layer_is_complete(plot_config):
    pipelines = layers_section(plot_config)
    assert pipelines, "config defines no layer pipelines"

    known = {"snap", "linesimplify", "linemerge", "filter", "deoverlap", "linesort"}
    for name, ops in pipelines.items():
        assert ops, f"{name} has an empty op list"
        for op in ops:
            assert "name" in op, f"{name}: op without a name"
            assert op["name"] in known, f"{name}: unknown op {op['name']!r}"


def test_layer_ops_never_use_deduplicate(plot_config):
    """Prefer corridor ``deoverlap``; never the coarse endpoint ``deduplicate``."""
    for name, ops in layers_section(plot_config).items():
        assert all(op["name"] != "deduplicate" for op in ops), name


def test_stroke_layers_use_deoverlap(plot_config):
    """Near-coincident strokes are cleaned; dab / dash layers are left alone."""
    pipelines = layers_section(plot_config)
    for name in (
        "roads_outlines",
        "buildings_outlines",
        "buildings_filling",
        "water_outlines",
    ):
        ops = [op["name"] for op in pipelines[name]]
        assert "deoverlap" in ops, name
    # Park outlines are pre-dashed geometry; merging/deoverlapping would fuse
    # the gaps back into a solid fence. Park dots are independent dabs.
    for name in ("parks_outlines", "parks_filling"):
        ops = [op["name"] for op in pipelines[name]]
        assert "deoverlap" not in ops, name
        assert "linemerge" not in ops, name


def test_fill_layers_are_configured_for_their_texture(plot_config):
    """Dots and waves must not be linemerged; that stitches marks into streaks."""
    pipelines = layers_section(plot_config)
    for name in ("parks_filling", "water_filling"):
        ops = [op["name"] for op in pipelines[name]]
        assert "linemerge" not in ops, f"{name} should not linemerge"
    # Park dots are ~0.2mm dabs; a 0.15mm filter would erase short marks.
    assert "filter" not in [op["name"] for op in pipelines["parks_filling"]]
    # Dashed park outlines still filter crumbs, but never merge the dashes.
    assert "filter" in [op["name"] for op in pipelines["parks_outlines"]]
    assert "linemerge" not in [op["name"] for op in pipelines["parks_outlines"]]


def test_fill_and_stroke_sections_are_declared(plot_config):
    """Theme styling knobs live in the profile, not buried in filter constants."""
    from postcards.utils.plot_config import fill_section, stroke_section

    buildings = fill_section(plot_config, "buildings")
    assert buildings["algorithm"] == "zigzag"

    parks = fill_section(plot_config, "parks")
    assert parks["algorithm"] == "dots"
    kinds = parks["kinds"]
    assert isinstance(kinds["garden"], dict)
    assert kinds["garden"]["spacing"] < kinds["wood"]["spacing"]

    water = fill_section(plot_config, "water")
    assert water["algorithm"] == "waves"

    assert stroke_section(plot_config, "parks")["style"] == "dash"
    assert stroke_section(plot_config, "water")["style"] == "solid"


def test_feeds_expand_into_gwrite_templates(plot_config):
    plotter = gwrite_plotter(plot_config)
    feeds = feeds_section(plot_config)

    segment = plotter["segment"]
    assert "$" not in segment, f"unexpanded placeholder in segment: {segment!r}"
    assert str(feeds["draw_xy"]) in segment
    # vpype's own coordinate slots must survive expansion untouched.
    assert "{x" in segment


def test_unknown_placeholders_are_left_alone():
    text = expand_feed_placeholders("F$draw_xy {x:.4f} $nope", {"draw_xy": 3500})
    assert text == "F3500 {x:.4f} $nope"


def test_sections_have_expected_defaults(base_params):
    assert base_params["width_mm"] == pytest.approx(152.4, abs=0.1)
    assert base_params["height_mm"] == pytest.approx(101.6, abs=0.1)


def test_placement_defines_a_bed_that_matches_the_machine(plot_config):
    placement = placement_section(plot_config)
    assert placement["bed_width_mm"] == 200.0
    assert placement["bed_height_mm"] == 140.0
    assert placement["origin_y_mm"] == 140.0


def test_gcode_section_defaults_and_chain_modes(plot_config):
    from postcards.utils.plot_config import gcode_section

    job = gcode_section(plot_config)
    assert job["by_layer"] is True
    assert job["max_lines_per_file"] == 8000
    assert job["chain"] == "all"


def test_gcode_section_reads_legacy_placement_keys(tmp_path):
    from postcards.utils.plot_config import gcode_section

    cfg = {
        "placement": {
            "split_layers": False,
            "max_lines_per_file": 1000,
            "chain_parts": False,
        }
    }
    job = gcode_section(cfg)
    assert job["by_layer"] is False
    assert job["max_lines_per_file"] == 1000
    assert job["chain"] == "none"


def test_deoverlap_op_builds_vpype_args(plot_config):
    """Corridor deoverlap is wired into the optimize CLI builder."""
    from postcards.optimize import _op_args

    defaults = optimize_section(plot_config)
    args = _op_args(
        {
            "name": "deoverlap",
            "tolerance": "0.1mm",
            "prefer": "longest",
            "angle": 30,
            "min_length": "0.05mm",
            "self_overlap": True,
        },
        defaults,
        layer=3,
    )
    assert args[:3] == ["deoverlap", "-l", "3"]
    assert "-t" in args and "0.1mm" in args
    assert "--prefer" in args and "longest" in args
    assert "--angle" in args and "30" in args
    assert "-m" in args and "0.05mm" in args
    assert "--self-overlap" in args
