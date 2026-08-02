"""原作のマップ描画定義が指定する CLUT で Web 用 PNG を出力する。

地面・道路・ゲート土台などのパレット行(0x1e2〜0x1e4, 0x1e8, 0x1ea)は季節で入れ替わる。
`FUN_800afcb8` の対応は、季節 0/1 = シート内蔵、季節 2 = リソース 0x175、季節 3 = 0x176。
該当するアセットは [通常 | 秋 | 冬] の横 3 コマで書き出し、一覧を seasons.json に載せる。
国別の季節表は SLPS_008.10 の `DAT_80117474`(暦 `FUN_800bf6b8` が四半期で引く)。

国別の初期地形(高さマップ)と外周の飾りは terrain.json に書き出す。
- 高さマップ: リソース 0x188 + 国番号(80 × 80、`FUN_800c5e30` が読み込む)
- 縁タイル: シートのグループ 1〜3(北縁・東縁・北東縁)、コマ 14 が地面
- 崖の壁面: グループ 4/6 = 南向き(通常/北西角つき)、5/7 = 西向き。コマ 0 = 最上段、1 = 中間
- 外周の敷き詰め模様: グループ 16 のコマ 0/1(コード 0xDF/0xE0、`FUN_800c181c` が配置)
- 国 → 外周オブジェクトのコード表: WMAP.BIN 内 `DAT_801d95a0`
"""

