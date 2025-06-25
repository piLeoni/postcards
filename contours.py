import geopandas as gpd
import elevation
import rasterio
import numpy as np
import matplotlib.pyplot as plt
import os
from shapely.geometry import LineString
from rasterio import transform as rio_transform
from shapely.geometry import box

# --- Config ---

GEOJSON_PATH = "sf.geojson"  # input polygon file
OUTPUT_GEOJSON = "contours.geojson"    # output contours

CONTOUR_INTERVAL =  1 # elevation contour step in meters

# --- Step 1: Load GeoJSON polygon ---

gdf = gpd.read_file(GEOJSON_PATH)
polygon = gdf.geometry.union_all()  # merge all geometries if multiple
bounds = polygon.bounds  # (minx, miny, maxx, maxy)

# Create unique temporary filename based on bounds
import tempfile
import hashlib
bounds_str = f"{bounds[0]:.6f}_{bounds[1]:.6f}_{bounds[2]:.6f}_{bounds[3]:.6f}"
bounds_hash = hashlib.md5(bounds_str.encode()).hexdigest()[:8]
ELEVATION_TIF = f"elevation_{bounds_hash}.tif"

print(f"Processing polygon with bounds: {bounds}")
print(f"Using elevation file: {ELEVATION_TIF}")

# --- Step 2: Try multiple high-resolution elevation data sources ---

# Higher resolution elevation sources, ordered by resolution/quality preference
ELEVATION_SOURCES = [
    {
        "name": "USGS 3DEP 1-meter LiDAR DEM",
        "method": "usgs_3dep",
        "product": "1m",
        "resolution": 1,
        "description": "Highest resolution - LiDAR derived 1-meter DEMs from USGS 3D Elevation Program"
    },
    {
        "name": "USGS 3DEP 1/9 arc-second DEM (~3m)",
        "method": "usgs_3dep", 
        "product": "1/9",
        "resolution": 3,
        "description": "Very high resolution ~3-meter DEMs"
    },
    {
        "name": "USGS 3DEP 5-meter DEM (Alaska)",
        "method": "usgs_3dep",
        "product": "5m", 
        "resolution": 5,
        "description": "5-meter resolution for Alaska"
    },
    {
        "name": "USGS 3DEP 1/3 arc-second DEM (~10m)",
        "method": "usgs_3dep",
        "product": "1/3",
        "resolution": 10,
        "description": "High resolution ~10-meter DEMs"
    },
    {
        "name": "Copernicus DEM 30m (COP30)",
        "method": "opentopography_api",
        "api_url": "https://portal.opentopography.org/API/globaldem",
        "params": {
            "demtype": "COP30",
            "outputFormat": "GTiff",
            "API_Key": "demoapikeyot2022"  # Demo key from OpenTopography docs
        },
        "resolution": 30
    },
    {
        "name": "ViewFinder Panoramas DEMs (High Resolution)",
        "method": "viewfinder_hgt",
        "base_url": "http://viewfinderpanoramas.org/dem3/",
        "resolution": 15  # ~15m in many areas, varies by location
    },
    {
        "name": "Copernicus DEM 90m (COP90)",
        "method": "opentopography_api", 
        "api_url": "https://portal.opentopography.org/API/globaldem",
        "params": {
            "demtype": "COP90",
            "outputFormat": "GTiff",
            "API_Key": "demoapikeyot2022"
        },
        "resolution": 90
    },
    {
        "name": "NASADEM 30m",
        "method": "opentopography_api",
        "api_url": "https://portal.opentopography.org/API/globaldem", 
        "params": {
            "demtype": "NASADEM",
            "outputFormat": "GTiff",
            "API_Key": "demoapikeyot2022"
        },
        "resolution": 30
    },
    {
        "name": "ALOS World 3D 30m",
        "method": "elevation_package",
        "product": "SRTMGL1", 
        "cache": "SRTM1",
        "resolution": 30
    },
    {
        "name": "SRTM 30m",
        "method": "elevation_package", 
        "product": "SRTMGL1",
        "cache": "SRTM1", 
        "resolution": 30
    },
    {
        "name": "SRTM 90m (fallback)",
        "method": "elevation_package",
        "product": "SRTMGL3",
        "cache": "SRTMGL3",
        "resolution": 90
    }
]

