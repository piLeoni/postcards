# Refactor plan — postcards

Goal: kill dead code, make every interface coherent, declare real dependencies,
extract reusable layers, and leave the production path obvious to a newcomer.

Legend: `[ ]` todo · `[x]` done

---

## Phase 0 — Safety net

- [ ] 0.1 `git add -A && git commit` a WIP checkpoint so refactors are revertible.
- [ ] 0.2 Confirm the production pipeline still runs end-to-end (dry-run, no upload).

## Phase 1 — Hygiene: names, deps, dead files

### 1.1 Entry point
- [ ] 1.1.1 Create `make_map.py` with `main()` + `if __name__ == "__main__":` guard.
- [ ] 1.1.2 Old `__init__.py` content moves there; root `__init__.py` becomes a
      real package init (empty, docstring only) so `import utils.*` never
      triggers a map build.
- [ ] 1.1.3 `generate.sh` calls `make_map.py` instead of `__init__.py`.

### 1.2 Dependencies
- [ ] 1.2.1 `requirements.txt` = fully pinned, real deps: geopandas, shapely,
      pandas, numpy, scipy, pyproj, geopy, osmnx, Pint, requests, matplotlib,
      fast_tsp, vpype, vpype-gcode, shapely-polyskel, poisson-disc-sampling.
- [ ] 1.2.2 Delete `setup.py` (it describes a different project, "deoverlap").
- [ ] 1.2.3 Delete `vpype.toml` (self-declared deprecated).

### 1.3 Delete dead code
- [ ] 1.3.1 `utils/optimize.py` — duplicate of `utils/gdf_optimizer.py`, imports
      `ortools` which is not a dependency.
- [ ] 1.3.2 `utils/fetch_osm.py` — dead; `make_map.py` uses `osmnx`.
- [ ] 1.3.3 `utils/process_feature_factory.py` — only used by `fetch_osm.py`.
- [ ] 1.3.4 `utils/transformer_factory.py` — never imported.
- [ ] 1.3.5 `export_fluidnc.py` — deprecated alias.
- [ ] 1.3.6 `cleanup.sh` — deletes live files (`gdf_ocean.py`, `fetch_osm.py`).
- [ ] 1.3.7 `utils/patterns/test_grid.py`, `utils/patterns/new/`, `patterns.py`
      — experimental; move to `experiments/` (not delete: they are useful work).
- [ ] 1.3.8 `fuck.md` — content is serious machine spec; move to
      `docs/fluidnc_limits.md` and delete the original.
- [ ] 1.3.9 `machine_specs.md` → `docs/machine_specs.md`.
- [ ] 1.3.10 Root test artifacts (`postcard.svg`, `test.svg`, `test_opt.svg`,
      `test/`, `__pycache__/`) removed from the working tree / git index.
- [ ] 1.3.11 `optimize_layers.py`, `contours.py`, `colorize_order.py`,
      `shuffle_order.py` → `experiments/`.

### 1.4 `.gitignore` + index
- [ ] 1.4.1 Add `__pycache__/`, `*.pyc`, `*.pyo`, `*.swp`, `*.swo`, `*.tif`,
      `.cache/`, `.DS_Store`, `_raw/`.
- [ ] 1.4.2 `git rm -r --cached` all committed `__pycache__` / `.pyc`.

## Phase 2 — Coherent interfaces

### 2.1 One contract for filters
- [ ] 2.1.1 New `utils/layers.py`: `@dataclass LayerParts` with
      `outlines`, `details`, `filling`, `mask` — always GeoDataFrames,
      never lambdas, always all four keys present.
- [ ] 2.1.2 Rewrite `filters/buildings.py`, `roads.py`, `parks.py`, `water.py`
      to return `LayerParts` directly (drop the `"geometry": lambda: ...` /
      `"raw"` / `"projected"` wrapper nobody reads).
- [ ] 2.1.3 `make_map.py` loses the nested `.difference()` chain: a small
      `compose()` helper applies the layer stacking order once.

### 2.2 Layer definitions in config
- [ ] 2.2.1 New `[layers.<name>]` sections in `configs/fluidnc.toml`, each with
      an ordered `ops` list (snap / linesimplify / linemerge / filter /
      linesort, with tolerances).
- [ ] 2.2.2 `utils/plot_config.py`: `layers_section()` returns them parsed.
- [ ] 2.2.3 `optimize.py`: replace the eight copy-pasted `if <layer> is not
      None:` blocks with one loop over the config. Adding a layer = TOML only.
- [ ] 2.2.4 Keep the special cases (water filling: no linemerge; parks filling:
      sort only) expressible as flags in the ops list.

### 2.3 One projection path
- [ ] 2.3.1 New `utils/projection.py` with `project(gdf, params)`, honouring
      `[map].projection = "utm" | "webmercator"`.
- [ ] 2.3.2 Delete `utils/gdf_projector.py`; update `filters/water.py` and
      `make_map.py` imports.

### 2.4 Patterns generate only what is needed
- [ ] 2.4.1 Give `dots_pattern` / `lines_pattern` / `waves_pattern` an optional
      `bounds` (target bbox) so they sweep the target rectangle + margin
      instead of the whole card diagonal.
- [ ] 2.4.2 Callers pass the target polygon bbox.

### 2.5 One geometry toolbox
- [ ] 2.5.1 Merge `utils/ops.py` + the read-only halves of
      `utils/gdf_optimizer.py` into `utils/geometry.py`; keep path-ordering in
      `utils/gdf_optimizer.py`.
- [ ] 2.5.2 `utils/clipping_area.py`: drop the commented-out dead functions,
      keep `clip_by` / `cut_by`; fix the mutable-default-free signatures.

## Phase 3 — Robustness

- [ ] 3.1 `tests/test_projection.py`: known lat/lon pair → expected mm distance
      at 1:10000 within tolerance.
- [ ] 3.2 `tests/test_placement.py`: bbox → machine coords, `ymax ≈ 140`,
      nothing outside `X[0,200] Y[0,140]`.
- [ ] 3.3 `tests/test_gcode.py`: exported part has the required preamble,
      pen only Z4/Z0, no XY out of bed.
- [ ] 3.4 Replace `print` with `logging` in the production path; `Timer` logs
      through it.

## Phase 4 — One command

- [ ] 4.1 `postcards.py` (or keep `generate.sh` but thin): `make → optimize →
      export`, `--upload HOST --run` optional.
- [ ] 4.2 README with the real pipeline, setup, and the exports/ layout.

---

## Verification (after every phase)

- [ ] `python -c "import make_map"` does not build a map.
- [ ] `./generate.sh "1730 Highland Pl, Berkeley, CA 94709"` produces
      `map.svg`, `opt.svg`, `part_*.gcode`.
- [ ] `pytest -q` green.
- [ ] `rg "ortools|process_feature_factory|transformer_factory|fetch_osm"`
      returns nothing in the production path.
