import json
import subprocess
import os
import re

# Ensure error log directory exists
os.makedirs("./exports/errors", exist_ok=True)
def sanitize_filename(name):
    # Replace unwanted characters with underscores or remove them
    sanitized = re.sub(r'[^a-zA-Z0-9_-]', '_', name)
    return sanitized

# Load coordinates
# with open("data/capitals.json", "r") as file:
#     capitals = json.load(file)["capitals"]
with open("data/italy.json", "r") as file:
    cities = json.load(file)

# Loop through and run commands one by one
for c in cities:
    # command = f"python3 __init__.py --lat {lat} --lng {lng} --output './exports/{sanitize_filename(label)}.svg'"
    # command = f"python3 __init__.py --address \"{c["capital"]}, {' '.join(c["country"].split(',')[::-1])}\"  --output './exports/svg/{sanitize_filename(c["capital"])}.svg'"
    command = f"python3 __init__.py --address \"{c["city"]}, {' '.join(c["state"].split(',')[::-1])}\"  --output './exports/svg/{c["state"]}/{sanitize_filename(c["city"])}.svg'"

    print(f"Running: {c["city"]}, {c["state"]} ", command)
    
    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        if result.returncode != 0:
            raise subprocess.CalledProcessError(result.returncode, command, result.stdout, result.stderr)
    except Exception as e:
        error_path = f"./exports/errors/{sanitize_filename(c["city"])}.log"
        with open(error_path, "w") as err_file:
            err_file.write(f"Command: {command}\n\n")
            if isinstance(e, subprocess.CalledProcessError):
                err_file.write(f"stdout:\n{e.stdout}\n\nstderr:\n{e.stderr}")
            else:
                err_file.write(str(e))
        print(f"❌ Error for {c["city"]}, saved to {error_path}")
    else:
        print(f"✅ Success: {c["city"]}")
