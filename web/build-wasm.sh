#!/usr/bin/env bash
# Build drawland-wasm into web/public/pkg, where the page loads it from.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"

command -v wasm-pack >/dev/null || { echo "install wasm-pack: cargo install wasm-pack" >&2; exit 1; }

wasm-pack build "$root/crates/drawland-wasm" \
  --target web \
  --out-dir "$root/web/public/pkg" \
  --release

printf '' > "$root/web/public/pkg/.gitignore"
echo "Wrote web/public/pkg/"
