"""Load project profile TOML (map + optimize + placement + feeds + gwrite)."""

from __future__ import annotations

import re
import tempfile
import tomllib
from pathlib import Path
from typing import Any


DEFAULT_CONFIG = Path(__file__).resolve().parent.parent / "configs" / "fluidnc.toml"

# Placeholders in [gwrite.plotter] strings, e.g. F$draw_xy → F3500.
# Distinct from vpype's {x:.4f} coordinate slots.
_FEED_PLACEHOLDER = re.compile(r"\$([a-zA-Z_][a-zA-Z0-9_]*)")


def load_plot_config(path: Path | None = None) -> dict[str, Any]:
    cfg_path = Path(path) if path else DEFAULT_CONFIG
    if not cfg_path.is_file():
        raise FileNotFoundError(f"plot config not found: {cfg_path}")
    with cfg_path.open("rb") as f:
        data = tomllib.load(f)
    data["_path"] = cfg_path.resolve()
    return data


def map_section(cfg: dict[str, Any]) -> dict[str, Any]:
    return dict(cfg.get("map") or {})


def optimize_section(cfg: dict[str, Any]) -> dict[str, Any]:
    return dict(cfg.get("optimize") or {})


def placement_section(cfg: dict[str, Any]) -> dict[str, Any]:
    return dict(cfg.get("placement") or {})


def gcode_section(cfg: dict[str, Any]) -> dict[str, Any]:
    """Job-splitting / chaining options from ``[gcode]``, with legacy fallbacks.

    Older profiles stored ``split_layers`` / ``max_lines_per_file`` / ``chain_parts``
    under ``[placement]``. Those still work when ``[gcode]`` omits a key.
    """
    placement = cfg.get("placement") or {}
    section = dict(cfg.get("gcode") or {})

    if "by_layer" not in section and "split_by_layer" not in section:
        if "split_layers" in placement:
            section["by_layer"] = placement["split_layers"]
    if "max_lines_per_file" not in section and "max_lines_per_file" in placement:
        section["max_lines_per_file"] = placement["max_lines_per_file"]
    if "chain" not in section and "chain_parts" in placement:
        section["chain"] = "all" if placement["chain_parts"] else "none"

    # Normalize aliases.
    if "split_by_layer" in section and "by_layer" not in section:
        section["by_layer"] = section.pop("split_by_layer")

    by_layer = bool(section.get("by_layer", True))
    max_lines = int(section.get("max_lines_per_file", 8000) or 0)
    chain_raw = section.get("chain", "all")
    if isinstance(chain_raw, bool):
        chain = "all" if chain_raw else "none"
    else:
        chain = str(chain_raw).strip().lower()
    if chain in ("true", "yes", "1"):
        chain = "all"
    if chain in ("false", "no", "0"):
        chain = "none"
    if chain not in ("all", "within_layer", "none"):
        raise ValueError(
            f"gcode.chain must be all|within_layer|none, got {chain_raw!r}"
        )

    return {
        "by_layer": by_layer,
        "max_lines_per_file": max_lines,
        "chain": chain,
    }