def try_opentopography_api(source, bounds, output_file):
    """Try to get elevation data from OpenTopography API"""
    try:
        import urllib.request
        import urllib.parse
        import ssl
        
        print(f"Trying {source['name']} via OpenTopography API...")
        
        # Build API request URL
        params = source["params"].copy()
        params.update({
            "south": bounds[1],  # miny
            "north": bounds[3],  # maxy
            "west": bounds[0],   # minx
            "east": bounds[2]    # maxx
        })
        
        url = source["api_url"] + "?" + urllib.parse.urlencode(params)
        print(f"API URL: {url}")
        
        # Create SSL context that ignores certificate verification
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        
        # Download the data
        with urllib.request.urlopen(url, context=ssl_context) as response:
            with open(output_file, 'wb') as f:
                f.write(response.read())
        
        if os.path.exists(output_file):
            file_size = os.path.getsize(output_file)
            if file_size > 1000:  # Check if we got actual data, not just an error message
                print(f"Successfully downloaded {source['name']} data ({file_size} bytes)")
                return True
            else:
                print(f"Downloaded file too small ({file_size} bytes), likely an error")
                if os.path.exists(output_file):
                    os.remove(output_file)
                return False
        else:
            print(f"Failed to download {source['name']} data")
            return False
            
    except Exception as e:
        print(f"Error downloading {source['name']}: {e}")
        if os.path.exists(output_file):
            os.remove(output_file)
        return False

def try_gdal_direct_copernicus(bounds, output_file):
    """Try to access Copernicus DEM directly via GDAL Virtual File Systems"""
    try:
        import subprocess
        import os
        
        print("Trying direct GDAL access to Copernicus DEM on AWS S3...")
        
        # Set AWS environment variables for public access
        env = os.environ.copy()
        env['AWS_NO_SIGN_REQUEST'] = 'YES'
        env['AWS_DEFAULT_REGION'] = 'eu-west-1'
        
        # Copernicus DEM 30m is available on AWS S3
        # Format: /vsis3/copernicus-dem-30m/Copernicus_DSM_COG_10_N47_00_E007_00_DEM/Copernicus_DSM_COG_10_N47_00_E007_00_DEM.tif
        
        # Calculate tile indices from bounds
        min_lon, min_lat, max_lon, max_lat = bounds
        
        # Copernicus DEM tiles are 1 degree x 1 degree
        tiles_to_try = []
        for lat in range(int(min_lat), int(max_lat) + 1):
            for lon in range(int(min_lon), int(max_lon) + 1):
                # Format tile name according to Copernicus naming convention
                lat_str = f"N{lat:02d}" if lat >= 0 else f"S{abs(lat):02d}"
                lon_str = f"E{lon:03d}" if lon >= 0 else f"W{abs(lon):03d}"
                
                tile_path = f"/vsis3/copernicus-dem-30m/Copernicus_DSM_COG_10_{lat_str}_00_{lon_str}_00_DEM/Copernicus_DSM_COG_10_{lat_str}_00_{lon_str}_00_DEM.tif"
                tiles_to_try.append(tile_path)
        
        if len(tiles_to_try) == 1:
            # Single tile - clip directly
            cmd = [
                "gdal_translate",
                "-projwin", str(bounds[0]), str(bounds[3]), str(bounds[2]), str(bounds[1]),
                tiles_to_try[0],
                output_file
            ]
        else:
            # Multiple tiles - create VRT first, then clip
            vrt_file = output_file.replace('.tif', '_temp.vrt')
            
            # Build VRT from multiple tiles
            cmd_vrt = ["gdalbuildvrt", vrt_file] + tiles_to_try
            result_vrt = subprocess.run(cmd_vrt, capture_output=True, text=True, timeout=60, env=env)
            
            if result_vrt.returncode != 0:
                print(f"Failed to build VRT: {result_vrt.stderr}")
                return False
            
            # Clip VRT to bounds
            cmd = [
                "gdal_translate", 
                "-projwin", str(bounds[0]), str(bounds[3]), str(bounds[2]), str(bounds[1]),
                vrt_file,
                output_file
            ]
        
        # Execute the clipping command
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=env)
        
        if result.returncode == 0 and os.path.exists(output_file):
            file_size = os.path.getsize(output_file)
            if file_size > 1000:
                print(f"Successfully accessed Copernicus DEM via GDAL ({file_size} bytes)")
                return True
        
        print(f"GDAL direct access failed: {result.stderr}")
        return False
        
    except Exception as e:
        print(f"Error with direct GDAL access: {e}")
        return False

