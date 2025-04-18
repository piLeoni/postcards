import json
import subprocess
from concurrent.futures import ProcessPoolExecutor, as_completed
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
    coords = [g["coordinates"] + [g["capital"]] for g in json.load(file)["capitals"]]

# Build command list
commands = [
    (f"python3 __init__.py --lat {c[0]} --lng {c[1]} --output './exports/{sanitize_filename(c[2])}.svg'", c[2])
    for c in coords
]

# Define a runner
def run_command(command_and_label):
    command, label = command_and_label
    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        if result.returncode != 0:
            raise subprocess.CalledProcessError(result.returncode, command, result.stdout, result.stderr)
    except Exception as e:
        error_path = f"./exports/errors/{label}.log"
        with open(error_path, "w") as err_file:
            err_file.write(f"Command: {command}\n\n")
            if isinstance(e, subprocess.CalledProcessError):
                err_file.write(f"stdout:\n{e.stdout}\n\nstderr:\n{e.stderr}")
            else:
                err_file.write(str(e))
        return f"Error for {label}, saved to {error_path}"
    return f"Success: {label}"

# Run in parallel
with ProcessPoolExecutor() as executor:
    futures = [executor.submit(run_command, cmd) for cmd in commands]
    for future in as_completed(futures):
        print(future.result())
