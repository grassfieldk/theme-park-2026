"""Extract attraction construction and maintenance costs from D2MAIN.BIN."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("d2main", type=Path)
    parser.add_argument("messages", type=Path)
    parser.add_argument("tables", type=Path, help="tables/data-tables.json")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    economy = json.loads(args.tables.read_text(encoding="utf-8"))["economyTables"]
    record_size = economy["recordSize"]
    cost_multiplier = economy["costMultiplier"]
    attraction_table = next(entry for entry in economy["tables"] if entry["category"] == "attraction")
    table_file_offset = int(attraction_table["fileOffset"], 16)
    first_message_id = attraction_table["firstMessageId"]
    last_message_id = first_message_id + attraction_table["count"] - 1

    data = args.d2main.read_bytes()
    messages = json.loads(args.messages.read_text(encoding="utf-8"))["messages"]
    by_id = {message["id"]: message for message in messages}
    attractions = []
    for index, message_id in enumerate(range(first_message_id, last_message_id + 1)):
        offset = table_file_offset + index * record_size
        construction, track_unit, maintenance = data[offset : offset + record_size]
        attractions.append(
            {
                "attractionId": index + 1,
                "messageId": message_id,
                "name": by_id[message_id]["text"],
                "constructionCost": construction * cost_multiplier,
                "trackUnitCost": track_unit,
                "maintenanceCost": maintenance * cost_multiplier,
                "raw": [construction, track_unit, maintenance],
                "fileOffset": f"0x{offset:05x}",
            }
        )

    result = {
        "status": "confirmed-construction-and-maintenance; track-unit interpretation confirmed for tracked rides",
        "source": str(args.d2main).replace("\\", "/"),
        "tableFileOffset": f"0x{table_file_offset:05x}",
        "recordSize": record_size,
        "count": len(attractions),
        "attractions": attractions,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