def try_elevation_source(source, bounds, output_file):
    """Try to get elevation data from elevation package"""
    try:
        print(f"Trying {source['name']} via elevation package...")
        elevation.clip(bounds=bounds, output=output_file, product=source['product'])
        
        if os.path.exists(output_file):
            print(f"Successfully created {output_file} using {source['name']}")
            return True
        else:
            print(f"File not created with {source['name']}, trying manual approach...")
            
        # Alternative: seed the data first, then manually clip
        print(f"Seeding {source['name']} data...")
        elevation.seed(bounds=bounds, product=source['product'])
        
        # Use gdal_translate directly to clip the cached VRT
        cache_dir = os.path.expanduser(f"~/Library/Caches/elevation/{source['cache']}")
        vrt_file = os.path.join(cache_dir, f"{source['cache']}.vrt")
        
        print(f"Looking for VRT file: {vrt_file}")
        if os.path.exists(vrt_file):
            import subprocess
            print("Running gdal_translate manually...")
            cmd = [
                "gdal_translate",
                "-projwin", str(bounds[0]), str(bounds[3]), str(bounds[2]), str(bounds[1]),
                vrt_file,
                output_file
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"gdal_translate failed: {result.stderr}")
                return False
            else:
                print("gdal_translate completed successfully")
                return True
        else:
            print(f"Could not find VRT file at {vrt_file}")
            return False
            
    except Exception as e:
        print(f"Error with {source['name']}: {e}")
        return False

def try_viewfinder_hgt(source, bounds, output_file):
    """Try to access ViewFinder Panoramas HGT files"""
    try:
        import urllib.request
        import zipfile
        import tempfile
        import subprocess
        import ssl
        
        print(f"Trying {source['name']} via ViewFinder Panoramas...")
        
        min_lon, min_lat, max_lon, max_lat = bounds
        
        # ViewFinder uses 1-degree tiles named like N46E007.hgt.zip
        tiles_downloaded = []
        
        for lat in range(int(min_lat), int(max_lat) + 1):
            for lon in range(int(min_lon), int(max_lon) + 1):
                # Format tile name according to ViewFinder naming convention
                lat_str = f"N{lat:02d}" if lat >= 0 else f"S{abs(lat):02d}"
                lon_str = f"E{lon:03d}" if lon >= 0 else f"W{abs(lon):03d}"
                
                tile_name = f"{lat_str}{lon_str}"
                zip_filename = f"{tile_name}.hgt.zip"
                hgt_filename = f"{tile_name}.hgt"
                
                # Try to download the zip file
                tile_url = f"{source['base_url']}{zip_filename}"
                
                try:
                    print(f"  Downloading {tile_url}")
                    
                    # Create SSL context that ignores certificate verification
                    ssl_context = ssl.create_default_context()
                    ssl_context.check_hostname = False
                    ssl_context.verify_mode = ssl.CERT_NONE
                    
                    with urllib.request.urlopen(tile_url, context=ssl_context, timeout=30) as response:
                        if response.getcode() == 200:
                            zip_content = response.read()
                            
                            # Extract HGT file from zip
                            with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as temp_zip:
                                temp_zip.write(zip_content)
                                temp_zip_path = temp_zip.name
                            
                            try:
                                with zipfile.ZipFile(temp_zip_path, 'r') as zf:
                                    # Extract the HGT file
                                    hgt_temp_path = temp_zip_path.replace('.zip', '.hgt')
                                    with zf.open(hgt_filename) as source_file:
                                        with open(hgt_temp_path, 'wb') as target_file:
                                            target_file.write(source_file.read())
                                    
                                    tiles_downloaded.append(hgt_temp_path)
                                    print(f"  Successfully downloaded and extracted {hgt_filename}")
                            finally:
                                os.unlink(temp_zip_path)
                        else:
                            print(f"  Tile {tile_name} not available (HTTP {response.getcode()})")
                            
                except Exception as e:
                    print(f"  Failed to download {tile_name}: {e}")
                    continue
        
        if not tiles_downloaded:
            print("No ViewFinder tiles could be downloaded")
            return False
        
        # Use gdal to create a VRT from the HGT files and clip to bounds
        if len(tiles_downloaded) == 1:
            # Single HGT file - convert directly
            cmd = [
                "gdal_translate",
                "-projwin", str(bounds[0]), str(bounds[3]), str(bounds[2]), str(bounds[1]),
                tiles_downloaded[0],
                output_file
            ]
        else:
            # Multiple HGT files - create VRT first
            vrt_file = output_file.replace('.tif', '_viewfinder.vrt')
            
            # Build VRT from HGT files
            cmd_vrt = ["gdalbuildvrt", vrt_file] + tiles_downloaded
            result_vrt = subprocess.run(cmd_vrt, capture_output=True, text=True, timeout=60)
            
            if result_vrt.returncode != 0:
                print(f"Failed to build VRT from HGT files: {result_vrt.stderr}")
                return False
            
            # Clip VRT to bounds
            cmd = [
                "gdal_translate",
                "-projwin", str(bounds[0]), str(bounds[3]), str(bounds[2]), str(bounds[1]),
                vrt_file,
                output_file
            ]
        
        # Execute the clipping command
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        
        # Clean up temporary files
        for temp_file in tiles_downloaded:
            try:
                os.unlink(temp_file)
            except:
                pass
        
        if result.returncode == 0 and os.path.exists(output_file):
            file_size = os.path.getsize(output_file)
            if file_size > 1000:
                print(f"Successfully created DEM from ViewFinder data ({file_size} bytes)")
                return True
        
        print(f"Failed to create DEM from ViewFinder data: {result.stderr}")
        return False
        
    except Exception as e:
        print(f"Error with ViewFinder Panoramas access: {e}")
        return False

