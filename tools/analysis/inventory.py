"""Build a reproducible inventory of extracted game files."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter
from pathlib import Path


def entropy(data: bytes) -> float:
    if not data:
        return 0.0
    counts = Counter(data)
    return -sum((count / len(data)) * math.log2(count / len(data)) for count in counts.values())


def printable_strings(data: bytes, minimum: int = 5) -> list[str]:
    result: list[str] = []
    current = bytearray()
    for value in data:
        if 0x20 <= value <= 0x7E:
            current.append(value)
        else:
            if len(current) >= minimum:
                result.append(current.decode("ascii"))
            current.clear()
    if len(current) >= minimum:
        result.append(current.decode("ascii"))
    return result


def classify(path: Path, data: bytes) -> str:
    relative = path.as_posix().upper()
    if data.startswith(b"PS-X EXE"):
        return "psx-executable"
    if relative.endswith("SYSTEM.CNF"):
        return "boot-config"
    if relative.endswith("MOVIE.STR"):
        return "psx-stream"
    if "/PRO/" in f"/{relative}":
        return "program-overlay-or-data"
    if "/3D/" in f"/{relative}":
        return "model-or-texture-data"
    if "/TEX/" in f"/{relative}" or "/MINI/" in f"/{relative}" or "/IVENT/" in f"/{relative}":
        return "texture-or-screen-data"
    return "unknown"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    entries = []
    for path in sorted(item for item in args.root.rglob("*") if item.is_file()):
        data = path.read_bytes()
        entries.append(
            {
                "path": path.relative_to(args.root).as_posix(),
                "size": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
                "entropy": round(entropy(data), 4),
                "classification": classify(path.relative_to(args.root), data),
                "asciiStrings": printable_strings(data)[:100],
            }
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"files": entries}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
