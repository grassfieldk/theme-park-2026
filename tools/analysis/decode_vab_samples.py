"""Decode PlayStation VAB ADPCM sample bodies to inspection WAV files."""

from __future__ import annotations

import argparse
import json
import struct
import wave
from pathlib import Path

FILTERS = ((0, 0), (60, 0), (115, -52), (98, -55), (122, -60))


def decode(data: bytes) -> tuple[list[int], list[dict[str, int]]]:
    samples: list[int] = []
    flags: list[dict[str, int]] = []
    previous1 = 0
    previous2 = 0
    for offset in range(0, len(data) - 15, 16):
        header = data[offset]
        block_flag = data[offset + 1]
        predictor = header >> 4
        shift = header & 0x0F
        if predictor >= len(FILTERS):
            predictor = 0
        factor1, factor2 = FILTERS[predictor]
        flags.append({"sample": len(samples), "flag": block_flag})
        for packed in data[offset + 2 : offset + 16]:
            for nibble in (packed & 0x0F, packed >> 4):
                signed = nibble - 16 if nibble >= 8 else nibble
                value = (signed << 12) >> shift
                value += (previous1 * factor1 + previous2 * factor2 + 32) >> 6
                value = max(-32768, min(32767, value))
                samples.append(value)
                previous2, previous1 = previous1, value
    return samples, flags


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()

    entries = []
    for bank in sorted(args.source.glob("*.vab")):
        data = bank.read_bytes()
        programs, sample_count = struct.unpack_from("<H2xH", data, 18)
        offset_table = 32 + 128 * 16 + programs * 16 * 32
        sizes = struct.unpack_from(f"<{sample_count + 1}H", data, offset_table)[1:]
        body_offset = offset_table + 512
        position = body_offset
        bank_output = args.output / bank.stem
        bank_output.mkdir(parents=True, exist_ok=True)
        for index, units in enumerate(sizes):
            encoded_size = units * 8
            encoded = data[position : position + encoded_size]
            position += encoded_size
            pcm, flags = decode(encoded)
            destination = bank_output / f"sample_{index:02}.wav"
            with wave.open(str(destination), "wb") as output:
                output.setnchannels(1)
                output.setsampwidth(2)
                output.setframerate(44100)
                output.writeframes(struct.pack(f"<{len(pcm)}h", *pcm))
            entries.append(
                {
                    "bank": bank.name,
                    "sample": index,
                    "encodedOffset": position - encoded_size,
                    "encodedSize": encoded_size,
                    "decodedSamples": len(pcm),
                    "blockFlags": flags,
                    "output": str(destination),
                    "status": "confirmed",
                    "note": "44100 Hz is an inspection rate; playback pitch is defined by VAB tone attributes",
                }
            )
        if position != len(data):
            raise ValueError(f"{bank}: sample sizes end at {position}, file ends at {len(data)}")
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps({"samples": entries}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
