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
with open("data/addresses.json", "r") as file:
    capitals = json.load(file)["capitals"]

# Loop through and run commands one by one
for c in capitals:
    # command = f"python3 __init__.py --lat {lat} --lng {lng} --output './exports/{sanitize_filename(label)}.svg'"
    command = f"python3 __init__.py --address \"{c["capital"]}, {' '.join(c["country"].split(',')[::-1])}\"  --output './exports/svg/{sanitize_filename(c["capital"])}.svg'"

    print(f"Running: {c["capital"]}, {c["country"]} ", command)
    
    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        if result.returncode != 0:
            raise subprocess.CalledProcessError(result.returncode, command, result.stdout, result.stderr)
    except Exception as e:
        error_path = f"./exports/errors/{sanitize_filename(c["capital"])}.log"
        with open(error_path, "w") as err_file:
            err_file.write(f"Command: {command}\n\n")
            if isinstance(e, subprocess.CalledProcessError):
                err_file.write(f"stdout:\n{e.stdout}\n\nstderr:\n{e.stderr}")
            else:
                err_file.write(str(e))
        print(f"❌ Error for {c["capital"]}, saved to {error_path}")
    else:
        print(f"✅ Success: {c["capital"]}")
