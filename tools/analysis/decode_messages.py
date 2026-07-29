"""Decode the confirmed portion of Shin Theme Park's custom font encoding."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("messages", type=Path)
    parser.add_argument("save_load", type=Path)
    parser.add_argument("font_map", type=Path, help="tables/font-map.json")
    parser.add_argument("message_tables", type=Path, help="tables/message-tables.json")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    raw = args.messages.read_text(encoding="utf-8")
    document = json.loads(raw)
    kana_offset = int(json.loads(args.message_tables.read_text(encoding="utf-8"))["kanaKeyboard"]["saveDataOffset"], 16)
    save_data = args.save_load.read_bytes()
    keyboard = save_data[kana_offset:].split(b"\0", 1)[0].decode("shift_jis")
    characters = {index: character for index, character in enumerate(keyboard)}
    font_map = json.loads(args.font_map.read_text(encoding="utf-8"))
    for section in ("font16", "font12"):
        characters.update({int(code): character for code, character in font_map[section]["characters"].items()})

    decoded = []
    unknown_codes: set[int] = set()
    for message in document["messages"]:
        text = []
        for code in message["codes"]:
            if code == -2:
                text.append("\n")
            elif code in characters:
                text.append(characters[code])
            else:
                text.append(f"{{{code:03d}}}")
                unknown_codes.add(code)
        decoded.append({**message, "text": "".join(text).replace("．", "・")})

    result = {
        "status": "partial-font-mapped",
        "confirmedCodeRange": [0, len(keyboard) - 1],
        "fontMappedCodes": sorted(characters),
        "unknownCodes": sorted(unknown_codes),
        "messages": decoded,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
