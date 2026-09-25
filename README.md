# postcards

Turn any address into a pen-plotted postcard. OpenStreetMap data is fetched,
projected to a 6×4 inch card at 1:10000, rendered into distinct graphic layers
(buildings hatched at 45°, parks dotted, water waved, roads drawn to their real
width) and exported as G-code for a FluidNC plotter.

```
address ──► make_map.py ──► optimize.py ──► export_gcode.py ──► upload_fluidnc.py
              map.svg        opt.svg         part_*.gcode        SD card + run
```

## Setup

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install vpype vpype-gcode
```

`vpype` and `vpype-gcode` are CLI tools the pipeline shells out to, so they are
installed separately from the pinned `requirements.txt`.

## Use

```bash
./generate.sh "1730 Highland Pl, Berkeley, CA 94709"
```

That writes everything for the address into `exports/<slug>/`:

```
exports/1730_highland_pl_berkeley_ca_94709/
├── map.svg            # multi-layer map
├── opt.svg            # after path optimization
├── part_01.gcode       # … part_NN.gcode, chained via $SD/Run
└── part_02.gcode
```

Then send it to the plotter:

```bash
./upload_fluidnc.py exports/1730_highland_pl_berkeley_ca_94709 --host 10.0.0.131 --run
```

### Without an address

Coordinates work too, as do card size, scale, rotation and projection:

```bash
.venv/bin/python make_map.py --lat 37.8771145 --lng -122.256196 --output map.svg
.venv/bin/python make_map.py --address "..." --width 8in --scale 1:5000 --bearing 25
.venv/bin/python make_map.py --address "..." --projection webmercator
```

## Configuration

`configs/fluidnc.toml` is the single source of truth for both the map and the
machine: card size and scale, per-layer vpype pipelines, bed placement, feed
rates, and the G-code templates. Copy it for another plotter and pass
`--config` (or set `PLOT_CONFIG`).

## How it fits together

See [`docs/pipeline.md`](docs/pipeline.md) for the layer contract, how to add a
theme, and what each stage guarantees. Machine limits and the failure modes they
guard against are in [`docs/machine_specs.md`](docs/machine_specs.md) and
[`docs/fluidnc_limits.md`](docs/fluidnc_limits.md).

## Layout

| Path | Role |
|---|---|
| `make_map.py` | Stage 1: address → multi-layer `map.svg` |
| `optimize.py` | Stage 2: vpype path cleanup, driven by the config |
| `export_gcode.py` | Stage 3: placement, validation, G-code parts |
| `upload_fluidnc.py` | Stage 4: WebDAV upload and job start |
| `utils/filters/` | One module per map theme |
| `utils/layers.py` | The `LayerParts` contract |
| `utils/composition.py` | Layer stacking and occlusion |
| `utils/projection.py` | UTM and Web Mercator projection to card mm |
| `utils/plot_config.py` | Config loading, feed placeholder expansion |
| `experiments/` | Exploratory scripts, not part of the pipeline |
| `tests/` | Projection, placement and G-code safety tests |

## Tests

```bash
.venv/bin/python -m pytest
```