from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "recovery/disc/TEX/UNPACK.PAK"
EXE = ROOT / "recovery/disc/SLPS_008.10"
WMAP = ROOT / "recovery/disc/PRO/WMAP.BIN"
MANIFEST = ROOT / "recovery/manifests/unpack-pak.json"
DESTINATION = ROOT / "public/assets/park"
SEASON_CONFIG = ROOT / "src/config/seasons.json"
TERRAIN_CONFIG = ROOT / "src/config/terrain.json"
RESOURCE_OFFSET = 6_206_612
RESOURCE_SIZE = 33_932
RESOURCE_UPLOAD_OFFSET = 0xE10
# 季節パレット(リソース 0x175 = 秋、0x176 = 冬。通常はシート内蔵)。5 つの CLUT 行を上書きする
AUTUMN_OFFSET, AUTUMN_SIZE = 6_240_544, 228
WINTER_OFFSET, WINTER_SIZE = 6_240_772, 228
SEASONAL_CLUT_ROWS = {0x1E2, 0x1E3, 0x1E4, 0x1E8, 0x1EA}
# 国 → 四半期(3-5月/6-8月/9-11月/12-2月)ごとの季節。DAT_80117474
COUNTRY_SEASONS_VADDR = 0x80117474
COUNTRY_IDS = ["japan", "america", "brazil", "uk", "france", "egypt", "russia", "india", "china", "australia"]
# 国 → シーナリー種(設備・木・バスのリソース選択)。DAT_8010ec90
COUNTRY_SCENERY_VADDR = 0x8010EC90
QUEUE_FRAME_START = 76
ASSETS = {
    **{f"road-frame-{index}.png": 0x2C + index * 0x14 for index in range(17)},
    **{f"build-base-frame-{index}.png": 0x978 + index * 0x14 for index in range(13)},
    **{f"facility-entrance-frame-{index}.png": 0x928 + index * 0x14 for index in range(4)},
    **{f"facility-exit-frame-{index}.png": 0xA18 + index * 0x14 for index in range(4)},
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
# 地形用スプライト → (グループ, コマ)。記述子はグループ表から引く
# 道路(コマ 0〜16)は縁のグループ 1〜3 にも同じ並びであり、縁取り付きの絵になる
GROUP_ASSETS = {
    **{
        f"road-slope{group}-frame-{frame}.png": (group, frame)
        for group in (1, 2, 3)
        for frame in range(17)
        if frame != 14
    },
    "ground-slope-1.png": (1, 14),
    "ground-slope-2.png": (2, 14),
    "ground-slope-3.png": (3, 14),
    "cliff-south-0.png": (4, 0),
    "cliff-south-1.png": (4, 1),
    "cliff-west-0.png": (5, 0),
    "cliff-west-1.png": (5, 1),
    "cliff-south-corner-0.png": (6, 0),
    "cliff-south-corner-1.png": (6, 1),
    "cliff-west-corner-0.png": (7, 0),
    "cliff-west-corner-1.png": (7, 1),
    "outside-cover-0.png": (16, 0),
    "outside-cover-1.png": (16, 1),
}
# 高さマップ: UNPACK.PAK リソース 392(0x188)+ 国番号
HEIGHT_RESOURCE_BASE = 392
HEIGHT_STEP_PX = 16
# WMAP.BIN 内 DAT_801d95a0(国 → 外周オブジェクトのコード)。
# ファイル内位置は敷地テーブル DAT_801d9500 = 0x8E08 からの相対
WMAP_OUTSIDE_OFFSET = 0x8EA8
OUTSIDE_BY_CODE = {
    0x49: {"facility": "country-plant"},
    0x44: {"facility": "oak-tree"},
    0xDF: {"cover": 0},
    0xE0: {"cover": 1},
}
# FUN_800c181c: 日本・イギリス・ロシアだけ市松状にまばら、他の国は敷き詰め
SPARSE_COUNTRIES = {0, 3, 6}


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


def descriptor_pixels(resource: bytes, vram: list[int], descriptor_offset: int) -> tuple[int, int, bytes]:
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
    for pixel_y in range(height):
        for pixel_x in range(width):
            word = vram[(texture_y + pixel_y) * 1024 + texture_x + (pixel_x // 4)]
            pixels.extend(palette[(word >> ((pixel_x % 4) * 4)) & 0xF])
    return width, height, bytes(pixels)


def clut_row(resource: bytes, descriptor_offset: int) -> int:
    return struct.unpack_from("<H", resource, descriptor_offset + 12)[0] >> 6


def apply_palette(vram: list[int], patch: bytes) -> list[int]:
    """パレットリソース(0x175/0x176)のアップロードを写した VRAM を返す。"""
    output = vram[:]
    offset = 4
    while offset + 12 <= len(patch):
        length = struct.unpack_from("<I", patch, offset)[0] & 0xFFFFFF
        if length < 12 or offset + length > len(patch):
            break
        x, y, width, _height = struct.unpack_from("<4H", patch, offset + 4)
        values = struct.unpack_from(f"<{width}H", patch, offset + 12)
        output[y * 1024 + x : y * 1024 + x + width] = values
        offset += length
    return output


def export_asset(resource: bytes, vrams: list[list[int]], descriptor_offset: int, name: str) -> tuple[str, dict] | None:
    """季節対応のアセットは [通常 | 秋 | 冬] の横並びで書き出し、設定に載せる情報を返す。"""
    if clut_row(resource, descriptor_offset) not in SEASONAL_CLUT_ROWS:
        width, height, pixels = descriptor_pixels(resource, vrams[0], descriptor_offset)
        write_png(DESTINATION / name, width, height, pixels)
        return None
    frames = [descriptor_pixels(resource, vram, descriptor_offset) for vram in vrams]
    width, height = frames[0][0], frames[0][1]
    stride = width * 4
    rows = bytearray()
    for row in range(height):
        for _width, _height, pixels in frames:
            rows.extend(pixels[row * stride : (row + 1) * stride])
    write_png(DESTINATION / name, width * len(frames), height, bytes(rows))
    return name.removesuffix(".png"), {"width": width, "height": height}


def group_descriptor(resource: bytes, group: int, frame: int) -> int:
    """グループ表(先頭 = グループ数、続いて各グループの表位置)からコマの記述子位置を引く。"""
    table = struct.unpack_from("<H", resource, 2 + group * 2)[0]
    return struct.unpack_from("<H", resource, table + frame * 4 + 2)[0]


def read_heights() -> dict[str, list[str]]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    resources = {entry["id"]: entry for entry in manifest["resources"]}
    source = SOURCE.read_bytes()
    heights = {}
    for index, country in enumerate(COUNTRY_IDS):
        entry = resources[HEIGHT_RESOURCE_BASE + index]
        grid = source[entry["offset"] : entry["offset"] + entry["size"]]
        if not any(grid):
            continue
        heights[country] = ["".join(str(grid[y * 80 + x]) for x in range(80)) for y in range(80)]
    return heights


def read_outside() -> dict[str, dict]:
    wmap = WMAP.read_bytes()
    outside = {}
    for index, country in enumerate(COUNTRY_IDS):
        code = struct.unpack_from("<H", wmap, WMAP_OUTSIDE_OFFSET + index * 2)[0]
        entry = OUTSIDE_BY_CODE.get(code)
        if entry is None:
            continue
        outside[country] = {**entry, "dense": index not in SPARSE_COUNTRIES}
    return outside


def read_country_seasons() -> dict[str, list[int]]:
    exe = EXE.read_bytes()
    base = 0x800 + COUNTRY_SEASONS_VADDR - 0x800A7000
    return {
        country: list(exe[base + index * 4 : base + index * 4 + 4])
        for index, country in enumerate(COUNTRY_IDS)
    }


def read_country_scenery() -> dict[str, int]:
    exe = EXE.read_bytes()
    base = 0x800 + COUNTRY_SCENERY_VADDR - 0x800A7000
    return {
        country: struct.unpack_from("<H", exe, base + index * 2)[0]
        for index, country in enumerate(COUNTRY_IDS)
    }


def main() -> None:
    source = SOURCE.read_bytes()
    data = source[RESOURCE_OFFSET : RESOURCE_OFFSET + RESOURCE_SIZE]
    normal = load_vram(data)
    vrams = [
        normal,
        apply_palette(normal, source[AUTUMN_OFFSET : AUTUMN_OFFSET + AUTUMN_SIZE]),
        apply_palette(normal, source[WINTER_OFFSET : WINTER_OFFSET + WINTER_SIZE]),
    ]
    DESTINATION.mkdir(parents=True, exist_ok=True)
    seasonal = {}
    for name, descriptor in ASSETS.items():
        entry = export_asset(data, vrams, descriptor, name)
        if entry:
            seasonal[entry[0]] = entry[1]
    # 整列歩道はグループ 8 の 18 コマ(14〜17 は傾斜用)
    for frame in range(18):
        descriptor_offset = 0x2C + (QUEUE_FRAME_START + frame) * 0x14
        entry = export_asset(data, vrams, descriptor_offset, f"queue-frame-{frame}.png")
        if entry:
            seasonal[entry[0]] = entry[1]
    for name, (group, frame) in GROUP_ASSETS.items():
        entry = export_asset(data, vrams, group_descriptor(data, group, frame), name)
        if entry:
            seasonal[entry[0]] = entry[1]

    config = {
        "_note": [
            "地形の季節。国ごとに四半期(3-5月/6-8月/9-11月/12-2月)を季節へ読み替え、",
            "季節 0/1 = 通常、2 = 秋、3 = 冬の色になる。",
            "seasonalAssets は [通常 | 秋 | 冬] の横 3 コマで書き出した画像の一覧。",
        ],
        "countrySeasons": read_country_seasons(),
        "countryScenery": read_country_scenery(),
        "variantBySeason": [0, 0, 1, 2],
        "seasonalAssets": seasonal,
    }
    SEASON_CONFIG.write_text(json.dumps(config, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    heights = read_heights()
    terrain = {
        "_note": [
            "国ごとの初期地形。heights は 80 × 80 の高さ(0〜3)を 1 行 1 文字列で持ち、",
            "平坦な国は載せない。高さ 1 段 = heightStepPx だけ持ち上げて描く。",
            "outside は園外の飾り。facility = 木を置く(dense=false は市松状にまばら)、",
            "cover = outside-cover-{n}.png を地面の代わりに敷き詰める。",
        ],
        "heightStepPx": HEIGHT_STEP_PX,
        "heights": heights,
        "outside": read_outside(),
    }
    TERRAIN_CONFIG.write_text(json.dumps(terrain, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"seasonal assets: {len(seasonal)}, height maps: {len(heights)}")


if __name__ == "__main__":
    main()