def try_usgs_3dep(source, bounds, output_file):
    """Try to access USGS 3DEP high-resolution elevation data"""
    try:
        import urllib.request
        import urllib.parse
        import json
        import ssl
        import subprocess
        import tempfile
        
        print(f"Trying {source['name']} via USGS 3DEP...")
        
        min_lon, min_lat, max_lon, max_lat = bounds
        
        # USGS 3DEP API endpoints
        if source['product'] == '1m':
            # 1-meter LiDAR DEMs - use National Map API
            api_url = "https://tnmaccess.nationalmap.gov/api/v1/products"
            params = {
                "bbox": f"{min_lon},{min_lat},{max_lon},{max_lat}",
                "datasets": "Digital Elevation Model (DEM) 1 meter",
                "prodFormats": "GeoTIFF",
                "max": "50"  # Get up to 50 tiles that intersect the area
            }
        elif source['product'] == '1/9':
            # 1/9 arc-second (~3m) DEMs
            api_url = "https://tnmaccess.nationalmap.gov/api/v1/products"
            params = {
                "bbox": f"{min_lon},{min_lat},{max_lon},{max_lat}",
                "datasets": "Digital Elevation Model (DEM) 1/9 arc-second",
                "prodFormats": "GeoTIFF",
                "max": "50"
            }
        elif source['product'] == '1/3':
            # 1/3 arc-second (~10m) DEMs
            api_url = "https://tnmaccess.nationalmap.gov/api/v1/products"
            params = {
                "bbox": f"{min_lon},{min_lat},{max_lon},{max_lat}",
                "datasets": "Digital Elevation Model (DEM) 1/3 arc-second",
                "prodFormats": "GeoTIFF", 
                "max": "50"
            }
        elif source['product'] == '5m':
            # 5-meter DEMs (Alaska)
            api_url = "https://tnmaccess.nationalmap.gov/api/v1/products"
            params = {
                "bbox": f"{min_lon},{min_lat},{max_lon},{max_lat}",
                "datasets": "Digital Elevation Model (DEM) 5 meter",
                "prodFormats": "GeoTIFF",
                "max": "50"
            }
        else:
            print(f"Unknown 3DEP product: {source['product']}")
            return False
        
        # Query the API for available products
        query_url = api_url + "?" + urllib.parse.urlencode(params)
        print(f"Querying 3DEP API: {query_url}")
        
        # Create SSL context that ignores certificate verification
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        
        with urllib.request.urlopen(query_url, context=ssl_context, timeout=30) as response:
            if response.getcode() == 200:
                data = json.loads(response.read().decode())
                
                if 'items' in data and len(data['items']) > 0:
                    print(f"Found {len(data['items'])} {source['name']} products for this area")
                    
                    # Download all available tiles
                    downloaded_tiles = []
                    total_size = 0
                    
                    for i, product in enumerate(data['items']):
                        download_url = product.get('downloadURL')
                        
                        if download_url:
                            tile_name = product.get('title', f'tile_{i}')
                            print(f"  Downloading tile {i+1}/{len(data['items'])}: {tile_name}")
                            
                            # Create temporary file for this tile
                            temp_tile = output_file.replace('.tif', f'_tile_{i}.tif')
                            
                            try:
                                # Download the DEM tile
                                with urllib.request.urlopen(download_url, context=ssl_context, timeout=120) as dem_response:
                                    with open(temp_tile, 'wb') as f:
                                        tile_data = dem_response.read()
                                        f.write(tile_data)
                                
                                if os.path.exists(temp_tile):
                                    file_size = os.path.getsize(temp_tile)
                                    if file_size > 10000:  # Check if we got substantial data
                                        downloaded_tiles.append(temp_tile)
                                        total_size += file_size
                                        print(f"    Downloaded {tile_name} ({file_size:,} bytes)")
                                    else:
                                        print(f"    Tile too small ({file_size} bytes), skipping")
                                        if os.path.exists(temp_tile):
                                            os.remove(temp_tile)
                            except Exception as e:
                                print(f"    Error downloading tile {i+1}: {e}")
                                if os.path.exists(temp_tile):
                                    os.remove(temp_tile)
                                continue
                    
                    if len(downloaded_tiles) == 0:
                        print(f"No valid {source['name']} tiles could be downloaded")
                        return False
                    elif len(downloaded_tiles) == 1:
                        # Single tile - just rename it
                        os.rename(downloaded_tiles[0], output_file)
                        print(f"Successfully downloaded 1 tile ({total_size:,} bytes total)")
                        return True
                    else:
                        # Multiple tiles - create mosaic using GDAL
                        print(f"Creating mosaic from {len(downloaded_tiles)} tiles...")
                        
                        # Create VRT (Virtual Raster) from all tiles
                        vrt_file = output_file.replace('.tif', '_mosaic.vrt')
                        
                        try:
                            # Build VRT from all downloaded tiles
                            cmd_vrt = ["gdalbuildvrt", vrt_file] + downloaded_tiles
                            result_vrt = subprocess.run(cmd_vrt, capture_output=True, text=True, timeout=120)
                            
                            if result_vrt.returncode != 0:
                                print(f"Failed to build VRT: {result_vrt.stderr}")
                                return False
                            
                            # First, convert the VRT to a temporary GeoTIFF without clipping
                            temp_mosaic = output_file.replace('.tif', '_temp_mosaic.tif')
                            cmd_mosaic = [
                                "gdal_translate",
                                "-co", "TILED=YES",
                                "-co", "COMPRESS=DEFLATE",
                                vrt_file,
                                temp_mosaic
                            ]
                            
                            result_mosaic = subprocess.run(cmd_mosaic, capture_output=True, text=True, timeout=180)
                            
                            if result_mosaic.returncode != 0:
                                print(f"Failed to create temporary mosaic: {result_mosaic.stderr}")
                                return False
                            
                            # Check the mosaic CRS and bounds
                            import rasterio
                            with rasterio.open(temp_mosaic) as src:
                                mosaic_crs = src.crs
                                mosaic_bounds = src.bounds
                                print(f"Mosaic CRS: {mosaic_crs}")
                                print(f"Mosaic bounds: {mosaic_bounds}")
                            
                            # Now clip to the exact bounds we need, but in the mosaic's CRS
                            if mosaic_crs.to_string() == "EPSG:4326":
                                # Geographic coordinates - use original bounds
                                clip_bounds = bounds
                            else:
                                # Projected coordinates - need to transform bounds
                                import pyproj
                                transformer = pyproj.Transformer.from_crs("EPSG:4326", mosaic_crs, always_xy=True)
                                min_x, min_y = transformer.transform(bounds[0], bounds[1])
                                max_x, max_y = transformer.transform(bounds[2], bounds[3])
                                clip_bounds = [min_x, min_y, max_x, max_y]
                                print(f"Transformed bounds for clipping: {clip_bounds}")
                            
                            cmd_clip = [
                                "gdal_translate",
                                "-projwin", str(clip_bounds[0]), str(clip_bounds[3]), str(clip_bounds[2]), str(clip_bounds[1]),
                                "-co", "TILED=YES",
                                "-co", "COMPRESS=DEFLATE",
                                temp_mosaic,
                                output_file
                            ]
                            
                            result_clip = subprocess.run(cmd_clip, capture_output=True, text=True, timeout=120)
                            
                            # Clean up temporary mosaic
                            try:
                                os.remove(temp_mosaic)
                            except:
                                pass
                            
                            if result_clip.returncode == 0 and os.path.exists(output_file):
                                final_size = os.path.getsize(output_file)
                                print(f"Successfully created mosaic ({final_size:,} bytes from {len(downloaded_tiles)} tiles)")
                                
                                # Clean up temporary files
                                for temp_file in downloaded_tiles:
                                    try:
                                        os.remove(temp_file)
                                    except:
                                        pass
                                try:
                                    os.remove(vrt_file)
                                except:
                                    pass
                                
                                return True
                            else:
                                print(f"Failed to create final mosaic: {result_clip.stderr}")
                                return False
                                
                        except Exception as e:
                            print(f"Error creating mosaic: {e}")
                            return False
                        finally:
                            # Clean up temporary files in case of error
                            for temp_file in downloaded_tiles:
                                try:
                                    os.remove(temp_file)
                                except:
                                    pass
                            try:
                                os.remove(vrt_file)
                            except:
                                pass
                else:
                    print(f"No {source['name']} products found for this area")
                    return False
            else:
                print(f"API query failed with status: {response.getcode()}")
                return False
                
    except Exception as e:
        print(f"Error accessing {source['name']}: {e}")
        if os.path.exists(output_file):
            os.remove(output_file)
        return False

