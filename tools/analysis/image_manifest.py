"""Catalog recovered PNG images without re-encoding them."""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    images = []
    for path in sorted(args.source.rglob("*.png")):
        data = path.read_bytes()
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            raise ValueError(f"invalid PNG: {path}")
        width, height = struct.unpack_from(">II", data, 16)
        images.append(
            {
                "path": path.relative_to(args.source).as_posix(),
                "width": width,
                "height": height,
                "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "status": "confirmed",
            }
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"images": images}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
