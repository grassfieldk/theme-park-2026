"""Export recovered TMD geometry JSON to Wavefront OBJ files."""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

VERTEX_SLOTS = {
    "0x28": (3, 4, 5, 6),
    "0x2c": (9, 10, 11, 12),
    "0x38": (3, 5, 7, 9),
    "0x3c": (9, 11, 13, 15),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    for source in sorted(args.source.rglob("*.json")):
        model = json.loads(source.read_text(encoding="utf-8"))
        lines = [f"# Recovered from {model['source']}"]
        vertex_base = 1
        for obj in model["objects"]:
            lines.append(f"o object_{obj['index']}")
            for x, y, z in obj["vertices"]:
                lines.append(f"v {x} {-y} {z}")
            for primitive in obj["primitives"]:
                slots = VERTEX_SLOTS.get(primitive["mode"])
                if slots is None:
                    continue
                packet = bytes.fromhex(primitive["packetHex"])
                words = struct.unpack(f"<{len(packet) // 2}H", packet)
                indices = [words[slot] + vertex_base for slot in slots]
                if all(vertex_base <= index < vertex_base + len(obj["vertices"]) for index in indices):
                    lines.append("f " + " ".join(str(index) for index in indices))
            vertex_base += len(obj["vertices"])
        destination = args.output / source.relative_to(args.source).with_suffix(".obj")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
