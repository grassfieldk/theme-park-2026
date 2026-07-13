"""Split Shin Theme Park SOUND.STM into PlayStation SEQ and VAB resources."""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()

    data = args.source.read_bytes()
    if not data.startswith(b"pQES"):
        raise ValueError("SOUND.STM does not start with a PlayStation SEQ header")
    positions = []
    position = 0
    while (position := data.find(b"pBAV", position)) >= 0:
        positions.append(position)
        position += 4
    if not positions:
        raise ValueError("no PlayStation VAB banks were found")

    args.output.mkdir(parents=True, exist_ok=True)
    sequence = data[: positions[0]]
    sequence_path = args.output / "sequence.seq"
    sequence_path.write_bytes(sequence)
    banks = []
    for index, offset in enumerate(positions):
        version, bank_id, declared_size = struct.unpack_from("<III", data, offset + 4)
        programs, tones, samples = struct.unpack_from("<3H", data, offset + 18)
        end = offset + declared_size
        next_offset = positions[index + 1] if index + 1 < len(positions) else len(data)
        if end != next_offset:
            raise ValueError(f"VAB {index} declared end {end} differs from next boundary {next_offset}")
        payload = data[offset:end]
        destination = args.output / f"bank_{index:02}.vab"
        destination.write_bytes(payload)
        banks.append(
            {
                "index": index,
                "offset": offset,
                "size": len(payload),
                "version": version,
                "bankId": bank_id,
                "programs": programs,
                "tones": tones,
                "samples": samples,
                "output": str(destination),
                "sha256": sha256(payload),
                "status": "confirmed",
            }
        )
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(
        json.dumps(
            {
                "source": str(args.source),
                "sequence": {"output": str(sequence_path), "size": len(sequence), "sha256": sha256(sequence)},
                "banks": banks,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
