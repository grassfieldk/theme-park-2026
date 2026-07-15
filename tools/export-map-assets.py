"""原作のマップ描画定義が指定する CLUT で Web 用 PNG を出力する。"""

from __future__ import annotations

import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "recovery/disc/TEX/UNPACK.PAK"
DESTINATION = ROOT / "public/assets/park"
RESOURCE_OFFSET = 6_206_612
RESOURCE_SIZE = 33_932
RESOURCE_UPLOAD_OFFSET = 0xE10
ASSETS = {
    **{f"road-frame-{index}.png": 0x2C + index * 0x14 for index in range(16)},
    "ground-tile.png": 0x144,
    "gate-base-2.png": 0x40,
    "gate-base-3.png": 0x2C,
    "gate-base-6.png": 0x68,
    "gate-base-17.png": 0x130,
    "gate-base-19.png": 0x11C,
    "border-top.png": 0x784,
    "border-side.png": 0x798,
    "border-top-left.png": 0x7AC,
    "border-top-right.png": 0x7C0,
    "border-bottom-right.png": 0x7D4,
    "border-bottom-left.png": 0x7E8,
    "gate-left-tower.png": 0x7FC,
    "gate-left-base.png": 0x810,
    "gate-left-roof.png": 0x824,
    "gate-sign.png": 0x838,
    "gate-window.png": 0x84C,
    "gate-sign-base.png": 0x89C,
    "gate-right-tower.png": 0x860,
    "gate-right-roof.png": 0x874,
    "gate-right-base.png": 0x888,
    "entrance-background-1.png": 0x8D8,
    "entrance-background-2.png": 0x8EC,
    "entrance-background-3.png": 0x900,
    "entrance-background-4.png": 0x914,
    "entrance-special-49.png": 0x8B0,
    "entrance-special-50.png": 0x8C4,
}


def psx_color(value: int) -> tuple[int, int, int, int]:
    if value == 0:
        return 0, 0, 0, 0
    return (
        (value & 0x1F) * 255 // 31,
        ((value >> 5) & 0x1F) * 255 // 31,
        ((value >> 10) & 0x1F) * 255 // 31,
        255,
    )


def chunk(kind: bytes, data: bytes) -> bytes:
    payload = kind + data
    return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload))


def write_png(path: Path, width: int, height: int, pixels: bytes) -> None:
    rows = b"".join(b"\0" + pixels[row * width * 4 : (row + 1) * width * 4] for row in range(height))
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows, 9))
        + chunk(b"IEND", b"")
    )


def load_vram(resource: bytes) -> list[int]:
    vram = [0] * (1024 * 512)
    offset = RESOURCE_UPLOAD_OFFSET + 4
    while True:
        size = struct.unpack_from("<I", resource, offset)[0]
        if size == 0xFFFFFFFF:
            return vram
        length = size & 0xFFFFFF
        x, y = struct.unpack_from("<HH", resource, offset + 4)
        width, height = struct.unpack_from("<HH", resource, offset + 8)
        pixels = struct.unpack_from(f"<{width * height}H", resource, offset + 12)
        for row in range(height):
            start = (y + row) * 1024 + x
            vram[start : start + width] = pixels[row * width : (row + 1) * width]
        offset += length


def export_asset(resource: bytes, vram: list[int], descriptor_offset: int, destination: Path) -> None:
    descriptor = resource[descriptor_offset : descriptor_offset + 20]
    texture_page = struct.unpack_from("<H", descriptor, 6)[0]
    u, v, width, height = descriptor[8:12]
    clut = struct.unpack_from("<H", descriptor, 12)[0]
    texture_x = (texture_page & 0xF) * 64 + u // 4
    texture_y = (256 if texture_page & 0x10 else 0) + v
    clut_x = (clut & 0x3F) * 16
    clut_y = clut >> 6
    palette = [psx_color(vram[clut_y * 1024 + clut_x + index]) for index in range(16)]
    pixels = bytearray()
    for y in range(height):
        for x in range(width):
            word = vram[(texture_y + y) * 1024 + texture_x + (x // 4)]
            pixels.extend(palette[(word >> ((x % 4) * 4)) & 0xF])
    write_png(destination, width, height, bytes(pixels))


def main() -> None:
    data = SOURCE.read_bytes()[RESOURCE_OFFSET : RESOURCE_OFFSET + RESOURCE_SIZE]
    vram = load_vram(data)
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for name, descriptor in ASSETS.items():
        export_asset(data, vram, descriptor, DESTINATION / name)


if __name__ == "__main__":
    main()
