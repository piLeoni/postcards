#!/usr/bin/env bash
# Pubblica l’ultima versione su draw.land (Vercel, progetto drawland).
#
# Perché non basta fare git push:
# - il WASM non è nel repo (si compila in locale);
# - i preset usano graphs.json, aggiornato solo con check_web_presets.
#
# Prima volta:
#   npm install -g vercel && vercel login
#   cd web && vercel link --project drawland
#
# Poi, da qui:
#   ./deploy.sh
set -euo pipefail

web="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$web/.." && pwd)"

need() {
  command -v "$1" >/dev/null || {
    echo "Manca $1 — $2" >&2
    exit 1
  }
}

need vercel "installa con: npm install -g vercel   poi: vercel login"
need wasm-pack "installa con: cargo install wasm-pack"
need cargo "serve Rust da https://rustup.rs"

if [[ ! -f "$web/.vercel/project.json" ]]; then
  echo "Collega il progetto Vercel (una volta):" >&2
  echo "  cd web && vercel link --project drawland" >&2
  exit 1
fi

echo "→ Aggiorno graphs.json dai preset (city-grain, ecc.)…"
(cd "$root" && cargo run -q --example check_web_presets -- --write)

echo "→ Compilo WASM (motore + interprete script)…"
(cd "$web" && npm run wasm)

echo "→ npm install…"
(cd "$web" && npm install)

echo "→ Build per Vercel (WASM + Vite)…"
(cd "$web" && vercel build --prod)

echo "→ Pubblico in production (draw.land)…"
(cd "$web" && vercel deploy --prebuilt --prod --yes)

echo ""
echo "Fatto: https://draw.land"
echo "Se vedi ancora il vecchio preset, prova una finestra privata (cache del browser)."