# Try elevation sources in order of preference (highest resolution first)
success = False
used_source = None

for source in ELEVATION_SOURCES:
    print(f"\n--- Attempting {source['name']} ({source['resolution']}m resolution) ---")
    
    if source["method"] == "opentopography_api":
        if try_opentopography_api(source, bounds, ELEVATION_TIF):
            success = True
            used_source = source
            break
    elif source["method"] == "elevation_package":
        if try_elevation_source(source, bounds, ELEVATION_TIF):
            success = True
            used_source = source
            break
    elif source["method"] == "viewfinder_hgt":
        if try_viewfinder_hgt(source, bounds, ELEVATION_TIF):
            success = True
            used_source = source
            break
    elif source["method"] == "usgs_3dep":
        if try_usgs_3dep(source, bounds, ELEVATION_TIF):
            success = True
            used_source = source
            break

# Try direct GDAL access to Copernicus DEM as fallback
if not success:
    print(f"\n--- Attempting direct GDAL access to Copernicus DEM ---")
    if try_gdal_direct_copernicus(bounds, ELEVATION_TIF):
        # Validate the elevation data before accepting it
        import rasterio
        try:
            with rasterio.open(ELEVATION_TIF) as src:
                test_data = src.read(1)
                min_elev = np.nanmin(test_data)
                max_elev = np.nanmax(test_data)
                elevation_range = max_elev - min_elev
                
                print(f"Elevation validation: min={min_elev:.1f}m, max={max_elev:.1f}m, range={elevation_range:.1f}m")
                
                # If all data is zeros or very low variation, don't accept this data
                if elevation_range < 1.0:  # Less than 1 meter variation
                    print("⚠️  Elevation data appears invalid (all zeros or no variation)")
                    print("Rejecting Copernicus data, will try SRTM fallback...")
                    os.remove(ELEVATION_TIF)
                    success = False
                else:
                    success = True
                    used_source = {"name": "Copernicus DEM 30m (direct GDAL)", "resolution": 30}
        except Exception as e:
            print(f"Error validating elevation data: {e}")
            success = False

