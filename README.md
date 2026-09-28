# postcards

Turn any address into a pen-plotted postcard. OpenStreetMap data is fetched,
projected onto the card, rendered into distinct graphic layers (buildings
hatched, parks dotted, water waved, roads drawn to their real width) and turned
into G-code for a FluidNC plotter.

## The pipeline

Four stages, three of which you normally never call individually. vpype is a
first-class part of the pipeline, not a postscript: it owns path cleanup and it
emits the G-code.

```
address
   │
   ├─ 1. map       OSM ──► map.svg          layered geometry, nothing else
   │
   ├─ 2. optimize  ─────► opt.svg           vpype: snap, merge, sort, simplify
   │
   ├─ 3. gcode     ─────► part_*.gcode      vpype-gcode + FluidNC placement
   │
   └─ 4. upload    ─────► SD card, running  WebDAV, then $SD/Run
```

The split matters. This project decides **what** is drawn; vpype decides how
paths are cleaned; vpype-gcode decides what the machine does. Nothing here
reimplements path sorting, because that would only create a second opinion that
disagrees with vpype's.

## Setup

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install vpype vpype-gcode     # CLI tools, shelled out to rather than imported
pip install "deoverlap[vpype] @ git+https://github.com/piLeoni/deoverlap@v3.2.2"
                                  # corridor de-overlap (dev: pip install -e ../deoverlap[vpype])
```

## Use

```bash
./generate.sh "1730 Highland Pl, Berkeley, CA 94709"
```

That is shorthand for `python -m postcards make --address "..."`, and writes:

```
exports/1730_highland_pl_berkeley_ca_94709/
├── map.svg           # layered map, straight from OSM
├── opt.svg           # after vpype path optimization
├── part_01.gcode     # … part_NN.gcode, chained via $SD/Run
└── part_02.gcode
```

Send it to the plotter:

```bash
python -m postcards upload exports/1730_highland_pl_berkeley_ca_94709 --host 10.0.0.131 --run
```

### Commands

| Command | Does |
|---|---|
| `make` | Stages 1-3 in one go, into `exports/<slug>/` |
| `map` | Stage 1 only: any location → `map.svg` |
| `optimize` | Stage 2 only: `map.svg` → `opt.svg` |
| `gcode` | Stage 3 only: `opt.svg` → `part_*.gcode` |
| `upload` | Stage 4: push a job folder and start it |
| `check` | Validate G-code against the bed, without the machine |
| `fills` | Render and measure area-fill algorithms on a fixture |

`python -m postcards <command> --help` explains the flags. Coordinates work
anywhere an address does, as do card size, scale, rotation and projection:

```bash
python -m postcards map --lat 37.8771145 --lng -122.256196 --output map.svg
python -m postcards map --address "..." --width 8in --scale 1:5000 --bearing 25
python -m postcards map --address "..." --projection webmercator
```

## Configuration

`configs/fluidnc.toml` is the single source of truth for both the drawing and
the machine: card size and scale, the vpype pipeline applied to each layer, bed
placement, feed rates, and the G-code templates. Copy it for another plotter and
pass `--config`.

Building fills are selected there too:

```toml
[fill.buildings]
algorithm = "zigzag"    # rectilinear | concentric | zigzag | spiral | grid | honeycomb | hilbert
spacing = "0.5mm"
angle = 45
```

See [`docs/fills.md`](docs/fills.md) for the algorithms and how to compare them
with `postcards fills`.

## Layout

| Path | Role |
|---|---|
| `postcards/cli.py` | The command line entry point |
| `postcards/make_map.py` | Stage 1: address → multi-layer `map.svg` |
| `postcards/optimize.py` | Stage 2: builds and runs the vpype pipeline |
| `postcards/export_gcode.py` | Stage 3: placement, validation, part splitting |
| `postcards/upload_fluidnc.py` | Stage 4: WebDAV upload and job start |
| `postcards/utils/filters/` | One module per map theme |
| `postcards/utils/fills/` | Interchangeable area-fill algorithms |
| `postcards/utils/layers.py` | The `LayerParts` contract |
| `postcards/utils/composition.py` | Layer stacking and occlusion |
| `postcards/utils/projection.py` | UTM and Web Mercator projection to card mm |
| `postcards/utils/plot_config.py` | Config loading, feed placeholder expansion |
| `experiments/` | Exploratory scripts, not part of the pipeline |
| `tests/` | Projection, placement and G-code safety tests |

## How it fits together

[`docs/pipeline.md`](docs/pipeline.md) covers the layer contract, adding a theme,
and what each stage guarantees. Building fills are in
[`docs/fills.md`](docs/fills.md); road width, bridges and stacking in
[`docs/roads.md`](docs/roads.md). Machine limits and the failure modes they guard
against are in [`docs/machine_specs.md`](docs/machine_specs.md) and
[`docs/fluidnc_limits.md`](docs/fluidnc_limits.md).

## Tests

```bash
python -m pytest
```
