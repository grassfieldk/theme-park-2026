"""Extract the contiguous facility-name catalog from decoded messages."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

FIRST_MESSAGE_ID = 168
LAST_MESSAGE_ID = 243


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("messages", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    messages = json.loads(args.messages.read_text(encoding="utf-8"))["messages"]
    by_id = {message["id"]: message for message in messages}
    facilities = []
    for message_id in range(FIRST_MESSAGE_ID, LAST_MESSAGE_ID + 1):
        message = by_id[message_id]
        facilities.append(
            {
                "catalogIndex": message_id - FIRST_MESSAGE_ID,
                "messageId": message_id,
                "name": message["text"],
                "codes": message["codes"],
                "nameStatus": "confirmed",
            }
        )

    result = {
        "status": "confirmed-names",
        "count": len(facilities),
        "messageRange": [FIRST_MESSAGE_ID, LAST_MESSAGE_ID],
        "catalogIndexStatus": "confirmed-message-order; runtime-type equivalence under verification",
        "facilities": facilities,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