if not success:
    print("All high-resolution elevation sources failed, trying default SRTM1...")
    # Final fallback to original approach
    try:
        elevation.clip(bounds=bounds, output=ELEVATION_TIF)
        print(f"elevation.clip() completed, checking if {ELEVATION_TIF} exists...")
        used_source = {"name": "SRTM 30m (fallback)", "resolution": 30}
        success = True
    except Exception as e:
        print(f"Error with elevation.clip(): {e}")

    # If elevation.tif doesn't exist, try alternative approach
    if not os.path.exists(ELEVATION_TIF):
        print("elevation.tif not found, trying alternative approach...")
        
        # Alternative: seed the data first, then manually clip
        print("Seeding elevation data...")
        elevation.seed(bounds=bounds)
        
        # Use gdal_translate directly to clip the cached VRT
        cache_dir = os.path.expanduser("~/Library/Caches/elevation/SRTM1")
        vrt_file = os.path.join(cache_dir, "SRTM1.vrt")
        
        print(f"Looking for VRT file: {vrt_file}")
        if os.path.exists(vrt_file):
            import subprocess
            print("Running gdal_translate manually...")
            cmd = [
                "gdal_translate",
                "-projwin", str(bounds[0]), str(bounds[3]), str(bounds[2]), str(bounds[1]),
                vrt_file,
                ELEVATION_TIF
            ]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"gdal_translate failed: {result.stderr}")
                raise RuntimeError(f"gdal_translate failed: {result.stderr}")
            else:
                print("gdal_translate completed successfully")
                used_source = {"name": "SRTM 30m (fallback)", "resolution": 30}
                success = True
        else:
            raise FileNotFoundError(f"Could not find SRTM VRT file at {vrt_file}")

