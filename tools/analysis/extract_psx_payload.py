"""Extract a loadable payload from a standard PS-X EXE file."""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path

HEADER_SIZE = 0x800


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("payload", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()

    data = args.source.read_bytes()
    if not data.startswith(b"PS-X EXE") or len(data) < HEADER_SIZE:
        raise ValueError("source is not a PS-X EXE")
    entry_point, _, load_address, payload_size = struct.unpack_from("<4I", data, 0x10)
    payload = data[HEADER_SIZE : HEADER_SIZE + payload_size]
    if len(payload) != payload_size:
        raise ValueError("payload is shorter than the PS-X EXE header declares")

    args.payload.parent.mkdir(parents=True, exist_ok=True)
    args.payload.write_bytes(payload)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(
        json.dumps(
            {
                "source": str(args.source),
                "payload": str(args.payload),
                "loadAddress": f"0x{load_address:08x}",
                "entryPoint": f"0x{entry_point:08x}",
                "size": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
