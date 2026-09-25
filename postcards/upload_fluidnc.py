#!/usr/bin/env python3
"""Bulk-upload a job folder to FluidNC SD and optionally start part_01.

Creates the SD directory (WebDAV MKCOL), then PUTs each part_*.gcode.
Multipart /upload into a missing folder silently fails on FluidNC — do not use it.

Usage:
  python -m postcards upload exports/1730_highland_pl_berkeley_ca_94709 --host 10.0.0.131
  python -m postcards upload exports/1730_highland_pl_berkeley_ca_94709 --host 10.0.0.131 --run
  FLUIDNC_HOST=10.0.0.131 python -m postcards upload exports/my_job --run
"""

from __future__ import annotations

import argparse
import os
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


def upload_job(argv: list[str] | None = None) -> int:
    """Upload a job folder, and optionally start it. Returns a shell exit code."""
    parser = argparse.ArgumentParser(description="Upload a postcard job to FluidNC.")
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
    args = parser.parse_args(argv)

    job_dir = args.job_dir.resolve()
    if not job_dir.is_dir():
        print(f"error: not a directory: {job_dir}")
        return 1

    parts = sorted(job_dir.glob("part_*.gcode"))
    if not parts:
        print(f"error: no part_*.gcode in {job_dir}")
        return 1

    sd_name = (args.sd_dir or job_dir.name).strip("/")
    sd_dir = "/" + sd_name
    host = _host(args.host)

    if not args.no_upload:
        print(f"uploading {len(parts)} files → http://{host}/sd{sd_dir}/…")
        try:
            mkcol(host, sd_name)
        except urllib.error.URLError as e:
            print(f"error: cannot reach FluidNC at http://{host} ({e}). Set --host or FLUIDNC_HOST.")
            return 1

        for i, path in enumerate(parts, start=1):
            sd_path = f"{sd_dir}/{path.name}"
            print(f"  [{i}/{len(parts)}] {path.name} → {sd_path} ({path.stat().st_size} bytes)")
            try:
                put_file(host, path, sd_path)
            except urllib.error.HTTPError as e:
                print(f"error: PUT failed HTTP {e.code}: {e.reason}")
                return 1
            except urllib.error.URLError as e:
                print(f"error: PUT failed ({e})")
                return 1

        listing = list_sd(host, sd_name)
        missing = [p.name for p in parts if p.name not in listing]
        if missing:
            print(
                f"error: upload reported ok but SD listing is missing: "
                f"{', '.join(missing)}\n{listing[:500]}"
            )
            return 1
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
            print(f"error: start failed HTTP {e.code}. Upload ok — run in WebUI: {cmd}")
            return 1
        except urllib.error.URLError as e:
            print(f"error: start failed ({e}). Upload ok — run in WebUI: {cmd}")
            return 1
        print("job started (chained parts follow via $SD/Run)")
    else:
        print(f"to start:  $SD/Run={first}")
        print(f"or:        python -m postcards upload {job_dir} --host {host} --no-upload --run")
    return 0


if __name__ == "__main__":
    raise SystemExit(upload_job())
