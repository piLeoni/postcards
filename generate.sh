#!/usr/bin/env bash
# Generate postcard SVG → optimize → G-code using a plotter profile TOML.
#
# Usage:
#   ./generate.sh "1730 Highland Pl, Berkeley, CA 94709"
#   PLOT_CONFIG=configs/fluidnc.toml ./generate.sh "somewhere"
#   ./upload_fluidnc.py exports/<slug> --host 10.0.0.131 --run
#
# Everything for one address lands in exports/<slug>/:
#   map.svg  opt.svg  part_01.gcode … part_N.gcode

set -euo pipefail
cd "$(dirname "$0")"

ADDRESS="${1:-1730 Highland Pl, Berkeley, CA 94709}"
CONFIG="${PLOT_CONFIG:-configs/fluidnc.toml}"

if [[ ! -x .venv/bin/python ]]; then
  echo "Missing .venv — create it and install deps first:" >&2
  echo "  python3.12 -m venv .venv && source .venv/bin/activate" >&2
  echo "  pip install -r requirements.txt vpype vpype-gcode shapely_polyskel" >&2
  exit 1
fi

export PATH="$(pwd)/.venv/bin:$PATH"
PY="$(pwd)/.venv/bin/python"

OUT_DIR="exports"
SLUG="$(echo "$ADDRESS" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '_' | sed 's/^_\|_$//g')"
JOB_DIR="$OUT_DIR/$SLUG"
mkdir -p "$JOB_DIR"

RAW="$JOB_DIR/map.svg"
OPT="$JOB_DIR/opt"          # optimize writes ${OPT}.svg
GCODE="$JOB_DIR/job.gcode"  # export writes part_*.gcode next to this

echo "==> address: $ADDRESS"
echo "==> config:  $CONFIG"
echo "==> job dir: $JOB_DIR"
echo "==> 1/3 map SVG → $RAW"
"$PY" __init__.py --config "$CONFIG" --address "$ADDRESS" --output "$RAW"

echo "==> 2/3 optimize paths → ${OPT}.svg"
"$PY" optimize.py "$RAW" "$OPT" --config "$CONFIG"

echo "==> 3/3 G-code → $JOB_DIR/part_*.gcode (chained)"
"$PY" export_gcode.py "${OPT}.svg" "$GCODE" --config "$CONFIG"

echo "==> done"
echo "    job:    $JOB_DIR/"
echo "    upload: ./upload_fluidnc.py $JOB_DIR --host <fluidnc-ip> --run"
