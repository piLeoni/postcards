# Refactor plan — postcards

Goal: kill dead code, make every interface coherent, declare real dependencies,
extract reusable layers, and leave the production path obvious to a newcomer.

**Status: all phases complete.** 40 tests passing, pipeline verified end to end.

Legend: `[ ]` todo · `[x]` done

---

## Phase 0 — Safety net

- [x] 0.1 `git add -A && git commit` a WIP checkpoint so refactors are revertible.
- [x] 0.2 Confirm the production pipeline still runs end-to-end (dry-run, no upload).

## Phase 1 — Hygiene: names, deps, dead files

### 1.1 Entry point
- [x] 1.1.1 Create `make_map.py` with `main()` + `if __name__ == "__main__":` guard.
- [x] 1.1.2 Old `__init__.py` content moves there; root `__init__.py` becomes a
      real package init (empty, docstring only) so `import utils.*` never
      triggers a map build.
- [x] 1.1.3 `generate.sh` calls `make_map.py` instead of `__init__.py`.

### 1.2 Dependencies
- [x] 1.2.1 `requirements.txt` = fully pinned, real deps: geopandas, shapely,
      pandas, numpy, scipy, pyproj, geopy, osmnx, Pint, requests, matplotlib,
      fast_tsp, shapely-polyskel; vpype/vpype-gcode documented as CLI installs.
- [x] 1.2.2 Delete `setup.py` (it described a different project, "deoverlap").
- [x] 1.2.3 Delete `vpype.toml` (self-declared deprecated).

### 1.3 Delete dead code
- [x] 1.3.1 `utils/optimize.py` — duplicate of `utils/gdf_optimizer.py`, imported
      `ortools` which is not a dependency.
- [x] 1.3.2 `utils/fetch_osm.py` — dead; `make_map.py` uses `osmnx`.
- [x] 1.3.3 `utils/process_feature_factory.py` — only used by `fetch_osm.py`.
- [x] 1.3.4 `utils/transformer_factory.py` — never imported.
- [x] 1.3.5 `export_fluidnc.py` — deprecated alias.
- [x] 1.3.6 `cleanup.sh` — deleted live files (`gdf_ocean.py`, `fetch_osm.py`).
- [x] 1.3.7 `utils/patterns/test_grid.py`, `utils/patterns/new/`, `patterns.py`
      — experimental; moved to `experiments/`.
- [x] 1.3.8 `fuck.md` — moved to `docs/fluidnc_limits.md`.
- [x] 1.3.9 `machine_specs.md` → `docs/machine_specs.md`.
- [x] 1.3.10 Root test artifacts removed (`postcard.svg`, `test.svg`,
      `test_opt.svg`, `test/`, `__pycache__/`, `data/test*.py`, `scripts/`).
- [x] 1.3.11 `optimize_layers.py`, `contours.py`, `colorize_order.py`,
      `shuffle_order.py` → `experiments/`.

### 1.4 `.gitignore` + index
- [x] 1.4.1 Added `__pycache__/`, `*.pyc`, `*.pyo`, `*.swp`, `*.swo`, `.cache/`,
      `.DS_Store`, `_raw/`, `.pytest_cache/`.
- [x] 1.4.2 `git rm -r --cached` the committed `__pycache__` / `*.pyc` / `exports`.

## Phase 2 — Coherent interfaces

### 2.1 One contract for filters
- [x] 2.1.1 New `utils/layers.py`: `@dataclass LayerParts` with
      `outlines`, `details`, `filling`, `mask` — always GeoDataFrames, never
      lambdas, always all four keys present.
- [x] 2.1.2 Rewrote `filters/buildings.py`, `roads.py`, `parks.py`, `water.py` to
      return `LayerParts` directly.
- [x] 2.1.3 New `utils/composition.py` replaces the nested `.difference()` chain
      with a bottom-up walk that subtracts the layers above.

### 2.2 Layer definitions in config
- [x] 2.2.1 `[layers.<name>]` sections added to `configs/fluidnc.toml` with
      ordered `ops` lists.
- [x] 2.2.2 `utils/plot_config.py`: `layers_section()`.
- [x] 2.2.3 `optimize.py`: the eight copy-pasted blocks became one loop over the
      config. Adding a layer = TOML only.
- [x] 2.2.4 Special cases (water filling: no linemerge; parks filling: sort only)
      expressed as flags in the op list (`follow`, omitted `linemerge`).

### 2.3 One projection path
- [x] 2.3.1 New `utils/projection.py` with `project(gdf, params)`, honouring
      `[map].projection = "utm" | "webmercator"`.
- [x] 2.3.2 Deleted `utils/gdf_projector.py`; updated `filters/water.py` and
      `make_map.py`, and added the `crs` parameter to `gdf_ocean.py`.

### 2.4 Patterns generate only what is needed
- [x] 2.4.1 `dots_pattern` / `lines_pattern` / `waves_pattern` take an optional
      `bounds` so they sweep the target bbox plus margin.
- [x] 2.4.2 Callers pass the target polygon's `total_bounds`.

### 2.5 One geometry toolbox
- [x] 2.5.1 `utils/ops.py` cleaned to the geometry conversions plus
      `clip_by`/`cut_by`/`clipping_rectangle`; `utils/gdf_optimizer.py` trimmed to
      path ordering (said `ortools` import removed).
- [x] 2.5.2 `utils/clipping_area.py` deleted — it was fully superseded by
      `ops.py`, including its commented-out dead functions.

## Phase 3 — Robustness

- [x] 3.1 `tests/test_projection.py`: 100 m north is 10 mm at 1:10000, both modes;
      corners land on the page; unknown projection rejected.
- [x] 3.2 `tests/test_placement.py`: bounds stay inside `X[0,200] Y[0,140]`, top
      edge on Y=140, oversized geometry rejected, out-of-bed rejected.
- [x] 3.3 `tests/test_gcode.py`: preamble matches `docs/fluidnc_limits.md`, pen
      only Z4/Z0, no `G28`, coords in bed, scrub behaviour.
- [x] 3.4 `logging` replaces `print` in the production path; `Timer` logs through
      it. `tests/test_config.py` and `tests/test_filters.py` cover the config and
      layer contract.

### Bugs the tests found (fixed)
- `clean_line` compared coordinate arrays with `abs()`, relying on ambiguous
  numpy truthiness — it raised on any real input.
- `_segment_length` assumed `[x, y]` pairs; vpype uses complex scalars.
- Added `document_bounds()` so the bed check does not depend on vpype's internal
  representation, with a test asserting it agrees with `doc.bounds()`.

## Phase 4 — One command

- [x] 4.1 `generate.sh` thinned and repointed at `make_map.py`; upload remains a
      separate explicit step.
- [x] 4.2 README rewritten with the real pipeline, setup, layout and config
      pointer; `docs/pipeline.md` documents the layer contract and how to add a
      theme.

---

## Verification (after every phase)

- [x] `python -c "import make_map"` does not build a map.
- [x] `make_map.py` → `optimize.py` → `export_gcode.py` produce `map.svg`,
      `opt.svg`, `part_01..09.gcode` with the correct preamble and chaining.
- [x] `pytest` — 40 passed.
- [x] `rg "ortools|process_feature_factory|transformer_factory|fetch_osm"`
      returns nothing in the production path.

