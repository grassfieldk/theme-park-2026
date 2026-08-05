"""原作の来園者・スタッフのスプライトを Web 用 PNG として出力する。

所在はコードから確定した(recovery/specs/guest-sprites.md)。

- 見た目のバンク表は `DAT_8010e244`(main EXE、4 byte × 54)。各要素は UNPACK リソース
  402 / 403 / 404 をロードした先(0x80012458 / 0x80019248 / 0x80020f10)を指す。
- `FUN_801e6204`(D2MAIN)が `バンク番号 = 種別 - 1` を書き、
  `func_0x800b06d4(DAT_8010e244[バンク番号], ハンドル, 0, 0)` でスプライトを結び付ける。
- テクスチャは国別に `TEX/PEOPLEA/B/C.BIN` を VRAM へ展開したもの(`FUN_800ae9a4`)。
  日本・インド・中国・オーストラリア = A、アメリカ・ブラジル・イギリス・フランス・ロシア = B、
  エジプト = C。
- バンク先頭の 4 グループが 4 方向の歩行(各 4 コマ)。右向きは左向きの UV を
  descriptor の flags 0x0100(左右反転)で使い回す。
- 来園者は種別 1〜8 = バンク 0〜7。`DAT_801facb7`(種別 → 人数)が 1,1,1,1,2,2,3,3。
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
EXE = ROOT / "recovery" / "disc" / "SLPS_008.10"
PAK = ROOT / "recovery" / "disc" / "TEX" / "UNPACK.PAK"
MANIFEST = ROOT / "recovery" / "manifests" / "unpack-pak.json"
PEOPLE_DIR = ROOT / "recovery" / "disc" / "TEX"
DESTINATION = ROOT / "public" / "assets" / "park" / "guests"
CONFIG = ROOT / "src" / "config" / "guestSprites.json"

BANK_TABLE_VADDR = 0x8010E244
BANK_COUNT = 54
# リソース番号 → ロード先アドレス(FUN_800ae9a4 の FUN_800ae7bc 呼び出し)
RESOURCE_ADDRESS = {402: 0x80012458, 403: 0x80019248, 404: 0x80020F10}
# 国 → PEOPLE ファイル(FUN_800ae9a4 の分岐)
PEOPLE_BY_COUNTRY = {
    "japan": "A", "india": "A", "china": "A", "australia": "A",
    "america": "B", "brazil": "B", "uk": "B", "france": "B", "russia": "B",
    "egypt": "C",
}
WALK_GROUPS = 4
WALK_FRAMES = 4
# ベンチ着席ポーズ。FUN_801e6554 の着席分岐がアニメ 8 を設定し、コマ番号 = 方向
# (DAT_801fae08 経由で歩行グループと同じ並び)で固定表示する
SEAT_GROUP = 8
FLIP_X = 0x0100
# 来園者は種別 1〜8 = バンク 0〜7。`DAT_801facb7`(種別 → 人数)が 1,1,1,1,2,2,3,3 で、
# キッズ・ヤング = 1 人、カップル = 2 人、ファミリー = 3 人に対応する。
# バンク 8 は種別 9 = アウトロー(情報ウィンドウ `0x800d6cb4` が種別 9 で名前を
# 936 + [0x801c64be] にする)。4 方向の歩行だけを持つので同じ形で書き出せる。
# バンク 9〜14 はスタッフ 6 職種(順にメカニック・スイーパー・ガードマン・
# ウサギのぬいぐるみ・グーチョくん・ミュージシャン)。歩行 4 方向を持つので同じ形で書き出せる。
# バンク 15 以降はここでは出力しない(15〜16 は 6 職種と同構造の削られた枠、
# 17 以降は来園者バンクの色替えなど別用途)。
GUEST_BANKS = range(15)
# スタッフ 6 職種。種別 = 0x17 - バンク(FUN_801eb320 / FUN_801eb3c4 の `0x17 - kind`)
STAFF_BANKS = range(9, 15)
D2MAIN = ROOT / "recovery" / "disc" / "PRO" / "D2MAIN.BIN"
D2MAIN_BASE = 0x801D06F8
# 中身の無いコマ。ガードマンのグループ 5〜7 が全コマこれで、絵を持たない
EMPTY_DESCRIPTOR = 0xFFFF


def bank_end(banks, resources, index: int) -> int:
    """バンクの終わり(= 次のバンクの先頭)。最後のグループのコマ数を出すのに使う。"""
    resource_id, start = banks[index]
    end = len(resources[resource_id])
    for other in banks:
        if other is None or other[0] != resource_id:
            continue
        if start < other[1] < end:
            end = other[1]
    return end - start


def exe_offset(vaddr: int) -> int:
    return 0x800 + vaddr - 0x800A7000


def psx_color(value: int) -> tuple[int, int, int, int]:
    if value == 0:
        return 0, 0, 0, 0
    return (
        (value & 0x1F) * 255 // 31,
        ((value >> 5) & 0x1F) * 255 // 31,
        ((value >> 10) & 0x1F) * 255 // 31,
        255,
    )


def build_vram(people: bytes) -> list[int]:
    """PEOPLE?.BIN の転送ブロックを VRAM(1024 × 512 の 16bit)へ並べる。"""
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
    # 右向きは左向きと同じ UV を左右反転して使う(flags の 0x0100)
    if flags & FLIP_X:
        image = image.transpose(Image.FLIP_LEFT_RIGHT)
    return flags, offset_x, offset_y, image


def compose_frame(
    bank: bytes,
    vram: list[int],
    descriptor_offset: int,
    squeeze_family: bool = False,
    child_order: str | None = None,
):
    parts = []
    offset = descriptor_offset
    for _guard in range(32):
        flags, offset_x, offset_y, image = read_part(bank, vram, offset)
        parts.append((offset_x, offset_y, image))
        if flags & 0x8000:
            break
        offset += 20
    # ファミリー(3 人)の着席は親 2 人(両端の部品)をそれぞれ中点へ半分寄せて
    # 間隔を半分にする(独自調整。原作の間隔だと横幅が広すぎるため)。子供は中央のまま
    if squeeze_family and len(parts) == 3:
        (x0, y0, im0), (x2, y2, im2) = parts[0], parts[2]
        mid_x, mid_y = (x0 + x2) / 2, (y0 + y2) / 2
        parts[0] = (round((x0 + mid_x) / 2), round((y0 + mid_y) / 2), im0)
        parts[2] = (round((x2 + mid_x) / 2), round((y2 + mid_y) / 2), im2)
        # 着席の子供(中央の部品)の描画順を歩行時と揃える。
        # 下向きは手前(最後)、上向きは奥(最初)。左右向きは歩行時も中央のまま
        if child_order == "front":
            parts.append(parts.pop(1))
        elif child_order == "back":
            parts.insert(0, parts.pop(1))
    left = min(-offset_x for offset_x, _oy, _im in parts)
    top = min(-offset_y for _ox, offset_y, _im in parts)
    right = max(-offset_x + im.width for offset_x, _oy, im in parts)
    bottom = max(-offset_y + im.height for _ox, offset_y, im in parts)
    output = Image.new("RGBA", (max(1, right - left), max(1, bottom - top)))
    # 部品は奥から手前の順に並んでいる(ファミリーなら向きに応じて子供が先頭または末尾)
    for offset_x, offset_y, image in parts:
        output.alpha_composite(image, (-offset_x - left, -offset_y - top))
    return output, -left, -top


def read_banks(exe: bytes, resources: dict[int, bytes]):
    """バンク表を読み、(リソース番号, バンク先頭オフセット) を返す。"""
    banks = []
    for index in range(BANK_COUNT):
        pointer = struct.unpack_from("<I", exe, exe_offset(BANK_TABLE_VADDR) + index * 4)[0]
        found = None
        for resource_id, address in RESOURCE_ADDRESS.items():
            if address <= pointer < address + len(resources[resource_id]):
                found = (resource_id, pointer - address)
        banks.append(found)
    return banks


def main() -> None:
    exe = EXE.read_bytes()
    pak = PAK.read_bytes()
    entries = {entry["id"]: entry for entry in json.loads(MANIFEST.read_text(encoding="utf-8"))["resources"]}
    resources = {
        resource_id: pak[entries[resource_id]["offset"] : entries[resource_id]["offset"] + entries[resource_id]["size"]]
        for resource_id in RESOURCE_ADDRESS
    }
    banks = read_banks(exe, resources)


    DESTINATION.mkdir(parents=True, exist_ok=True)
    for previous in DESTINATION.glob("*.png"):
        previous.unlink()

    sets = {}
    for people_set in sorted(set(PEOPLE_BY_COUNTRY.values())):
        vram = build_vram((PEOPLE_DIR / f"PEOPLE{people_set}.BIN").read_bytes())
        exported = []
        for index, bank in enumerate(banks):
            if bank is None or index not in GUEST_BANKS:
                continue
            resource_id, start = bank
            data = resources[resource_id]
            group_count = struct.unpack_from("<H", data, start)[0]
            if group_count < WALK_GROUPS:
                continue
            group_offsets = [struct.unpack_from("<H", data, start + 2 + g * 2)[0] for g in range(group_count)]
            body = data[start:]
            # 4 方向 × 4 コマを 1 枚のシートにまとめる(リクエスト数を抑えるため)
            composed = []
            for direction in range(WALK_GROUPS):
                table = group_offsets[direction]
                frame_count = (group_offsets[direction + 1] - table) // 4
                if frame_count != WALK_FRAMES:
                    composed = []
                    break
                for frame in range(frame_count):
                    descriptor = struct.unpack_from("<H", body, table + frame * 4 + 2)[0]
                    composed.append(compose_frame(body, vram, descriptor))
            if not composed:
                continue
            # スタッフは歩行 4 方向のほかにも動作のグループを持つ。どれが何かは
            # コードから引けない(表 `DAT_801fadf7` は来園者の着席用で、
            # ガードマンでは中身の無いグループを指す)ので、空でないグループを
            # 全部そのまま続きの行に出し、どれを使うかは staff.json で指す
            extra_groups = []
            if index in STAFF_BANKS:
                for group in range(WALK_GROUPS, group_count):
                    table = group_offsets[group]
                    end = group_offsets[group + 1] if group + 1 < group_count else bank_end(banks, resources, index)
                    count = (end - table) // 4
                    frames = [struct.unpack_from("<H", body, table + f * 4 + 2)[0] for f in range(count)]
                    # 記述子が 0xffff のグループは中身が無い(ガードマンの 5〜7 番)
                    if not count or any(f == EMPTY_DESCRIPTOR for f in frames):
                        continue
                    extra_groups.append({"group": group, "frame": len(composed), "count": count})
                    for descriptor in frames:
                        composed.append(compose_frame(body, vram, descriptor))
                    # 行の右端まで空きを埋めて、次のグループを行頭から始める
                    while len(composed) % WALK_FRAMES:
                        composed.append(compose_frame(body, vram, frames[0]))
            # 着席ポーズ(グループ 8)を 5 行目に足す。コマ順は歩行の方向順と同じ
            if not extra_groups and group_count > SEAT_GROUP + 1:
                table = group_offsets[SEAT_GROUP]
                if (group_offsets[SEAT_GROUP + 1] - table) // 4 == WALK_FRAMES:
                    for frame in range(WALK_FRAMES):
                        descriptor = struct.unpack_from("<H", body, table + frame * 4 + 2)[0]
                        composed.append(compose_frame(
                            body, vram, descriptor,
                            squeeze_family=True,
                            child_order=("front", "back", None, None)[frame],
                        ))
            rows = len(composed) // WALK_FRAMES
            anchor_x = max(anchor for _im, anchor, _ay in composed)
            anchor_y = max(anchor for _im, _ax, anchor in composed)
            cell_width = max(anchor_x + image.width - ax for image, ax, _ay in composed)
            cell_height = max(anchor_y + image.height - ay for image, _ax, ay in composed)
            sheet = Image.new("RGBA", (cell_width * WALK_FRAMES, cell_height * rows))
            for position, (image, ax, ay) in enumerate(composed):
                column = position % WALK_FRAMES
                row = position // WALK_FRAMES
                sheet.alpha_composite(image, (column * cell_width + anchor_x - ax, row * cell_height + anchor_y - ay))
            sheet.save(DESTINATION / f"{people_set.lower()}-{index}.png")
            entry = {
                "bank": index,
                "frameWidth": cell_width,
                "frameHeight": cell_height,
                "anchorX": anchor_x,
                "anchorY": anchor_y,
            }
            if extra_groups:
                entry["groups"] = extra_groups
            exported.append(entry)
        sets[people_set.lower()] = exported
        print(f"PEOPLE{people_set}: {len(exported)} banks")

    config = {
        "_note": [
            "来園者のスプライト。set は国ごとの PEOPLE ファイル、bank は見た目の種類。",
            "1 枚のシートに 4 行(方向)× 4 列(コマ)。",
            "来園者は 5 行目が着席ポーズ(列 = 方向)。",
            "スタッフは 5 行目以降が立ち止まっているときのアニメで、idleFrame から idleCount コマ。",
            "方向は 0=下 1=上 2=左 3=右。",
            "画像は /assets/park/guests/{set}-{bank}.png。anchorX/anchorY は足元の基準点。",
        ],
        "peopleSetByCountry": PEOPLE_BY_COUNTRY,
        "sets": sets,
    }
    CONFIG.write_text(json.dumps(config, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
