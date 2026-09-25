# The pipeline

One address in, plotted G-code out. Four stages, each runnable on its own, each
configured from a single TOML profile.

```
address ──► postcards make ──► postcards upload
              map.svg  opt.svg  part_*.gcode  SD card + run
```

`python -m postcards make --address "an address"` (or `./generate.sh "an address"`)
runs the first three stages. `make` is a convenience wrapper; each stage is also
its own subcommand — `map`, `optimize`, `gcode`, `upload` — plus `check`, which
validates a job folder without touching the machine. Add the fourth on the command
line when the plotter is reachable.

## 1. `postcards make_map` — geometry to SVG

Takes an address or lat/lng, works out the ground rectangle for a card of the
requested size and scale, fetches OSM features inside it, projects everything to
millimetres on the page, and renders each theme into its own SVG layer.

Themes live in `postcards/utils/filters/`. Each one implements the same contract:

```python
def filter_<theme>(gdf: gpd.GeoDataFrame, params: dict) -> LayerParts
```

`LayerParts` (`postcards/utils/layers.py`) always carries four GeoDataFrames — `outlines`,
`details`, `filling`, `mask` — even when some are empty. There are no lambdas and
no optional keys, so callers never guard with `if "filling" in result`.

`mask` is the area the theme covers. `postcards/utils/composition.py` uses the masks to
stack the themes: walking bottom-up (`parks`, `water`, `roads`, `buildings`), each
theme is clipped against everything drawn above it. Roads therefore cross parks
and water; buildings punch holes in roads underneath.

Building *filling* strokes come from `postcards/utils/fills/`, chosen in the
profile with `[fill.buildings]` (algorithm, spacing, angle). Continuity is
decided there — not left to vpype `linesort`. Details in
[`docs/fills.md`](fills.md). Parks and water still use the older pattern helpers.

Layers written to the SVG: `roads_outlines`, `roads_details`,
`buildings_outlines`, `buildings_details`, `buildings_filling`,
`parks_outlines`, `parks_filling`, `water_outlines`, `water_filling`.

### Adding a theme

1. Write `filter_<name>(gdf, params) -> LayerParts` in `postcards/utils/filters/`.
2. Register it in `postcards/utils/filter_registry.FILTERS`.
3. Add `"<name>"` to `STACK_ORDER` in `postcards/utils/composition.py`, bottom-most first.
4. Add a `[layers.<name>_outlines]` section to the plot config.

No other file changes.

## 2. `postcards optimize` — path cleanup

Runs `vpype` over the SVG. Which operations each layer gets is declared in the
plot config, not in code:

```toml
[layers.buildings_filling]
ops = [
  { name = "linesimplify", tolerance = "0.1mm" },
  { name = "linemerge",    tolerance = "0.3mm" },
  { name = "filter",       tolerance = "0.15mm" },
  { name = "linesort",     two_opt = true },
]
```

Available ops: `snap`, `linesimplify`, `linemerge`, `filter`, `linesort`.
Layers with no section pass through untouched.

Never add vpype's `deduplicate` to a layer pipeline: it ignores `-l` and merges
every layer into layer 1, destroying the fillings. There is a test for this.

## 3. `postcards export_gcode` — SVG to machine G-code

The most delicate stage. It:

1. Reads the optimized SVG and drops sub-`scrub_min_mm` segments, keeping
   intentional two-point dabs (park dots) intact.
2. Flips Y (SVG grows downward, the machine grows toward home) and places the
   page on the bed — top edge on `origin_y_mm`, which is the Y home rail.
3. Refuses to continue if any point lands outside the bed.
4. Writes G-code per layer, splits oversized files at pen-up boundaries, and
   chains the parts with `$SD/Run` so one start runs the whole job.

Placement modes:

| `placement.anchor` | Behaviour |
|---|---|
| `page` | Pins the SVG page to the origin, keeping the card margin. |
| `content` | Packs the ink itself to the origin, consuming the margin. |

## 4. `postcards upload_fluidnc` — to the machine

Creates the SD directory over WebDAV, uploads each `part_*.gcode`, verifies the
SD listing, and optionally runs `part_01`. Multipart `/upload` silently fails on
a missing folder on FluidNC, so this uses `MKCOL` + `PUT`.

## Machine limits

See `docs/machine_specs.md` and `docs/fluidnc_limits.md`. The hard constraints:
X `0..200`, Y `0..140`, Z `0..6`, pen up at Z4 / down at Z0, `F3500` while
drawing, all coordinates absolute.

Every job file starts with the offset clear and homing preamble
(`G10 L2 P1` / `G92.1` / `$HZ` / `$H`); without it stale work offsets send the
head into the frame.

## Tests

```
python -m pytest
```

Coverage focuses on the things that break the machine: the projection's scale,
the bed placement, and the emitted G-code's preamble, pen heights and bounds.
