#!/usr/bin/env bash
# The documentation's pictures, drawn by the CLI so they are what `drawland map`
# writes: every profile in `web/src/docs/examples/` (the tutorial's steps and
# the lite presets) and every preset in `web/src/presets/` (the gallery), as
# WebP under `web/public/docs/`. Pattern swatches come from
# `render-patterns.mjs`, run last.
#
#   web/scripts/render-docs.sh                 # everything
#   web/scripts/render-docs.sh examples        # one section: examples | gallery | patterns
#   web/scripts/render-docs.sh examples tutorial-03   # only the files whose name starts so
#
# Map data is cached in `cache/` like any CLI run; pass OFFLINE=1 to draw from
# the cache only. Needs `rsvg-convert` and ImageMagick (`magick`).
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
out="web/public/docs"
width="${WIDTH:-1400}"
section="${1:-all}"
only="${2:-}"

cargo build -q --release -p drawland-cli
bin="target/release/drawland"
flags=()
[ "${OFFLINE:-}" = 1 ] && flags+=(--offline)

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# render <profile.js> <out.webp>
render() {
  local js="$1" webp="$2" name
  name="$(basename "$js" .js)"
  mkdir -p "$(dirname "$webp")"
  echo "· $name"
  if ! "$bin" map "$js" ${flags[@]+"${flags[@]}"} -o "$tmp/$name.svg" >"$tmp/$name.log" 2>&1; then
    echo "  ✗ $js failed:"; tail -5 "$tmp/$name.log"; return 1
  fi
  # A sliced card writes one SVG per sheet; the docs show the first.
  local svg="$tmp/$name.svg"
  [ -f "$svg" ] || svg="$(ls "$tmp/$name"*.svg | head -1)"
  rsvg-convert -w "$width" -b white "$svg" -o "$tmp/$name.png"
  # A sheet much wider than 3:2 (a 24 × 6 in strip) is drawn taller instead, so
  # the gallery's 3:2 crop of it stays sharp.
  local h; h="$(magick identify -format %h "$tmp/$name.png")"
  if [ "$h" -lt $((width * 2 / 3)) ]; then
    rsvg-convert -h $((width * 2 / 3)) -b white "$svg" -o "$tmp/$name.png"
  fi
  magick "$tmp/$name.png" -quality 82 "$webp"
  rm -f "$tmp/$name"*.svg "$tmp/$name.png"
}

# detail <name> <left> <top> <size>: a square loupe on an example, as fractions
# of the sheet's width, drawn at four times the resolution: what a pair of steps
# changes is often too fine to see on the whole sheet.
detail() {
  local name="$1" left="$2" top="$3" size="$4"
  "$bin" map "web/src/docs/examples/$name.js" ${flags[@]+"${flags[@]}"} -o "$tmp/$name.svg" >/dev/null 2>&1
  local big=$((width * 4))
  rsvg-convert -w "$big" -b white "$tmp/$name.svg" -o "$tmp/$name.png"
  local px; px="$(awk -v b="$big" -v s="$size" 'BEGIN { printf "%d", b * s }')"
  local x; x="$(awk -v b="$big" -v l="$left" 'BEGIN { printf "%d", b * l }')"
  local y; y="$(awk -v b="$big" -v t="$top" 'BEGIN { printf "%d", b * t }')"
  magick "$tmp/$name.png" -crop "${px}x${px}+${x}+${y}" +repage -resize 900x900 -quality 85 "$out/examples/$name.detail.webp"
  rm -f "$tmp/$name.svg" "$tmp/$name.png"
}
# The pairs the tutorial sets side by side: before and after a mask, before and after the hand.
DETAILS=(
  "tutorial-03-roads 0.50 0.30 0.16"
  "tutorial-04-masks 0.50 0.30 0.16"
  "tutorial-07-pens 0.50 0.25 0.16"
  "tutorial-08-hand 0.50 0.25 0.16"
)

if [ "$section" = all ] || [ "$section" = examples ]; then
  for js in web/src/docs/examples/${only}*.js; do render "$js" "$out/examples/$(basename "$js" .js).webp"; done
  for d in "${DETAILS[@]}"; do
    # shellcheck disable=SC2086
    set -- $d
    case "$1" in "$only"*) echo "· $1 (detail)"; detail "$@" ;; esac
  done
fi
if [ "$section" = all ] || [ "$section" = gallery ]; then
  for js in web/src/presets/${only}*.js; do render "$js" "$out/gallery/$(basename "$js" .js).webp"; done
fi
if [ "$section" = all ] || [ "$section" = patterns ]; then
  node web/scripts/render-patterns.mjs
fi
