#!/usr/bin/env bash
# Build the page's two WASM modules: the engine into web/public/pkg, loaded
# with the page; the script interpreter into web/public/pkg-script, loaded only
# when a script has to run.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

command -v wasm-pack >/dev/null || { echo "install wasm-pack: cargo install wasm-pack" >&2; exit 1; }

wasm-pack build "$root/crates/drawland-wasm" \
  --target web \
  --out-dir "$root/web/public/pkg" \
  --release

wasm-pack build "$root/crates/drawland-script-wasm" \
  --target web \
  --out-dir "$root/web/public/pkg-script" \
  --profile wasm-script

printf '' > "$root/web/public/pkg/.gitignore"
printf '' > "$root/web/public/pkg-script/.gitignore"
echo "Wrote web/public/pkg/ and web/public/pkg-script/"
