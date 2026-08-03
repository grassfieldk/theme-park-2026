"""アトラクションに乗っている客のスプライトと座席データを書き出す。

原作 FUN_801f8094 が、施設ごとの座席テーブル(D2MAIN 0x801fbfb8、1 種類 12 バイト)を見て
席ごとに客を描く。テーブルの中身は次のとおり。

- +0 位相カウンタの周期(0 なら乗車客を描かない種類)
- +1 姿勢の数
- +2 席数
- +4 席ごとの位相のずれ(バイト × 席数)へのポインタ
- +8 姿勢(dx, dy, アニメ番号, コマ番号 の 4 バイト)へのポインタ

席 i の姿勢 = 姿勢表[(位相カウンタ + 席のずれ[i]) % 姿勢の数]。
アニメ番号 255 の姿勢は描かない(隠れている位置)。
描画は FUN_801f8284 が来園者と同じキャラクターバンク表(本体 0x8010e244)から行う。
乗る客の見た目は来園者の歩行バンク(0〜7)に対応した専用バンク 0x1a〜0x28 になる。
"""

from __future__ import annotations

import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("guests", ROOT / "tools" / "export-guest-assets.py")
guests = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guests)

D2MAIN = ROOT / "recovery" / "disc" / "PRO" / "D2MAIN.BIN"
D2MAIN_BASE = 0x801D06F8
SEAT_TABLE = 0x801FBFB8
FACILITY_TOOL = ROOT / "tools" / "export-facility-assets.py"
ATTRACTIONS = ROOT / "src" / "config" / "attractions.json"
DESTINATION = ROOT / "public" / "assets" / "park" / "riders"
CONFIG = ROOT / "src" / "config" / "riderSprites.json"
# 来園者の歩行バンク(= 原作の種別 - 1)ごとの、乗車中の見た目。
# 2 人・3 人の区分は人数ぶん並ぶ(原作 FUN_801e4bf4)
CODES_BY_BANK = [[0x1A], [0x1B], [0x1C], [0x1D], [0x1C, 0x1D], [0x1C, 0x1D],
                 [0x25, 0x1E, 0x1F], [0x26, 0x27, 0x28]]


def read_seat_tables() -> dict[str, dict]:
    data = D2MAIN.read_bytes()

    def read(address: int, length: int) -> bytes:
        return data[address - D2MAIN_BASE : address - D2MAIN_BASE + length]

    facility_spec = importlib.util.spec_from_file_location("facilities", FACILITY_TOOL)
    facility_tool = importlib.util.module_from_spec(facility_spec)
    facility_spec.loader.exec_module(facility_tool)
    facilities = facility_tool.FACILITIES

    tables = {}
    for facility_id, resource_id in facilities.items():
        kind = resource_id - 36 + 14
        row = read(SEAT_TABLE + kind * 0xC, 0xC)
        period, pose_count = row[0], row[1]
        seats = struct.unpack_from("<H", row, 2)[0]
        if period == 0 or seats == 0:
            continue
        offsets_at, poses_at = struct.unpack_from("<2I", row, 4)
        poses = []
        for index in range(pose_count):
            dx, dy, animation, frame = struct.unpack_from("<2b2B", read(poses_at + index * 4, 4))
            poses.append(None if animation == 0xFF else {"x": dx, "y": dy, "pose": (animation, frame)})
        tables[facility_id] = {
            "period": period,
            "seatPhases": list(read(offsets_at, seats)),
            "poses": poses,
        }
    return tables


def main() -> None:
    tables = read_seat_tables()
    used = sorted({pose["pose"] for table in tables.values() for pose in table["poses"] if pose})
    pose_index = {pose: index for index, pose in enumerate(used)}

    exe = guests.EXE.read_bytes()
    pak = guests.PAK.read_bytes()
    entries = {entry["id"]: entry for entry in json.loads(guests.MANIFEST.read_text(encoding="utf-8"))["resources"]}
    resources = {
        resource_id: pak[entries[resource_id]["offset"] : entries[resource_id]["offset"] + entries[resource_id]["size"]]
        for resource_id in guests.RESOURCE_ADDRESS
    }
    banks = guests.read_banks(exe, resources)
    rider_banks = sorted({code for codes in CODES_BY_BANK for code in codes})

    DESTINATION.mkdir(parents=True, exist_ok=True)
    for previous in DESTINATION.glob("*.png"):
        previous.unlink()

    sets = {}
    for people_set in sorted(set(guests.PEOPLE_BY_COUNTRY.values())):
        vram = guests.build_vram((guests.PEOPLE_DIR / f"PEOPLE{people_set}.BIN").read_bytes())
        exported = {}
        for bank_index in rider_banks:
            bank = banks[bank_index]
            if bank is None:
                raise ValueError(f"バンク {bank_index:#x} が見つかりません")
            resource_id, start = bank
            data = resources[resource_id]
            group_count = struct.unpack_from("<H", data, start)[0]
            group_offsets = [struct.unpack_from("<H", data, start + 2 + g * 2)[0] for g in range(group_count)]
            body = data[start:]
            composed = []
            for animation, frame in used:
                table = group_offsets[animation]
                descriptor = struct.unpack_from("<H", body, table + frame * 4 + 2)[0]
                composed.append(guests.compose_frame(body, vram, descriptor))
            anchor_x = max(anchor for _image, anchor, _ay in composed)
            anchor_y = max(anchor for _image, _ax, anchor in composed)
            cell_width = max(anchor_x + image.width - ax for image, ax, _ay in composed)
            cell_height = max(anchor_y + image.height - ay for image, _ax, ay in composed)
            sheet = Image.new("RGBA", (cell_width * len(composed), cell_height))
            for position, (image, ax, ay) in enumerate(composed):
                sheet.alpha_composite(image, (position * cell_width + anchor_x - ax, anchor_y - ay))
            sheet.save(DESTINATION / f"{people_set.lower()}-{bank_index}.png")
            exported[bank_index] = {
                "frameWidth": cell_width,
                "frameHeight": cell_height,
                "anchorX": anchor_x,
                "anchorY": anchor_y,
            }
        sets[people_set.lower()] = exported
        print(f"PEOPLE{people_set}: {len(exported)} banks")

    config = {
        "_note": [
            "アトラクションに乗っている客のスプライト。set は国ごとの PEOPLE ファイル。",
            "画像は /assets/park/riders/{set}-{bank}.png で、姿勢の数だけ横に並ぶ。",
            "codesByBank は来園者の歩行バンク(0〜7)→ 乗車中のバンク(人数ぶん)。",
        ],
        "codesByBank": CODES_BY_BANK,
        "poseCount": len(used),
        "sets": sets,
    }
    CONFIG.write_text(json.dumps(config, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    catalog = json.loads(ATTRACTIONS.read_text(encoding="utf-8"))
    for entry in catalog:
        table = tables.get(entry["id"])
        entry.pop("riders", None)
        if not table:
            continue
        entry["riders"] = {
            "period": table["period"],
            "seatPhases": table["seatPhases"],
            "poses": [
                None if pose is None else {"x": pose["x"], "y": pose["y"], "frame": pose_index[pose["pose"]]}
                for pose in table["poses"]
            ],
        }
    with io.open(ATTRACTIONS, "w", encoding="utf-8", newline="\n") as file:
        json.dump(catalog, file, ensure_ascii=False, indent=1)
        file.write("\n")
    print(f"乗車客を描く種類: {len(tables)}  姿勢: {len(used)}")


if __name__ == "__main__":
    main()
