"""Extract the contiguous facility-name catalog from decoded messages."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("messages", type=Path)
    parser.add_argument("tables", type=Path, help="tables/data-tables.json")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    catalog = json.loads(args.tables.read_text(encoding="utf-8"))["facilityCatalog"]
    first_message_id = catalog["firstMessageId"]
    last_message_id = catalog["lastMessageId"]
    messages = json.loads(args.messages.read_text(encoding="utf-8"))["messages"]
    by_id = {message["id"]: message for message in messages}
    facilities = []
    for message_id in range(first_message_id, last_message_id + 1):
        message = by_id[message_id]
        facilities.append(
            {
                "catalogIndex": message_id - first_message_id,
                "messageId": message_id,
                "name": message["text"],
                "codes": message["codes"],
                "nameStatus": "confirmed",
            }
        )

    result = {
        "status": "confirmed-names",
        "count": len(facilities),
        "messageRange": [first_message_id, last_message_id],
        "catalogIndexStatus": "confirmed-message-order; runtime-type equivalence under verification",
        "facilities": facilities,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
