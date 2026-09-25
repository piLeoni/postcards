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
