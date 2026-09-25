"""The plot config is the pipeline's single source of truth."""

from __future__ import annotations

import pytest

from utils.plot_config import (
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

    known = {"snap", "linesimplify", "linemerge", "filter", "linesort"}
    for name, ops in pipelines.items():
        assert ops, f"{name} has an empty op list"
        for op in ops:
            assert "name" in op, f"{name}: op without a name"
            assert op["name"] in known, f"{name}: unknown op {op['name']!r}"


def test_layer_ops_never_use_deduplicate(plot_config):
    """vpype `deduplicate` ignores -l and merges all layers into layer 1."""
    for name, ops in layers_section(plot_config).items():
        assert all(op["name"] != "deduplicate" for op in ops), name


def test_fill_layers_are_configured_for_their_texture(plot_config):
    """Dots and waves must not be linemerged; that stitches marks into streaks."""
    pipelines = layers_section(plot_config)
    for name in ("parks_filling", "water_filling"):
        ops = [op["name"] for op in pipelines[name]]
        assert "linemerge" not in ops, f"{name} should not linemerge"


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


def test_optimize_defaults_are_present(plot_config):
    optimize = optimize_section(plot_config)
    for key in ("trim", "penwidth", "snap", "simplify", "filter_min"):
        assert key in optimize, key
