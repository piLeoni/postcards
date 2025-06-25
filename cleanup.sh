#!/bin/bash

echo "Cleaning up unused files and directories..."

# Root directory files to delete
echo "Removing root directory files..."
rm -f test_grid.py
rm -f dedulicate.sh
rm -f out.gcode
rm -f test.sh
rm -f layer_configs.json
rm -f update.sh
rm -f error.log
rm -f wh
rm -f .tmp.svg
rm -f init.sh

# Utils directory files to delete
echo "Removing utils directory files..."
rm -f utils/gdf_ocean.py
rm -f utils/geometry_to_svg.py
rm -f utils/transformer_factory.py
rm -f utils/fetch_osm.py

# Cache and temporary directories
echo "Removing cache and temporary directories..."
rm -rf __pycache__
rm -rf utils/__pycache__
rm -rf cache
rm -rf .cache
rm -rf tmp

echo "Cleanup complete!"
echo "Remaining files:"
ls -la 