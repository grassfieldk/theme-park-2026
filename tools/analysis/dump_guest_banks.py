"""来園者バンク表(`DAT_8010e244`、54 件)の中身を 1 バンク 1 枚の一覧画像にして書き出す。

バンク番号はコードのバンク表の添字そのものなので、
「どのバンクか」は絵を見ずに決まる。見て決めるのは
「そのバンクが何のキャラクターか」の当たりを付けるところまでで、
実際に紐づけるときは原作コードでそのバンクを使う箇所を確かめること。

出力先: recovery/assets/guest-banks/bank-NN.png(行 = グループ、列 = コマ)
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import importlib

guest = importlib.import_module("export-guest-assets".replace("-", "_")) if False else None

ROOT = Path(__file__).resolve().parent.parent.parent
EXE = ROOT / "recovery" / "disc" / "SLPS_008.10"
PAK = ROOT / "recovery" / "disc" / "TEX" / "UNPACK.PAK"
MANIFEST = ROOT / "recovery" / "manifests" / "unpack-pak.json"
PEOPLE = ROOT / "recovery" / "disc" / "TEX" / "PEOPLEA.BIN"
DESTINATION = ROOT / "recovery" / "assets" / "guest-banks"

BANK_TABLE_VADDR = 0x8010E244
BANK_COUNT = 54
RESOURCE_ADDRESS = {402: 0x80012458, 403: 0x80019248, 404: 0x80020F10}
FLIP_X = 0x0100
CELL = 64


def exe_offset(vaddr: int) -> int:
    return 0x800 + vaddr - 0x800A7000


def psx_color(value: int):
    if value == 0:
        return 0, 0, 0, 0
    return (
        (value & 0x1F) * 255 // 31,
        ((value >> 5) & 0x1F) * 255 // 31,
        ((value >> 10) & 0x1F) * 255 // 31,
        255,
    )


def build_vram(people: bytes) -> list[int]:
    vram = [0] * (1024 * 512)
    offset = 4
    while offset + 12 <= len(people):
        header, x, y, width, height = struct.unpack_from("<I4H", people, offset)
        size = header & 0xFFFFFF
        if size < 12 or offset + size > len(people):
            break
        expected = width * height * 2
        if expected and offset + 12 + expected <= len(people):
            values = struct.unpack_from(f"<{width * height}H", people, offset + 12)
            for row in range(height):
                start = (y + row) * 1024 + x
                vram[start : start + width] = values[row * width : (row + 1) * width]
        offset += size
    return vram


def read_part(bank: bytes, vram: list[int], offset: int):
    flags, offset_x, offset_y, texture_page = struct.unpack_from("<HhhH", bank, offset)
    u, v, width, height = bank[offset + 8], bank[offset + 9], bank[offset + 10], bank[offset + 11]
    clut = struct.unpack_from("<H", bank, offset + 12)[0]
    depth = (texture_page >> 7) & 3
    pixels_per_word = 4 if depth == 0 else 2
    texture_x = (texture_page & 0xF) * 64 + u // pixels_per_word
    texture_y = (256 if texture_page & 0x10 else 0) + v
    clut_x, clut_y = (clut & 0x3F) * 16, clut >> 6
    palette = [psx_color(vram[clut_y * 1024 + clut_x + index]) for index in range(16 if depth == 0 else 256)]
    image = Image.new("RGBA", (max(1, width), max(1, height)))
    out = image.load()
    for py in range(height):
        for px in range(width):
            word = vram[(texture_y + py) * 1024 + texture_x + px // pixels_per_word]
            shift = (px % pixels_per_word) * (4 if depth == 0 else 8)
            out[px, py] = palette[(word >> shift) & (0xF if depth == 0 else 0xFF)]
    if flags & FLIP_X:
        image = image.transpose(Image.FLIP_LEFT_RIGHT)
    return flags, offset_x, offset_y, image


def compose_frame(bank: bytes, vram: list[int], descriptor_offset: int):
    parts = []
    offset = descriptor_offset
    for _guard in range(32):
        flags, offset_x, offset_y, image = read_part(bank, vram, offset)
        parts.append((offset_x, offset_y, image))
        if flags & 0x8000:
            break
        offset += 20
    left = min(-ox for ox, _oy, _im in parts)
    top = min(-oy for _ox, oy, _im in parts)
    right = max(-ox + im.width for ox, _oy, im in parts)
    bottom = max(-oy + im.height for _ox, oy, im in parts)
    output = Image.new("RGBA", (max(1, right - left), max(1, bottom - top)))
    for ox, oy, image in parts:
        output.alpha_composite(image, (-ox - left, -oy - top))
    return output


def main() -> None:
    exe = EXE.read_bytes()
    pak = PAK.read_bytes()
    entries = {e["id"]: e for e in json.loads(MANIFEST.read_text(encoding="utf-8"))["resources"]}
    resources = {
        rid: pak[entries[rid]["offset"] : entries[rid]["offset"] + entries[rid]["size"]]
        for rid in RESOURCE_ADDRESS
    }
    vram = build_vram(PEOPLE.read_bytes())
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for previous in DESTINATION.glob("*.png"):
        previous.unlink()

    for index in range(BANK_COUNT):
        pointer = struct.unpack_from("<I", exe, exe_offset(BANK_TABLE_VADDR) + index * 4)[0]
        found = None
        for rid, address in RESOURCE_ADDRESS.items():
            if address <= pointer < address + len(resources[rid]):
                found = (rid, pointer - address)
        if not found:
            continue
        rid, start = found
        data = resources[rid]
        body = data[start:]
        count = struct.unpack_from("<H", body, 0)[0]
        if not 0 < count < 64:
            continue
        offsets = [struct.unpack_from("<H", body, 2 + g * 2)[0] for g in range(count)]
        rows = []
        for g in range(count):
            end = offsets[g + 1] if g + 1 < count else offsets[g] + 4
            frames = max(1, (end - offsets[g]) // 4)
            row = []
            for f in range(min(frames, 12)):
                descriptor = struct.unpack_from("<H", body, offsets[g] + f * 4 + 2)[0]
                if descriptor == 0xFFFF or descriptor + 20 > len(body):
                    continue
                try:
                    row.append(compose_frame(body, vram, descriptor))
                except Exception:
                    continue
            if row:
                rows.append(row)
        if not rows:
            continue
        width = CELL * max(len(r) for r in rows)
        sheet = Image.new("RGBA", (width, CELL * len(rows)))
        for ri, row in enumerate(rows):
            for ci, image in enumerate(row):
                sheet.alpha_composite(
                    image,
                    (ci * CELL + (CELL - image.width) // 2, ri * CELL + (CELL - image.height) // 2),
                )
        sheet.save(DESTINATION / f"bank-{index:02}.png")
        print(f"bank {index:2} res{rid} +{start:#07x} groups={count} rows={[len(r) for r in rows]}")


if __name__ == "__main__":
    main()