def layers_section(cfg: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Per-layer vpype pipelines from ``[layers.<name>]``.

    Returns ``{layer_name: [ {name, ...}, ... ]}`` with the op list copied so
    callers can mutate it freely.
    """
    raw = cfg.get("layers") or {}
    out: dict[str, list[dict[str, Any]]] = {}
    for name, section in raw.items():
        ops = (section or {}).get("ops") or []
        out[name] = [dict(op) for op in ops]
    return out


def feeds_section(cfg: dict[str, Any]) -> dict[str, Any]:
    defaults = {
        "travel_xy": 8000,
        "pen_z": 2000,
        "draw_xy": 3500,
        "pen_up": 4,
        "pen_down": 0,
    }
    feeds = dict(defaults)
    feeds.update(cfg.get("feeds") or {})
    return feeds


def expand_feed_placeholders(text: str, feeds: dict[str, Any]) -> str:
    """Replace $name with feeds[name]; leave unknown $name and {x:.4f} alone."""

    def repl(m: re.Match[str]) -> str:
        key = m.group(1)
        if key not in feeds:
            return m.group(0)
        return str(feeds[key])

    return _FEED_PLACEHOLDER.sub(repl, text)


def gwrite_plotter(cfg: dict[str, Any]) -> dict[str, Any]:
    """[gwrite.plotter] with $feed placeholders expanded for vpype / assemble."""
    feeds = feeds_section(cfg)
    raw = dict((cfg.get("gwrite") or {}).get("plotter") or {})
    out: dict[str, Any] = {}
    for key, val in raw.items():
        out[key] = expand_feed_placeholders(val, feeds) if isinstance(val, str) else val
    return out


def fill_section(cfg: dict[str, Any], theme: str) -> dict[str, Any]:
    """``[fill.<theme>]`` settings, with lengths resolved to millimetres.

    Returns an empty dict when the theme has no section, which filters read as
    "use the code defaults" — so existing profiles keep working unchanged.
    Lengths accept the same units as the rest of the config (``"0.5mm"``,
    ``0.5``, ``"0.02in"``). Nested tables (``kinds``, per-algorithm options)
    survive as dicts; scalar kind spacings under ``kinds`` are converted.
    """
    section = (cfg.get("fill") or {}).get(theme)
    if not section:
        return {}

    out = dict(section)
    for key in ("spacing", "inset", "mark"):
        if key in out and not isinstance(out[key], dict):
            out[key] = parse_mm(out[key])

    kinds = out.get("kinds")
    if isinstance(kinds, dict):
        parsed: dict[str, Any] = {}
        for name, value in kinds.items():
            if isinstance(value, dict):
                entry = dict(value)
                for key in ("spacing", "inset", "mark"):
                    if key in entry and not isinstance(entry[key], dict):
                        entry[key] = parse_mm(entry[key])
                parsed[str(name)] = entry
            else:
                # Shorthand: garden = "0.25mm" → spacing only (inherits algorithm).
                parsed[str(name)] = {"spacing": parse_mm(value)}
        out["kinds"] = parsed
    return out


def fill_options(cfg: dict[str, Any], theme: str, algorithm: str) -> dict[str, Any]:
    """Options for one algorithm, from ``[fill.<theme>.<algorithm>]``."""
    section = (cfg.get("fill") or {}).get(theme) or {}
    options = section.get(algorithm)
    return dict(options) if isinstance(options, dict) else {}


def stroke_section(cfg: dict[str, Any], theme: str) -> dict[str, Any]:
    """``[stroke.<theme>]`` outline style (solid / dash / dotted).

    Length keys ``dash``, ``gap``, ``mark`` are resolved to millimetres.
    """
    section = (cfg.get("stroke") or {}).get(theme)
    if not section:
        return {}
    out = dict(section)
    for key in ("dash", "gap", "mark"):
        if key in out and not isinstance(out[key], dict):
            out[key] = parse_mm(out[key])
    return out


def parse_mm(value: Any) -> float:
    """A length from the config, in millimetres.

    Numbers are millimetres already; strings go through pint, so ``"0.5mm"``
    and ``"0.02in"`` both work.
    """
    if isinstance(value, (int, float)):
        return float(value)
    from postcards.utils.cli_parser import parse_dimension

    return parse_dimension(value)


def _toml_escape_multiline(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"""', r"\"\"\"")


def write_vpype_gwrite_config(cfg: dict[str, Any]) -> Path:
    """Temp TOML with expanded feeds — what vpype --config actually reads."""
    plotter = gwrite_plotter(cfg)
    lines = ["# Auto-generated from plot config (feeds expanded). Do not edit.", "[gwrite.plotter]"]
    for key, val in plotter.items():
        if isinstance(val, bool):
            lines.append(f"{key} = {'true' if val else 'false'}")
        elif isinstance(val, (int, float)):
            lines.append(f"{key} = {val}")
        elif isinstance(val, str) and ("\n" in val or len(val) > 60):
            lines.append(f'{key} = """{_toml_escape_multiline(val)}"""')
        elif isinstance(val, str):
            escaped = val.replace("\\", "\\\\").replace('"', '\\"')
            lines.append(f'{key} = "{escaped}"')
        else:
            raise TypeError(f"unsupported gwrite value type for {key}: {type(val)}")
    tmp = tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".toml",
        prefix="vpype_gwrite_",
        delete=False,
        encoding="utf-8",
    )
    try:
        tmp.write("\n".join(lines) + "\n")
        tmp.close()
        return Path(tmp.name)
    except Exception:
        tmp.close()
        Path(tmp.name).unlink(missing_ok=True)
        raise
