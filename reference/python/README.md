# The Python pipeline (reference only)

The postcards pipeline as it was before the Rust rewrite: address → map SVG →
vpype optimisation → G-code → FluidNC upload. It is kept to read and compare
against, not to run: nothing here is built, tested or maintained, and paths
inside these files still point at their old locations (`postcards/`,
`configs/fluidnc.toml`, `docs/`).

| Path | What it was |
|---|---|
| `postcards/` | The package: `make_map`, `optimize`, `export_gcode`, `upload_fluidnc`, themes (`utils/filters`), fills, patterns, compose |
| `tests/` | pytest suite |
| `configs/fluidnc.toml` | The single profile: map, vpype pipeline, machine, G-code |
| `docs/` | Pipeline, fills, roads and machine docs |
| `parity/` | Scripts that compared the Rust output with this pipeline |
| `experiments/` | Exploratory scripts |
| `tiles/` | Ocean tiles used by `utils/gdf_ocean.py` |

The Rust map stage follows `postcards/utils/filters/` for the four themes
(`buildings`, `parks`, `water`, `roads`); `docs/roads.md` is the roads rule
book both implement.
