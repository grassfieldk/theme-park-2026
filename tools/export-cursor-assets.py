"""原作のパーク画面ポインタ(矢印・シャベル)を Web 用 PNG として出力し、設定を生成する。

UNPACK.PAK リソース 371 がパーク画面の UI スプライトで、テクスチャと CLUT も内包する。
フレーム 0x25 が通常操作の矢印、0x26 が設置操作のシャベル。
構造は「u16 グループ数、u16 フレーム表オフセット、記述子列、フレーム表(4 byte/枠)、
VRAM アップロード列」で、記述子はショップ等と同じ 20 byte 形式。
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PAK = ROOT / "recovery" / "disc" / "TEX" / "UNPACK.PAK"
MANIFEST = ROOT / "recovery" / "manifests" / "unpack-pak.json"
DESTINATION = ROOT / "public" / "assets" / "park"
CONFIG = ROOT / "src" / "config" / "pointers.json"

UI_RESOURCE = 371
POINTERS = [("arrow", 0x25), ("shovel", 0x26)]


def psx_color(value: int) -> tuple[int, int, int, int]:
    if value == 0:
        return 0, 0, 0, 0
    return (
        (value & 0x1F) * 255 // 31,
        ((value >> 5) & 0x1F) * 255 // 31,
        ((value >> 10) & 0x1F) * 255 // 31,
        255,
    )


def load_resource() -> bytes:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entry = {item["id"]: item for item in manifest["resources"]}[UI_RESOURCE]
    pak = PAK.read_bytes()
    return pak[entry["offset"] : entry["offset"] + entry["size"]]


def build_vram(resource: bytes) -> list[int]:
    vram = [0] * (1024 * 512)
    offset = 0
    while offset + 12 <= len(resource):
        length = struct.unpack_from("<I", resource, offset)[0] & 0xFFFFFF
        if length >= 12 and offset + length <= len(resource):
            x, y, width, height = struct.unpack_from("<4H", resource, offset + 4)
            if 0 < width <= 1024 and 0 < height <= 512 and x + width <= 1024 and y + height <= 512 \
                    and 12 + width * height * 2 <= length + 3:
                pixels = struct.unpack_from(f"<{width * height}H", resource, offset + 12)
                for row in range(height):
                    start = (y + row) * 1024 + x
                    vram[start : start + width] = pixels[row * width : (row + 1) * width]
                offset += length
                continue
        offset += 4
    return vram


def read_part(resource: bytes, vram: list[int], offset: int):
    flags, offset_x, offset_y, texture_page = struct.unpack_from("<HhhH", resource, offset)
    u, v, width, height = resource[offset + 8], resource[offset + 9], resource[offset + 10], resource[offset + 11]
    clut = struct.unpack_from("<H", resource, offset + 12)[0]
    depth = (texture_page >> 7) & 3
    pixels_per_word = 4 if depth == 0 else 2
    texture_x = (texture_page & 0xF) * 64 + u // pixels_per_word
    texture_y = (256 if texture_page & 0x10 else 0) + v
    clut_x, clut_y = (clut & 0x3F) * 16, clut >> 6
    palette = [psx_color(vram[clut_y * 1024 + clut_x + index]) for index in range(16 if depth == 0 else 256)]
    image = Image.new("RGBA", (width, height))
    out = image.load()
    for py in range(height):
        for px in range(width):
            word = vram[(texture_y + py) * 1024 + texture_x + px // pixels_per_word]
            shift = (px % pixels_per_word) * (4 if depth == 0 else 8)
            out[px, py] = palette[(word >> shift) & (0xF if depth == 0 else 0xFF)]
    return flags, offset_x, offset_y, image


def compose_frame(resource: bytes, vram: list[int], frame: int):
    table = struct.unpack_from("<H", resource, 2)[0]
    descriptor_offset = struct.unpack_from("<H", resource, table + frame * 4 + 2)[0]
    parts = []
    offset = descriptor_offset
    while True:
        flags, offset_x, offset_y, image = read_part(resource, vram, offset)
        parts.append((offset_x, offset_y, image))
        if flags & 0x8000:
            break
        offset += 20
    left = min(-offset_x for offset_x, _oy, _im in parts)
    top = min(-offset_y for _ox, offset_y, _im in parts)
    right = max(-offset_x + im.width for offset_x, _oy, im in parts)
    bottom = max(-offset_y + im.height for _ox, offset_y, im in parts)
    output = Image.new("RGBA", (max(1, right - left), max(1, bottom - top)))
    for offset_x, offset_y, image in reversed(parts):
        output.alpha_composite(image, (-offset_x - left, -offset_y - top))
    return output, -left, -top


def main() -> None:
    resource = load_resource()
    vram = build_vram(resource)
    entries = {}
    for slug, frame in POINTERS:
        image, anchor_x, anchor_y = compose_frame(resource, vram, frame)
        image.save(DESTINATION / f"pointer-{slug}.png")
        entries[slug] = {"src": f"/assets/park/pointer-{slug}.png", "offset": {"x": anchor_x, "y": anchor_y}}
    CONFIG.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(entries)} pointers")


if __name__ == "__main__":
    main()
