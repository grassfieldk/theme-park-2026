"""原作のメニューアイコン(UNPACK.PAK リソース 362)を Web 用 PNG に出力する。

アイコンの配置は常駐プログラム FUN_800b9b10(0x800b9b10)の UV 計算に従う:
テクスチャページ 5(VRAM x=320〜)の 8bpp 領域、CLUT は (0,482)。
- 番号 < 0x40: x = 320 + (番号 & 7) * 8, y = 64 + (番号 >> 3) * 16
- 番号 >= 0x40: x = 344 + ((番号 - 0x40) % 5) * 8, y = ((番号 - 0x40) // 5) * 16
メニュー定義(項目数・アイコン番号列)は 0x80117b64 のテーブルによる。
"""

from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "recovery/disc/TEX/UNPACK.PAK"
MANIFEST = ROOT / "recovery/manifests/unpack-pak.json"
DESTINATION = ROOT / "public/assets/park"
RESOURCE_ID = 362
ICON_SIZE = 16
MAIN_MENU_ICONS = [0, 1, 2, 3, 4, 5, 6, 72]
ROAD_MENU_ICONS = [7, 8, 9, 10, 75, 11, 12]


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
    offset = 0
    while offset < len(resource) - 12:
        size = struct.unpack_from("<I", resource, offset)[0] & 0xFFFFFF
        x, y, width, height = struct.unpack_from("<4H", resource, offset + 4)
        if (
            12 < size <= len(resource) - offset
            and 0 < width <= 512
            and 0 < height <= 512
            and x + width <= 1024
            and y + height <= 512
            and size == 12 + width * height * 2
        ):
            pixels = struct.unpack_from(f"<{width * height}H", resource, offset + 12)
            for row in range(height):
                start = (y + row) * 1024 + x
                vram[start : start + width] = pixels[row * width : (row + 1) * width]
            offset += size
        else:
            offset += 2
    return vram


def icon_position(index: int) -> tuple[int, int]:
    if index < 0x40:
        return 320 + (index & 7) * 8, 64 + (index >> 3) * 16
    return 344 + (index - 0x40) % 5 * 8, (index - 0x40) // 5 * 16


def export_icon(vram: list[int], palette: list[tuple[int, int, int, int]], index: int) -> None:
    base_x, base_y = icon_position(index)
    pixels = bytearray()
    for y in range(ICON_SIZE):
        for x in range(ICON_SIZE):
            word = vram[(base_y + y) * 1024 + base_x + x // 2]
            pixels.extend(palette[(word >> (x % 2 * 8)) & 0xFF])
    write_png(DESTINATION / f"menu-icon-{index}.png", ICON_SIZE, ICON_SIZE, bytes(pixels))


def main() -> None:
    entry = next(
        resource
        for resource in json.loads(MANIFEST.read_text(encoding="utf-8"))["resources"]
        if resource["id"] == RESOURCE_ID
    )
    data = SOURCE.read_bytes()[entry["offset"] : entry["offset"] + entry["size"]]
    vram = load_vram(data)
    palette = [psx_color(vram[482 * 1024 + index]) for index in range(256)]
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for index in MAIN_MENU_ICONS + ROAD_MENU_ICONS:
        export_icon(vram, palette, index)


if __name__ == "__main__":
    main()
