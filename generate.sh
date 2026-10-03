#!/usr/bin/env bash
# ./generate.sh "address" [drawland map flags]
# writes exports/<address_slug>/map.svg unless -o is given.
set -euo pipefail

cd "$(dirname "$0")"

run() { cargo run -q --release -p drawland-cli -- map "$@"; }

if [ "$#" -eq 0 ]; then
    run --help
    exit 0
fi

if [[ "$1" == -* ]]; then
    run "$@"
    exit 0
fi

address="$1"
shift
slug=$(printf '%s' "$address" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/_/g; s/^_+|_+$//g')
mkdir -p "exports/$slug"
run --address "$address" -o "exports/$slug/map.svg" "$@"
