#!/usr/bin/env python3
"""Reproducible, dependency-free packager for the 1337 js13k game.

Builds dist/1337.zip containing ONLY index.html, using a fixed timestamp and
fixed file permissions so the archive is byte-for-byte reproducible. Uses
maximum DEFLATE compression (level 9) from the Python standard library.

The archive is the js13k submission artifact. It must stay at or below
LIMIT bytes (a conservative gate below the official 13,312-byte js13k limit).
The script exits non-zero if the produced archive exceeds LIMIT.

Usage:  python3 scripts/package.py
"""
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
DIST = os.path.join(ROOT, "dist")
OUT = os.path.join(DIST, "1337.zip")

LIMIT = 13000  # bytes; conservative, also under the official js13k 13,312.
FIXED_DATE = (1980, 1, 1, 0, 0, 0)  # deterministic timestamp for reproducibility


def build():
    if not os.path.isfile(SRC):
        print("ERROR: index.html not found", file=sys.stderr)
        return 2
    os.makedirs(DIST, exist_ok=True)

    with open(SRC, "rb") as f:
        data = f.read()

    info = zipfile.ZipInfo("index.html", date_time=FIXED_DATE)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o644 << 16  # fixed rw-r--r-- permissions
    info.create_system = 3  # unix, so the archive does not vary by host OS

    with zipfile.ZipFile(OUT, "w") as z:
        z.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

    raw = len(data)
    arc = os.path.getsize(OUT)
    names = zipfile.ZipFile(OUT).namelist()

    print("raw  index.html : {:>6} bytes".format(raw))
    print("zip  1337.zip    : {:>6} bytes  ({})".format(arc, ", ".join(names)))
    print("limit            : {:>6} bytes".format(LIMIT))

    if names != ["index.html"]:
        print("ERROR: archive must contain exactly index.html", file=sys.stderr)
        return 3
    if arc > LIMIT:
        print("ERROR: archive {} > limit {} bytes".format(arc, LIMIT), file=sys.stderr)
        return 1
    print("OK: archive within limit ({} bytes headroom)".format(LIMIT - arc))
    return 0


if __name__ == "__main__":
    sys.exit(build())
