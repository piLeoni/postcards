#!/usr/bin/env python3
"""Bulk-upload a job folder to FluidNC SD and optionally start part_01.

Creates the SD directory (WebDAV MKCOL), then PUTs each part_*.gcode.
Multipart /upload into a missing folder silently fails on FluidNC — do not use it.

Usage:
  ./upload_fluidnc.py exports/1730_highland_pl_berkeley_ca_94709 --host 10.0.0.131
  ./upload_fluidnc.py exports/1730_highland_pl_berkeley_ca_94709 --host 10.0.0.131 --run
  FLUIDNC_HOST=10.0.0.131 ./upload_fluidnc.py exports/my_job --run
"""

from __future__ import annotations

import argparse
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def _host(raw: str) -> str:
    return raw.strip().removeprefix("http://").removeprefix("https://").rstrip("/")


def mkcol(host: str, sd_dir: str, timeout: float = 30.0) -> None:
    """Create SD directory via WebDAV. 201 created, 405/409 already exists → ok."""
    name = sd_dir.strip("/")
    url = f"http://{host}/sd/{urllib.parse.quote(name)}"
    req = urllib.request.Request(url, method="MKCOL")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp.read()
        print(f"created SD dir /{name}")
    except urllib.error.HTTPError as e:
        if e.code in (301, 405, 409, 420):
            print(f"SD dir /{name} already exists")
            e.read()
            return
        raise SystemExit(f"MKCOL /{name} failed: HTTP {e.code} {e.reason}") from e


def put_file(host: str, local: Path, sd_path: str, timeout: float = 180.0) -> None:
    """WebDAV PUT to /sd/... — creates/overwrites the file."""
    rel = sd_path if not sd_path.startswith("/") else sd_path[1:]
    url = f"http://{host}/sd/{urllib.parse.quote(rel, safe='/')}"
    data = local.read_bytes()
    req = urllib.request.Request(
        url,
        data=data,
        method="PUT",
        headers={"Content-Type": "application/octet-stream", "Content-Length": str(len(data))},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
        if resp.status not in (200, 201, 204):
            raise SystemExit(f"PUT {sd_path} returned HTTP {resp.status}: {body[:200]!r}")


def list_sd(host: str, sd_dir: str, timeout: float = 30.0) -> str:
    q = urllib.parse.urlencode({"path": "/" + sd_dir.strip("/")})
    url = f"http://{host}/upload?{q}"
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def send_command(host: str, command: str, timeout: float = 30.0) -> str:
    # FluidNC: ?plain= works; ?commandText= often 500 ("WebSocket dead") from curl.
    q = urllib.parse.urlencode({"plain": command})
    url = f"http://{host}/command?{q}"
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="replace")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job_dir", type=Path, help="local folder with part_*.gcode")
    parser.add_argument(
        "--host",
        default=os.environ.get("FLUIDNC_HOST", "fluidnc.local"),
        help="FluidNC hostname or IP (default: FLUIDNC_HOST or fluidnc.local)",
    )
    parser.add_argument(
        "--sd-dir",
        default=None,
        help="SD folder name (default: job folder basename)",
    )
    parser.add_argument("--run", action="store_true", help="start part_01 after upload")
    parser.add_argument("--no-upload", action="store_true", help="only --run (skip upload)")
    args = parser.parse_args()

    job_dir = args.job_dir.resolve()
    if not job_dir.is_dir():
        raise SystemExit(f"not a directory: {job_dir}")

    parts = sorted(job_dir.glob("part_*.gcode"))
    if not parts:
        raise SystemExit(f"no part_*.gcode in {job_dir}")

    sd_name = (args.sd_dir or job_dir.name).strip("/")
    sd_dir = "/" + sd_name
    host = _host(args.host)

    if not args.no_upload:
        print(f"uploading {len(parts)} files → http://{host}/sd{sd_dir}/…")
        try:
            mkcol(host, sd_name)
        except urllib.error.URLError as e:
            raise SystemExit(
                f"cannot reach FluidNC at http://{host} ({e}). Set --host or FLUIDNC_HOST."
            ) from e

        for i, path in enumerate(parts, start=1):
            sd_path = f"{sd_dir}/{path.name}"
            print(f"  [{i}/{len(parts)}] {path.name} → {sd_path} ({path.stat().st_size} bytes)")
            try:
                put_file(host, path, sd_path)
            except urllib.error.HTTPError as e:
                raise SystemExit(f"PUT failed HTTP {e.code}: {e.reason}") from e
            except urllib.error.URLError as e:
                raise SystemExit(f"PUT failed ({e})") from e

        listing = list_sd(host, sd_name)
        missing = [p.name for p in parts if p.name not in listing]
        if missing:
            raise SystemExit(
                f"upload reported ok but SD listing is missing: {', '.join(missing)}\n{listing[:500]}"
            )
        print(f"upload ok — {len(parts)} files visible in {sd_dir}/")

    first = f"{sd_dir}/{parts[0].name}"
    if args.run:
        cmd = f"$SD/Run={first}"
        print(f"starting: {cmd}")
        try:
            out = send_command(host, cmd)
            if out.strip():
                print(out.strip())
        except urllib.error.HTTPError as e:
            raise SystemExit(
                f"start failed HTTP {e.code}. Upload ok — run in WebUI: {cmd}"
            ) from e
        except urllib.error.URLError as e:
            raise SystemExit(f"start failed ({e}). Upload ok — run in WebUI: {cmd}") from e
        print("job started (chained parts follow via $SD/Run)")
    else:
        print(f"to start:  $SD/Run={first}")
        print(f"or:        {sys.argv[0]} {job_dir} --host {host} --no-upload --run")


if __name__ == "__main__":
    main()
