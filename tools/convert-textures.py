"""Convert Shin Theme Park VRAM upload packets to indexed PNG images."""

from __future__ import annotations

import argparse
import struct
import zlib
from pathlib import Path


def psx_color(value: int) -> tuple[int, int, int, int]:
    """Convert a PS1 BGR555 color to RGBA."""
    if value == 0:
        return 0, 0, 0, 0
    red = (value & 0x1F) * 255 // 31
    green = ((value >> 5) & 0x1F) * 255 // 31
    blue = ((value >> 10) & 0x1F) * 255 // 31
    return red, green, blue, 255


def png_chunk(kind: bytes, data: bytes) -> bytes:
    payload = kind + data
    return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload))


def write_png(path: Path, width: int, height: int, pixels: bytes) -> None:
    rows = b"".join(b"\0" + pixels[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", header)
        + png_chunk(b"IDAT", zlib.compress(rows, 9))
        + png_chunk(b"IEND", b"")
    )


def find_packets(data: bytes) -> list[tuple[int, int, int, int, bytes]]:
    packets = []
    for offset in range(0, len(data) - 12, 4):
        header, xy, dimensions = struct.unpack_from("<III", data, offset)
        size = header & 0xFFFFFF
        x, y = xy & 0xFFFF, xy >> 16
        width, height = dimensions & 0xFFFF, dimensions >> 16
        if not (0 < width <= 1024 and 0 < height <= 512):
            continue
        if x + width > 1024 or y + height > 512:
            continue
        if size != 12 + width * height * 2 or offset + size > len(data):
            continue
        packets.append((offset, width, height, x, data[offset + 12 : offset + size]))
    return packets


def decode_indexed(words: bytes, palette: list[tuple[int, int, int, int]]) -> tuple[int, bytes]:
    pixels = bytearray()
    if len(palette) == 16:
        for byte in words:
            pixels.extend(palette[byte & 0x0F])
            pixels.extend(palette[byte >> 4])
        return 4, bytes(pixels)
    for byte in words:
        pixels.extend(palette[byte])
    return 2, bytes(pixels)


def convert_file(source: Path, destination: Path) -> int:
    data = source.read_bytes()
    palettes: list[tuple[int, list[tuple[int, int, int, int]]]] = []
    images = []
    for offset, width, height, _x, payload in find_packets(data):
        if height == 1 and width in (16, 256):
            colors = [psx_color(value) for value in struct.unpack(f"<{width}H", payload)]
            palettes.append((offset, colors))
        else:
            images.append((offset, width, height, payload))

    destination.mkdir(parents=True, exist_ok=True)
    count = 0
    for offset, word_width, height, payload in images:
        preceding = [palette for palette_offset, palette in palettes if palette_offset < offset]
        if not preceding:
            continue
        palette = preceding[-1]
        scale, pixels = decode_indexed(payload, palette)
        width = word_width * scale
        name = f"{count:04d}_offset_{offset:08x}_{width}x{height}_{len(palette)}c.png"
        write_png(destination / name, width, height, pixels)
        count += 1
    return count


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--recursive", action="store_true")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    total = 0
    sources = args.source.rglob("*") if args.recursive else args.source.glob("*")
    for source in sorted(sources):
        if source.suffix.upper() not in {".BIN", ".PAK"}:
            continue
        relative = source.relative_to(args.source).with_suffix("")
        count = convert_file(source, args.output / relative)
        print(f"{source.name}: {count}")
        total += count
    print(f"total: {total}")


if __name__ == "__main__":
    main()
