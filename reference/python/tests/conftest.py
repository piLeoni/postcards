"""Shared fixtures and helpers for the test suite."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Tests import the project modules directly, so the repo root must be importable
# whether or not the package was installed.
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

CONFIG = ROOT / "configs" / "fluidnc.toml"

# A real Berkeley, CA location used across the geometry tests.
BERKELEY = {"lng": -122.256196, "lat": 37.8771145}


@pytest.fixture
def base_params():
    """Minimal params for a 6x4 inch card at 1:10000."""
    from postcards.utils.generate_bounds import generate_bounds, generate_rectangle_polygon
    from postcards.utils.plot_config import load_plot_config, map_section

    cfg = load_plot_config(CONFIG)
    section = map_section(cfg)
    params = {
        "center_coords": [BERKELEY["lng"], BERKELEY["lat"]],
        "width_mm": 152.4,
        "height_mm": 101.6,
        "scale": str(section.get("scale", "1:10000")),
        "bearing": 0,
        "projection": "utm",
        "output": "unused.svg",
        "padding": 3,
        "address": None,
        "config": CONFIG,
    }
    params["polygon"] = generate_rectangle_polygon(params)
    params["bounds"] = generate_bounds(params)
    return params


@pytest.fixture
def plot_config():
    from postcards.utils.plot_config import load_plot_config

    return load_plot_config(CONFIG)
