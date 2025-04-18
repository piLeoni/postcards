import requests
import json
# Your Mapbox access token
MAPBOX_TOKEN = 'pk.eyJ1Ijoic2Vjb25kc2t5IiwiYSI6ImNtOWpoMXhiZTBjdHkya3B4aXk4M3RzbWoifQ.BkWbLZVqAQLVk1ntTSP1ow'

def geocode_address(address):
    url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{address}.json"
    params = {
        'access_token': MAPBOX_TOKEN,
        'limit': 1  # Just get the best match
    }
    response = requests.get(url, params=params)
    data = response.json()

    if data['features']:
        lon, lat = data['features'][0]['geometry']['coordinates']
        return lat, lon
    else:
        return None

with open("data/capitals.json", "r") as file:
    capitals = json.load(file)
    for capital in capitals["capitals"]:
        print(f"{capital["capital"]}, {capital["country"]}")
        capital["coordinates"] = geocode_address(f"{capital["capital"]}, {capital["country"]}")
        with open("data/addresses.json", "w", encoding='utf-8') as output:
            output.write(json.dumps(capitals))
    

# # Example: A list of addresses
# addresses = [
#     "London",
#     "Paris",
#     "San Francisco",
#     "Milan",
#     "Zurich"
# ]
# import subprocess

# for addr in addresses:
#     coords = geocode_address(addr)
#     if coords:
#         command = f"python3 __init__.py --lat {coords[0]} --lng {coords[1]} --output './exports/{addr}.svg'"
#         print(command)
#         try:
#             result = subprocess.run(command.split(), capture_output=True, text=True, check=True)
#             print(f"{addr} SVG generation successful! ")

#         except subprocess.CalledProcessError as e:
#             with open(f"./exports/{addr}.txt", 'w') as log_file:
#                 log_file.write(f"Error occurred at {e.stderr}\n")

#             print(f"Error: {addr}")

#     else:
#         print(f"{addr} => Not found")
