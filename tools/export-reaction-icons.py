"""来園者の反応アイコン(吹き出し)を Web 用 PNG と設定ファイルに書き出す。

原作は来園者ごとに反応を 1 つ持ち(客 +0xd5)、頭の上にアイコンを描く。
描画は FUN_800c8888(0x800c8888)で、番号ごとの UV 表 0x80117a54(1 件 8 バイト、
u / v / CLUT の x / CLUT の y)を引く。絵はテクスチャページ 5(VRAM x=320)の
4bpp 領域にあり、UNPACK.PAK のリソース 363 が転送する。1 つ 24 × 19 で、
番号 0x16 と 0x1f だけ 16 幅の本体 + 8 幅の続き(表の 0x20 / 0x21)に分かれている。

反応の入れ替えは FUN_800c8af8(0x800c8af8):
優先度表 0x8011749c(番号ごとの符号つき 1 バイト、値が小さいほど強い)を見て、
新しい反応の値が今の反応の値以下なら即座に入れ替え、大きい場合は今の反応の
残り時間(客 +0x0e)が尽きているときだけ入れ替える。入れ替えると残り時間は 30
(来園者の更新 1 回 = 1 フレーム)になり、15 を切るとアイコンを消す。

番号の意味は原作コードの条件から確定した(design/20_guests.md に記載)。
"""

from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
EXE = ROOT / "recovery/disc/SLPS_008.10"
PAK = ROOT / "recovery/disc/TEX/UNPACK.PAK"
MANIFEST = ROOT / "recovery/manifests/unpack-pak.json"
DESTINATION = ROOT / "public/assets/park/reactions"
CONFIG = ROOT / "src/config/reactions.json"

RESOURCE_ID = 363
LAYOUT_TABLE = 0x80117A54
PRIORITY_TABLE = 0x8011749C
# アイコンのテクスチャページ 5 の左端(VRAM の halfword 単位)
PAGE_X = 320
ICON_WIDTH = 24
ICON_HEIGHT = 19
COUNT = 0x20
# 2 枚に分かれている番号 → 続きの表番号。本体は 16 幅、続きは 8 幅
SPLIT = {0x16: 0x20, 0x1F: 0x21}

LABELS = [
    "何か口にしたい",              # 0x00 空腹・渇きの両方がしきい値以上
    "何か食べたい",                # 0x01 空腹がしきい値以上
    "何か飲みたい",                # 0x02 渇きがしきい値以上
    "何も口にしたくない",          # 0x03 店の前で空腹・渇きの両方が 50 未満
    "何も食べたくない",            # 0x04 食べ物の店の前で空腹が 50 未満
    "何も飲みたくない",            # 0x05 飲み物の店の前で渇きが 50 未満
    "出口はどこだろう？",          # 0x06 帰宅中で疲労が限界
    "トイレはどこだろう？",        # 0x07 トイレ欲求 200 超で疲労 50 以上
    "今食べているところ",          # 0x08 満腹のまま食べ物の店を選ぼうとした
    "今飲んでいるところ",          # 0x09 満腹のまま飲み物の店を選ぼうとした
    "それはもうもっている",        # 0x0a 買った土産の店をまた選ぼうとした
    "そろそろ家に帰ろう",          # 0x0b 気分が -500 以下
    "お金がほとんどなくなった",    # 0x0c 施設の料金を払えない
    "ほとんどの乗り物に乗った",    # 0x0d 乗った種類が全体の 7 割以上
    "ここにある乗り物には全部乗った",  # 0x0e 乗った種類が全種類と同じ
    "もう帰る",                    # 0x0f 滞在値 150 以上
    "もう歩きたくない",            # 0x10 疲労が限界
    "飲み物がまずい",              # 0x11 飲み物の味付けが適正から外れている
    "食べ物がまずい",              # 0x12 食べ物の味付けが適正から外れている
    "ゲームの賞品が安い",          # 0x13 ゲームショップ(未実装)
    "ゲームに勝てるとは思えない",  # 0x14 ゲームショップ(未実装)
    "値段が高すぎる",              # 0x15 利用の点数が 0 未満
    "ぼったくりだ",                # 0x16 利用の点数が -500 未満
    "ずいぶん散らかっているな",    # 0x17 散らかりの許容値が 100 未満
    "スリルが足りない",            # 0x18 興奮度 8 以上を速度 2 未満で運転
    "ムードが足りない",            # 0x19 興奮度 2 未満を速度 8 以上で運転
    "時間が短すぎる",              # 0x1a 運転時間の設定が 2 未満
    "おもしろい！",                # 0x1b 乗り物の点数 300〜599、または気分 400 以上
    "まあまあ",                    # 0x1c 乗り物の点数 100〜299、来園時の初期値
    "つまらない",                  # 0x1d 乗り物の点数 0〜99、または気分 -400 未満
    "この店には満足だ！",          # 0x1e 店の点数 600 以上
    "この乗り物は最高だ！",        # 0x1f 乗り物の点数 600 以上
]


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


