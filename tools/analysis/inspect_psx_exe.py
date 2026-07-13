"""Read the standard header of a PlayStation PS-X EXE file."""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    data = args.source.read_bytes()
    if not data.startswith(b"PS-X EXE") or len(data) < 0x800:
        raise ValueError("source is not a PS-X EXE")
    values = struct.unpack_from("<8I", data, 0x10)
    result = {
        "source": str(args.source),
        "sha256": hashlib.sha256(data).hexdigest(),
        "entryPoint": f"0x{values[0]:08x}",
        "globalPointer": f"0x{values[1]:08x}",
        "loadAddress": f"0x{values[2]:08x}",
        "payloadSize": values[3],
        "bssAddress": f"0x{values[4]:08x}",
        "bssSize": values[5],
        "stackAddress": f"0x{values[6]:08x}",
        "stackSize": values[7],
        "fileSize": len(data),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
