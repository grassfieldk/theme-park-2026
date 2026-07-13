"""Extract attraction construction and maintenance costs from D2MAIN.BIN."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

FIRST_MESSAGE_ID = 190
LAST_MESSAGE_ID = 243
TABLE_FILE_OFFSET = 0x2AC0C
RECORD_SIZE = 3


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("d2main", type=Path)
    parser.add_argument("messages", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    data = args.d2main.read_bytes()
    messages = json.loads(args.messages.read_text(encoding="utf-8"))["messages"]
    by_id = {message["id"]: message for message in messages}
    attractions = []
    for index, message_id in enumerate(range(FIRST_MESSAGE_ID, LAST_MESSAGE_ID + 1)):
        offset = TABLE_FILE_OFFSET + index * RECORD_SIZE
        construction, track_unit, maintenance = data[offset : offset + RECORD_SIZE]
        attractions.append(
            {
                "attractionId": index + 1,
                "messageId": message_id,
                "name": by_id[message_id]["text"],
                "constructionCost": construction * 100,
                "trackUnitCost": track_unit,
                "maintenanceCost": maintenance * 100,
                "raw": [construction, track_unit, maintenance],
                "fileOffset": f"0x{offset:05x}",
            }
        )

    result = {
        "status": "confirmed-construction-and-maintenance; track-unit interpretation confirmed for tracked rides",
        "source": str(args.d2main).replace("\\", "/"),
        "tableFileOffset": f"0x{TABLE_FILE_OFFSET:05x}",
        "recordSize": RECORD_SIZE,
        "count": len(attractions),
        "attractions": attractions,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
