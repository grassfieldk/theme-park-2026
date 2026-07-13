"""TEX/UNPACK.PAK のリソース境界を実行ファイルの索引表から出力する。"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path


LOAD_ADDRESS = 0x800A7000
BOUNDARY_ADDRESS = 0x8010DAD4


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", type=Path, required=True)
    parser.add_argument("--pak", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    payload = args.payload.read_bytes()
    pak = args.pak.read_bytes()
    offset = BOUNDARY_ADDRESS - LOAD_ADDRESS
    values = struct.unpack_from(f"<{(len(payload) - offset) // 4}I", payload, offset)

    boundaries = [values[0]]
    for value in values[1:]:
        if value < boundaries[-1] or value > len(pak):
            break
        boundaries.append(value)
        if value == len(pak):
            break
    if boundaries[-1] != len(pak):
        raise ValueError("UNPACK.PAK の終端に達する境界表を見つけられません")

    resources = []
    for resource_id, (start, end) in enumerate(zip(boundaries, boundaries[1:])):
        data = pak[start:end]
        resources.append(
            {
                "id": resource_id,
                "offset": start,
                "size": end - start,
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )

    result = {
        "status": "confirmed-boundaries",
        "source": "recovery/disc/TEX/UNPACK.PAK",
        "indexSource": "recovery/code/input/SLPS_008.10.payload.bin",
        "indexAddress": f"0x{BOUNDARY_ADDRESS:08x}",
        "resourceCount": len(resources),
        "archiveSize": len(pak),
        "resources": resources,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
