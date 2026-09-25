#!/usr/bin/env bash
# One-shot convenience wrapper around the CLI: ./generate.sh "address".
# All flags are passed straight through, e.g.
#   ./generate.sh --address "Piazza Maggiore, Bologna" --width 6in
set -euo pipefail

cd "$(dirname "$0")"

if [ "$#" -eq 0 ]; then
    exec python -m postcards make --help
fi

# Bare argument means an address, so `./generate.sh "some address"` works.
if [[ "$1" != -* ]]; then
    set -- --address "$@"
fi

exec python -m postcards make "$@"
