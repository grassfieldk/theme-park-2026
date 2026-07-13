"""Extract the complete facility construction and maintenance cost catalog."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

TABLES = (
    (0x28634, 168, 22, "shop-or-service"),
    (0x2AC0C, 190, 54, "attraction"),
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("d2main", type=Path)
    parser.add_argument("messages", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    data = args.d2main.read_bytes()
    messages = json.loads(args.messages.read_text(encoding="utf-8"))["messages"]
    by_id = {message["id"]: message for message in messages}
    facilities = []
    facility_id = 1
    for table_offset, first_message_id, count, category in TABLES:
        for index in range(count):
            offset = table_offset + index * 3
            construction, auxiliary, maintenance = data[offset : offset + 3]
            message_id = first_message_id + index
            facilities.append(
                {
                    "facilityId": facility_id,
                    "category": category,
                    "messageId": message_id,
                    "name": by_id[message_id]["text"],
                    "constructionCost": construction * 100,
                    "maintenanceCost": maintenance * 100,
                    "auxiliaryValue": auxiliary,
                    "raw": [construction, auxiliary, maintenance],
                    "fileOffset": f"0x{offset:05x}",
                }
            )
            facility_id += 1

    result = {
        "status": "confirmed-construction-and-maintenance",
        "source": str(args.d2main).replace("\\", "/"),
        "recordSize": 3,
        "tables": [
            {"fileOffset": f"0x{offset:05x}", "firstMessageId": message, "count": count, "category": category}
            for offset, message, count, category in TABLES
        ],
        "count": len(facilities),
        "facilities": facilities,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