def read_exe(vaddr: int, length: int) -> bytes:
    data = EXE.read_bytes()
    offset = 0x800 + vaddr - 0x800A7000
    return data[offset : offset + length]


def draw_part(canvas: bytearray, vram: list[int], entry: tuple[int, int, int, int], left: int, width: int) -> None:
    """4bpp の絵を 1 枚ぶん画布へ写す。entry は UV 表の (u, v, CLUT x, CLUT y)。"""
    u, v, clut_x, clut_y = entry
    palette = [psx_color(vram[clut_y * 1024 + clut_x + index]) for index in range(16)]
    for row in range(ICON_HEIGHT):
        for column in range(width):
            pixel = u + column
            word = vram[(v + row) * 1024 + PAGE_X + pixel // 4]
            color = palette[(word >> (pixel % 4 * 4)) & 0xF]
            start = (row * ICON_WIDTH + left + column) * 4
            canvas[start : start + 4] = bytes(color)


def main() -> None:
    entry = next(
        resource
        for resource in json.loads(MANIFEST.read_text(encoding="utf-8"))["resources"]
        if resource["id"] == RESOURCE_ID
    )
    resource = PAK.read_bytes()[entry["offset"] : entry["offset"] + entry["size"]]
    vram = load_vram(resource)
    layout = [
        struct.unpack_from("<4h", read_exe(LAYOUT_TABLE + index * 8, 8))
        for index in range(COUNT + len(SPLIT))
    ]
    priorities = list(struct.unpack(f"<{COUNT}b", read_exe(PRIORITY_TABLE, COUNT)))
    if sorted(priorities) != list(range(1, COUNT + 1)):
        raise ValueError("優先度表が 1〜32 の並べ替えになっていません")

    DESTINATION.mkdir(parents=True, exist_ok=True)
    for previous in DESTINATION.glob("*.png"):
        previous.unlink()
    for index in range(COUNT):
        canvas = bytearray(ICON_WIDTH * ICON_HEIGHT * 4)
        if index in SPLIT:
            draw_part(canvas, vram, layout[index], 0, 16)
            draw_part(canvas, vram, layout[SPLIT[index]], 16, 8)
        else:
            draw_part(canvas, vram, layout[index], 0, ICON_WIDTH)
        write_png(DESTINATION / f"reaction-{index}.png", ICON_WIDTH, ICON_HEIGHT, bytes(canvas))

    config = {
        "_note": [
            "来園者の反応(吹き出し)。番号は原作の反応番号で、絵は",
            "/assets/park/reactions/reaction-{番号}.png。",
            "priority は値が小さいほど強く、同じか強い反応は即座に上書きする。",
            "弱い反応は今の反応の残りフレームが尽きているときだけ上書きする。",
            "表示の長さと位置は game.json の guests.reaction にある。",
        ],
        "assetBase": "/assets/park/reactions/reaction",
        "size": {"width": ICON_WIDTH, "height": ICON_HEIGHT},
        "list": [
            {"id": index, "priority": priorities[index], "label": LABELS[index]}
            for index in range(COUNT)
        ],
    }
    CONFIG.write_text(json.dumps(config, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"反応アイコン {COUNT} 種を書き出しました")


if __name__ == "__main__":
    main()
