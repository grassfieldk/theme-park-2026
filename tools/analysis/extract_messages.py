"""Extract indexed 16-bit game messages from the PS-X EXE payload."""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

LOAD_ADDRESS = 0x800A7000
TABLE_ADDRESS = 0x80116C00
TABLE_END = 0x80117358
DATA_ADDRESS = 0x8010FDAC


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("payload", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data = args.payload.read_bytes()
    table_offset = TABLE_ADDRESS - LOAD_ADDRESS
    count = (TABLE_END - TABLE_ADDRESS) // 2
    offsets = struct.unpack_from(f"<{count}H", data, table_offset)
    messages = []
    for message_id, word_offset in enumerate(offsets):
        position = DATA_ADDRESS - LOAD_ADDRESS + word_offset * 2
        codes = []
        while position + 2 <= len(data):
            code = struct.unpack_from("<h", data, position)[0]
            position += 2
            if code == -1:
                break
            codes.append(code)
        else:
            raise ValueError(f"message {message_id} has no terminator")
        messages.append({"id": message_id, "idHex": f"0x{message_id:03x}", "wordOffset": word_offset, "codes": codes})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            {
                "status": "confirmed",
                "tableAddress": f"0x{TABLE_ADDRESS:08x}",
                "dataAddress": f"0x{DATA_ADDRESS:08x}",
                "messages": messages,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
