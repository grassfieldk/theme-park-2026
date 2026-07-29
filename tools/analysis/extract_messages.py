"""Extract indexed 16-bit game messages from the PS-X EXE payload."""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

from _psxmem import vaddr_to_payload_offset


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("payload", type=Path)
    parser.add_argument("tables", type=Path, help="tables/message-tables.json")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    data = args.payload.read_bytes()
    table = json.loads(args.tables.read_text(encoding="utf-8"))["messageTable"]
    table_address = int(table["tableAddress"], 16)
    table_end = int(table["tableEnd"], 16)
    data_address = int(table["dataAddress"], 16)
    stride = table["entryStride"]
    table_offset = vaddr_to_payload_offset(table_address)
    count = (table_end - table_address) // stride
    offsets = struct.unpack_from(f"<{count}H", data, table_offset)
    messages = []
    for message_id, word_offset in enumerate(offsets):
        position = vaddr_to_payload_offset(data_address) + word_offset * stride
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
                "tableAddress": f"0x{table_address:08x}",
                "dataAddress": f"0x{data_address:08x}",
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
