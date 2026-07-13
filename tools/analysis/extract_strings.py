"""Extract ASCII and Shift-JIS strings from recovered game files."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def strings(data: bytes) -> list[dict[str, object]]:
    result = []
    start = 0
    position = 0
    buffer = bytearray()
    japanese = False

    def flush() -> None:
        nonlocal buffer, japanese
        if len(buffer) >= 5:
            try:
                value = buffer.decode("shift_jis")
            except UnicodeDecodeError:
                value = ""
            jp_count = sum(
                "\u3040" <= char <= "\u30ff" or "\u3400" <= char <= "\u9fff" for char in value
            )
            valid_japanese = japanese and jp_count >= 2 and jp_count / len(value) >= 0.4
            valid_ascii = not japanese and len(value) >= 5
            if value and len(value) <= 1024 and (valid_japanese or valid_ascii):
                result.append({"offset": start, "encoding": "shift_jis" if valid_japanese else "ascii", "value": value})
        buffer = bytearray()
        japanese = False

    while position < len(data):
        value = data[position]
        if 0x20 <= value <= 0x7E or 0xA1 <= value <= 0xDF:
            if not buffer:
                start = position
            buffer.append(value)
            japanese |= value >= 0xA1
            position += 1
            continue
        if (0x81 <= value <= 0x9F or 0xE0 <= value <= 0xEF) and position + 1 < len(data):
            trail = data[position + 1]
            if 0x40 <= trail <= 0xFC and trail != 0x7F:
                if not buffer:
                    start = position
                buffer.extend((value, trail))
                japanese = True
                position += 2
                continue
        flush()
        position += 1
    flush()
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    files = []
    candidates = (
        item
        for item in args.source.rglob("*")
        if item.is_file() and (item.parent.name.upper() == "PRO" or item.name.upper().startswith("SLPS_"))
    )
    for path in sorted(candidates):
        found = strings(path.read_bytes())
        if found:
            files.append({"path": path.relative_to(args.source).as_posix(), "strings": found})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"files": files}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