# Check if the elevation file was created
if not os.path.exists(ELEVATION_TIF):
    raise FileNotFoundError(f"Failed to create elevation raster: {ELEVATION_TIF}")

if used_source:
    print(f"\n✓ Successfully obtained elevation data from: {used_source['name']}")
    print(f"  Resolution: {used_source.get('resolution', 'Unknown')}m")
else:
    print(f"\n✓ Successfully obtained elevation data (source unknown)")

# --- Step 3: Read elevation raster and create contour lines ---

with rasterio.open(ELEVATION_TIF) as src:
    band = src.read(1)
    band = np.where(band == src.nodata, np.nan, band)
    transform = src.transform

    # Compute contour levels
    min_elev = np.nanmin(band)
    max_elev = np.nanmax(band)
    levels = np.arange(
        np.floor(min_elev / CONTOUR_INTERVAL) * CONTOUR_INTERVAL,
        np.ceil(max_elev / CONTOUR_INTERVAL) * CONTOUR_INTERVAL,
        CONTOUR_INTERVAL,
    )

    # Plot contours using matplotlib
    fig, ax = plt.subplots()
    cs = ax.contour(band, levels=levels, linewidths=0.5)

# --- Step 4: Convert contour lines to GeoDataFrame ---

contour_features = []

# Get the CRS from the elevation raster for proper coordinate handling
with rasterio.open(ELEVATION_TIF) as src:
    raster_crs = src.crs
    print(f"Elevation raster CRS: {raster_crs}")

# Handle both old and new matplotlib API
if hasattr(cs, 'collections'):
    # Old API
    for i, collection in enumerate(cs.collections):
        level = cs.levels[i]
        for path in collection.get_paths():
            v = path.vertices
            if len(v) < 2:
                continue
            # Convert from array index to geographic coordinates
            coords = [rio_transform.xy(transform, y, x) for x, y in v]
            
            # Filter out invalid coordinates
            valid_coords = []
            for coord in coords:
                if len(coord) == 2 and not (np.isnan(coord[0]) or np.isnan(coord[1])):
                    valid_coords.append(coord)
            
            # Only create geometry if we have valid coordinates
            if len(valid_coords) >= 2:
                try:
                    line = LineString(valid_coords)
                    # Check if geometry is valid and not empty
                    if line.is_valid and not line.is_empty and line.length > 0:
                        contour_features.append({"geometry": line, "elevation": level})
                except Exception as e:
                    print(f"Skipping invalid geometry at level {level}: {e}")
                    continue
else:
    # New API
    for i, level in enumerate(cs.levels):
        for path_collection in cs.allsegs[i]:
            if len(path_collection) < 2:
                continue
            # Convert from array index to geographic coordinates
            coords = [rio_transform.xy(transform, y, x) for x, y in path_collection]
            
            # Filter out invalid coordinates
            valid_coords = []
            for coord in coords:
                if len(coord) == 2 and not (np.isnan(coord[0]) or np.isnan(coord[1])):
                    valid_coords.append(coord)
            
            # Only create geometry if we have valid coordinates
            if len(valid_coords) >= 2:
                try:
                    line = LineString(valid_coords)
                    # Check if geometry is valid and not empty
                    if line.is_valid and not line.is_empty and line.length > 0:
                        contour_features.append({"geometry": line, "elevation": level})
                except Exception as e:
                    print(f"Skipping invalid geometry at level {level}: {e}")
                    continue

