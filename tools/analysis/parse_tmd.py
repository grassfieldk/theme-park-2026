"""Parse PlayStation TMD model containers into documented JSON."""

from __future__ import annotations

import argparse
import json
import struct
from collections import Counter
from pathlib import Path

MAGIC = 0x41
TABLE_OFFSET = 12


def vectors(data: bytes, offset: int, count: int) -> list[list[int]]:
    end = offset + count * 8
    if offset < 0 or end > len(data):
        raise ValueError("vector table is outside the file")
    return [list(struct.unpack_from("<4h", data, offset + index * 8)[:3]) for index in range(count)]


def primitives(data: bytes, offset: int, count: int) -> list[dict[str, object]]:
    result = []
    position = offset
    for _ in range(count):
        if position + 4 > len(data):
            raise ValueError("primitive header is outside the file")
        olen, ilen, flag, mode = struct.unpack_from("<4B", data, position)
        packet_size = ilen * 4
        end = position + 4 + packet_size
        if end > len(data):
            raise ValueError("primitive packet is outside the file")
        entry = {
                "offset": position,
                "outputWords": olen,
                "inputWords": ilen,
                "flag": flag,
                "mode": f"0x{mode:02x}",
                "packetHex": data[position + 4 : end].hex(),
            }
        packet = data[position + 4 : end]
        words = struct.unpack(f"<{len(packet) // 2}H", packet)
        if mode == 0x28 and len(words) >= 7:
            entry.update({"vertexIndices": list(words[3:7]), "normalIndices": [words[2]], "textured": False})
        elif mode == 0x2C and len(words) >= 13:
            entry.update(
                {
                    "vertexIndices": list(words[9:13]),
                    "normalIndices": [words[8]],
                    "uv": [[packet[index], packet[index + 1]] for index in (0, 4, 8, 12)],
                    "clut": words[1],
                    "texturePage": words[3],
                    "textured": True,
                }
            )
        elif mode == 0x38 and len(words) >= 10:
            entry.update({"vertexIndices": [words[index] for index in (3, 5, 7, 9)], "normalIndices": [words[index] for index in (2, 4, 6, 8)], "textured": False})
        elif mode == 0x3C and len(words) >= 16:
            entry.update(
                {
                    "vertexIndices": [words[index] for index in (9, 11, 13, 15)],
                    "normalIndices": [words[index] for index in (8, 10, 12, 14)],
                    "uv": [[packet[index], packet[index + 1]] for index in (0, 4, 8, 12)],
                    "clut": words[1],
                    "texturePage": words[3],
                    "textured": True,
                }
            )
        result.append(entry)
        position = end
    return result


def parse(path: Path) -> dict[str, object] | None:
    data = path.read_bytes()
    if len(data) < TABLE_OFFSET or struct.unpack_from("<I", data)[0] != MAGIC:
        return None
    flags, object_count = struct.unpack_from("<II", data, 4)
    if not 0 < object_count <= 1024 or TABLE_OFFSET + object_count * 28 > len(data):
        return None
    relative = not bool(flags & 1)
    base = TABLE_OFFSET if relative else 0
    objects = []
    for index in range(object_count):
        fields = struct.unpack_from("<7I", data, TABLE_OFFSET + index * 28)
        vertex_offset, vertex_count, normal_offset, normal_count, primitive_offset, primitive_count, scale = fields
        vertex_offset += base
        normal_offset += base
        primitive_offset += base
        objects.append(
            {
                "index": index,
                "scale": scale,
                "vertices": vectors(data, vertex_offset, vertex_count),
                "normals": vectors(data, normal_offset, normal_count),
                "primitives": primitives(data, primitive_offset, primitive_count),
            }
        )
    modes = Counter(primitive["mode"] for obj in objects for primitive in obj["primitives"])
    return {
        "source": str(path),
        "format": "PlayStation TMD",
        "flags": flags,
        "relativePointers": relative,
        "objectCount": object_count,
        "primitiveModes": dict(sorted(modes.items())),
        "objects": objects,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()

    summaries = []
    for path in sorted(item for item in args.source.rglob("*") if item.is_file()):
        try:
            model = parse(path)
        except (ValueError, struct.error) as error:
            summaries.append({"source": path.relative_to(args.source).as_posix(), "status": "invalid", "error": str(error)})
            continue
        if model is None:
            continue
        relative = path.relative_to(args.source).with_suffix(".json")
        destination = args.output / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(json.dumps(model, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        summaries.append(
            {
                "source": path.relative_to(args.source).as_posix(),
                "output": destination.relative_to(args.output).as_posix(),
                "status": "confirmed",
                "objects": model["objectCount"],
                "vertices": sum(len(obj["vertices"]) for obj in model["objects"]),
                "primitives": sum(len(obj["primitives"]) for obj in model["objects"]),
            }
        )
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps({"models": summaries}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
