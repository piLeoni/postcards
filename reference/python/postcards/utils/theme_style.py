"""Resolve theme fill / stroke styling from the plot profile.

Themes still decide *what* geometry exists in code; this module decides *how*
that geometry is drawn, reading ``[fill.<theme>]`` and ``[stroke.<theme>]``.
"""

from __future__ import annotations

from typing import Any

from shapely.geometry import LineString

from postcards.utils.fills import get_fill
from postcards.utils.patterns.dash import dash_geometry
from postcards.utils.plot_config import (
    fill_options,
    fill_section,
    load_plot_config,
    parse_mm,
    stroke_section,
)


def _cfg(params: dict) -> dict[str, Any] | None:
    path = params.get("config")
    if not path:
        return None
    try:
        return load_plot_config(path)
    except FileNotFoundError:
        return None


def theme_fill_settings(params: dict, theme: str, defaults: dict[str, Any] | None = None) -> dict[str, Any]:
    """Merged ``[fill.<theme>]`` settings, with profile values winning."""
    out = dict(defaults or {})
    cfg = _cfg(params)
    if cfg is None:
        return out
    section = fill_section(cfg, theme)
    if not section:
        return out
    out.update(section)
    return out


def theme_fill_kinds(
    params: dict,
    theme: str,
    defaults: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Per-kind fill settings from ``[fill.<theme>.kinds.<name>]``.

    Each kind inherits the theme-level ``[fill.<theme>]`` knobs, then applies
    its own overrides. A bare ``garden = "0.25mm"`` in the profile is treated
    as ``{spacing = 0.25}`` so existing shorthand still works; a full table
    can set ``algorithm``, ``angle``, ``mark``, … independently per kind.
    """
    theme_settings = theme_fill_settings(params, theme)
    theme_settings.pop("kinds", None)
    theme_settings.pop("leftover", None)

    profile_kinds: dict[str, Any] = {}
    cfg = _cfg(params)
    if cfg is not None:
        section = fill_section(cfg, theme)
        raw = section.get("kinds") if section else None
        if isinstance(raw, dict):
            profile_kinds = raw

    out: dict[str, dict[str, Any]] = {}
    names = list(defaults.keys())
    for name in profile_kinds:
        if name not in names:
            names.append(str(name))

    for name in names:
        merged = dict(theme_settings)
        if name in defaults:
            merged.update(defaults[name])
        entry = profile_kinds.get(name)
        if isinstance(entry, dict):
            merged.update(entry)
        elif entry is not None:
            merged["spacing"] = float(entry) if isinstance(entry, (int, float)) else parse_mm(entry)
        out[str(name)] = merged
    return out


def theme_stroke_settings(params: dict, theme: str, defaults: dict[str, Any] | None = None) -> dict[str, Any]:
    """Merged ``[stroke.<theme>]`` settings."""
    out = dict(defaults or {})
    cfg = _cfg(params)
    if cfg is None:
        return out
    section = stroke_section(cfg, theme)
    if not section:
        return out
    out.update(section)
    return out


def fill_options_for(params: dict, theme: str, algorithm: str, settings: dict[str, Any]) -> dict[str, Any]:
    """Per-algorithm options, plus theme-level extras (mark, connector, …)."""
    options: dict[str, Any] = {}
    cfg = _cfg(params)
    if cfg is not None:
        options.update(fill_options(cfg, theme, algorithm))
    skip = {"algorithm", "spacing", "angle", "inset", "kinds", "leftover"}
    for key, value in settings.items():
        if key in skip or isinstance(value, dict):
            continue
        options.setdefault(key, value)
    if "angle" in settings and settings["angle"] is not None:
        options["angle"] = float(settings["angle"])
    if "inset" in settings and settings["inset"] is not None:
        options["inset_mm"] = float(settings["inset"])
    if "mark" in settings and settings["mark"] is not None:
        options["mark"] = float(settings["mark"])
    return options


def fill_geometry(
    region,
    params: dict,
    theme: str,
    *,
    defaults: dict[str, Any] | None = None,
    overrides: dict[str, Any] | None = None,
    spacing: float | None = None,
) -> list[LineString]:
    """Run the configured fill algorithm over one region.

    ``overrides`` (e.g. a park kind's table) win over theme defaults — so one
    kind can be ``dots`` while another is ``waves`` or ``zigzag``.
    """
    settings = theme_fill_settings(params, theme, defaults)
    settings.pop("kinds", None)
    if overrides:
        settings = {**settings, **overrides}
        settings.pop("kinds", None)
    algorithm = str(settings.get("algorithm", (defaults or {}).get("algorithm", "rectilinear")))
    space = float(spacing if spacing is not None else settings.get("spacing", 0.5))
    options = fill_options_for(params, theme, algorithm, settings)
    return get_fill(algorithm)(region, space, **options)


def stroke_lines(
    lines: list[LineString],
    params: dict,
    theme: str,
    *,
    defaults: dict[str, Any] | None = None,
) -> list[LineString]:
    """Apply ``[stroke.<theme>]`` (solid / dash) to outline geometry."""
    settings = theme_stroke_settings(params, theme, defaults)
    style = str(settings.get("style", "solid")).lower()
    if style in ("solid", "none", ""):
        return lines
    if style in ("dash", "dashed"):
        dash = float(settings.get("dash", 0.45))
        gap = float(settings.get("gap", 0.40))
        out: list[LineString] = []
        for line in lines:
            out.extend(dash_geometry(line, dash=dash, gap=gap))
        return out
    if style in ("dot", "dotted"):
        # Short dashes with equal gaps — reads as a dotted stroke on the plotter.
        mark = float(settings.get("mark", settings.get("dash", 0.15)))
        gap = float(settings.get("gap", mark))
        out = []
        for line in lines:
            out.extend(dash_geometry(line, dash=mark, gap=gap))
        return out
    raise ValueError(f"unknown stroke style {style!r} for theme {theme!r}")