print(f"Created {len(contour_features)} valid contour line features")

# Create GeoDataFrame with the same CRS as the elevation raster
if contour_features:
    contours_gdf = gpd.GeoDataFrame(contour_features, crs=raster_crs)
    print(f"Contours GDF CRS: {contours_gdf.crs}")
else:
    # Create empty GeoDataFrame with proper structure
    contours_gdf = gpd.GeoDataFrame(columns=['geometry', 'elevation'], crs=raster_crs)
    print("Warning: No contour features were created!")

# Additional cleanup: remove any empty or invalid geometries that might have slipped through
if not contours_gdf.empty:
    # Remove rows with empty geometries
    contours_gdf = contours_gdf[~contours_gdf.geometry.is_empty]
    # Remove rows with invalid geometries
    contours_gdf = contours_gdf[contours_gdf.geometry.is_valid]
    # Remove very short line segments (less than 1 meter)
    # Convert to projected CRS for accurate length calculation if needed
    if contours_gdf.crs.is_geographic:
        # For geographic CRS, use a rough filter
        contours_gdf = contours_gdf[contours_gdf.geometry.length > 1e-6]
    else:
        # For projected CRS, use meter-based filter
        contours_gdf = contours_gdf[contours_gdf.geometry.length > 1.0]  # 1 meter minimum
    
    print(f"After cleanup: {len(contours_gdf)} valid contour features remain")
else:
    print("Warning: No contour features were created!")

# --- Step 5: Clip contours to polygon ---

if not contours_gdf.empty:
    # Create polygon GDF and ensure it's in the same CRS as contours
    polygon_gdf = gpd.GeoDataFrame(geometry=[polygon], crs="EPSG:4326")
    print(f"Original polygon CRS: {polygon_gdf.crs}")
    
    # Reproject polygon to match contours CRS
    if contours_gdf.crs != polygon_gdf.crs:
        print(f"Reprojecting polygon from {polygon_gdf.crs} to {contours_gdf.crs}")
        polygon_gdf = polygon_gdf.to_crs(contours_gdf.crs)
        print(f"Polygon bounds after reprojection: {polygon_gdf.total_bounds}")
        print(f"Contours bounds: {contours_gdf.total_bounds}")
    
    # Perform the clipping
    clipped = gpd.overlay(contours_gdf, polygon_gdf, how="intersection")
    
    # Final cleanup of clipped results
    if not clipped.empty:
        clipped = clipped[~clipped.geometry.is_empty]
        clipped = clipped[clipped.geometry.is_valid]
        print(f"After clipping to polygon: {len(clipped)} contour features remain")
        
        # Convert back to WGS84 for output
        if clipped.crs != "EPSG:4326":
            print(f"Converting output from {clipped.crs} to EPSG:4326")
            clipped = clipped.to_crs("EPSG:4326")
    else:
        print("Warning: No contours remain after clipping to polygon!")
else:
    clipped = contours_gdf  # Empty dataframe

# --- Step 6: Export to GeoJSON ---

if not clipped.empty:
    clipped.to_file(OUTPUT_GEOJSON, driver="GeoJSON")
    print(f"Saved {len(clipped)} contour lines to: {OUTPUT_GEOJSON}")
    
    # Print elevation statistics
    if 'elevation' in clipped.columns:
        min_elev = clipped['elevation'].min()
        max_elev = clipped['elevation'].max()
        unique_levels = sorted(clipped['elevation'].unique())
        print(f"Elevation range: {min_elev:.1f}m to {max_elev:.1f}m")
        # print(f"Contour levels: {unique_levels}")
else:
    print("No contour lines to save - output file not created")

# Clean up temporary elevation file
if os.path.exists(ELEVATION_TIF):
    # Temporarily disable cleanup to debug
    print(f"Keeping temporary file for debugging: {ELEVATION_TIF}")
    # os.remove(ELEVATION_TIF)
    # print(f"Cleaned up temporary file: {ELEVATION_TIF}")
