"""原作の設備(植物・トイレ・柵・ベンチ等)画像を Web 用 PNG として出力し、設定を生成する。

設備 ID・名前・面積・設置方法の根拠は `recovery/specs/facility-scenery.md` に記載する。

- ID 0〜17 は UNPACK.PAK リソース 129 を共有し、設備 ID = リソース内のグループ番号。
- ID 18(インフォメーション)と ID 19(イベントカイジョウ)はショップと同じ建物スプライトで、
  施設カタログの ID 15 / 16 のリソースを使う。
- グループ 20 以降は設備ではなく、アトラクションの敷地に敷かれる地形オブジェクトである。
"""

from __future__ import annotations

import importlib.util
import json
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def _load(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_shop = _load("export_shop_assets", "tools/export-shop-assets.py")
_facility = _load("export_facility_assets", "tools/export-facility-assets.py")

SCENERY_RESOURCE = 129
DESTINATION = ROOT / "public" / "assets" / "park" / "facilities"
ICON_DESTINATION = ROOT / "public" / "assets" / "park" / "facility-icons"
CONFIG = ROOT / "src" / "config" / "facilities.json"
TERRAIN_DESTINATION = ROOT / "public" / "assets" / "park"
TERRAIN_CONFIG = ROOT / "src" / "config" / "terrainObjects.json"

# 地形オブジェクト → (グループ番号, 使うフレーム)
# アルバトロスの敷地中央に置かれる階段と踊り場。オブジェクトコード 0x59 / 0x5a が
# `FUN_801d9694` 経由でグループ 20 のフレーム 0 / 1 を引く。
TERRAIN_OBJECTS = {"stairs": (20, [0, 1])}

# バス。`FUN_800b0710(handle, バージョン/5 + 0x15)` がグループ 21(バージョン 1〜5)/
# 22(6〜10)を選び、フレーム 0(先頭)を基準点に、フレーム 1(中間)をバージョン数だけ
# 16px 間隔で並べ、フレーム 2(後尾)をその後ろへつなげて 1 台を描く
BUS_GROUPS = [(21, [1, 5]), (22, [6, 10])]
BUS_PART_SPACING = 16
BUS_CONFIG = ROOT / "src" / "config" / "busSprites.json"

# 経済表 DAT_800a7670(SLPS_008.10, t_addr=0x800a7000, header 0x800)、12 byte/件の +0 が設置費。
# ID 0〜19 が設備、行 20〜25 が国別の植物(ID 6 の実費)。
EXE = ROOT / "recovery" / "disc" / "SLPS_008.10"
ECONOMY_VADDR = 0x800A7670
ECONOMY_STRIDE = 12


def read_construction_costs() -> tuple[list[int], list[int]]:
    exe = EXE.read_bytes()
    base = 0x800 - 0x800A7000

    def cost(row: int) -> int:
        return struct.unpack_from("<h", exe, base + ECONOMY_VADDR + row * ECONOMY_STRIDE)[0]

    return [cost(row) for row in range(20)], [cost(20 + country) for country in range(6)]

# 設備 ID → (スラッグ, 名前, 幅, 高さ, 設置方法)
FACILITIES = [
    (0, "orange-tree", "オレンジのキ", 1, 1, "place"),
    (1, "oak-tree", "カシのキ", 2, 2, "place"),
    (2, "birch-tree", "カバのキ", 1, 1, "place"),
    (3, "palm-tree", "ヤシのキ", 1, 1, "place"),
    (4, "strange-tree", "あやしいキ", 2, 2, "place"),
    (5, "ginkgo-tree", "イチョウのキ", 1, 1, "place"),
    (6, "country-plant", "サクラのキ", 1, 1, "place"),
    (7, "toilet", "トイレ", 1, 1, "directional"),
    (8, "super-toilet", "スーパートイレ", 1, 1, "directional"),
    (9, "hedge", "イケガキ", 1, 1, "fence"),
    (10, "white-fence", "シロイサク", 1, 1, "fence"),
    (11, "wood-fence", "キのサク", 1, 1, "fence"),
    (12, "street-lamp", "ガイトウ", 1, 1, "place"),
    (13, "pond", "イケ", 1, 1, "pond"),
    (14, "fountain", "フンスイ", 3, 3, "place"),
    (15, "trash-can", "ゴミバコ", 1, 1, "directional"),
    (16, "bench", "ベンチ", 2, 2, "directional"),
    (17, "clock-tower", "トケイダイ", 1, 1, "place"),
    (18, "information", "インフォメーション", 3, 3, "building"),
    (19, "event-hall", "イベントカイジョウ", 6, 6, "building"),
]

# ID 6 は国によって名前が変わる。日本(索引 1)だけ面積が 2 × 2 になる。
COUNTRY_PLANTS = ["バラのキ", "サクラのキ", "チューリップ", "バナナのキ", "サボテン", "シンヨウジュ"]

# 建物スプライトを持つ設備 → 施設カタログの ID
BUILDING_RESOURCE = {18: 15, 19: 16}


def psx_color(value: int) -> tuple[int, int, int, int]:
    if value == 0:
        return 0, 0, 0, 0
    return (
        (value & 0x1F) * 255 // 31,
        ((value >> 5) & 0x1F) * 255 // 31,
        ((value >> 10) & 0x1F) * 255 // 31,
        255,
    )


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


def compose_frame(resource: bytes, vram: list[int], descriptor_offset: int):
    """descriptor チェーン(0x8000 終端)を合成し、画像と基準点(-left, -top)を返す。"""
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


def make_icon(image: Image.Image) -> Image.Image:
    icon = Image.new("RGBA", (16, 16))
    scaled = image
    if image.width > 16 or image.height > 16:
        ratio = min(16 / image.width, 16 / image.height)
        scaled = image.resize((max(1, round(image.width * ratio)), max(1, round(image.height * ratio))), Image.NEAREST)
    icon.alpha_composite(scaled, ((16 - scaled.width) // 2, (16 - scaled.height) // 2))
    return icon


def open_resource(pak: bytes, resources: dict, resource_id: int):
    entry = resources[resource_id]
    resource = pak[entry["offset"] : entry["offset"] + entry["size"]]
    section_count = struct.unpack_from("<H", resource)[0]
    sections = [struct.unpack_from("<H", resource, 2 + index * 2)[0] for index in range(section_count)]
    package_offset = resource.find(b"\x0d\x60", sections[-1])
    return resource, sections, section_count, package_offset


def make_scenery_exporter(pak: bytes, resources: dict):
    """リソース 129 のグループを設備 ID ごとに書き出す関数を作る。"""
    resource, sections, section_count, package_offset = open_resource(pak, resources, SCENERY_RESOURCE)
    vram = _shop.build_vram(resource, package_offset, resource[package_offset + 2])

    def export(facility_id: int, slug: str):
        section_end = sections[facility_id + 1] if facility_id + 1 < section_count else package_offset
        frames = (section_end - sections[facility_id]) // 4
        offsets = []
        for frame in range(frames):
            descriptor_offset = struct.unpack_from("<H", resource, sections[facility_id] + frame * 4 + 2)[0]
            image, anchor_x, anchor_y = compose_frame(resource, vram, descriptor_offset)
            image.save(DESTINATION / f"{slug}-{frame}.png")
            offsets.append({"x": anchor_x, "y": anchor_y})
            if frame == 0:
                make_icon(image).save(ICON_DESTINATION / f"{slug}.png")
        return frames, offsets

    def export_terrain(group: int, frames: list[int], slug: str):
        entries = []
        for index, frame in enumerate(frames):
            descriptor_offset = struct.unpack_from("<H", resource, sections[group] + frame * 4 + 2)[0]
            image, anchor_x, anchor_y = compose_frame(resource, vram, descriptor_offset)
            image.save(TERRAIN_DESTINATION / f"terrain-{slug}-{index}.png")
            entries.append({
                "src": f"/assets/park/terrain-{slug}-{index}.png",
                "offset": {"x": anchor_x, "y": anchor_y},
            })
        return entries

    def export_bus(group: int, variant: int):
        section_end = sections[group + 1] if group + 1 < section_count else package_offset
        parts = []
        for frame in range((section_end - sections[group]) // 4):
            descriptor_offset = struct.unpack_from("<H", resource, sections[group] + frame * 4 + 2)[0]
            image, anchor_x, anchor_y = compose_frame(resource, vram, descriptor_offset)
            image.save(TERRAIN_DESTINATION / f"bus-{variant}-{frame}.png")
            parts.append({
                "src": f"/assets/park/bus-{variant}-{frame}.png",
                "offset": {"x": anchor_x, "y": anchor_y},
            })
        return parts

    return export, export_terrain, export_bus


def export_building(pak: bytes, resources: dict, palette, catalog_id: int, slug: str):
    """ショップと同じ建物スプライトを書き出す。向きは選べないので先頭の 1 枚だけ使う。"""
    resource, sections, _section_count, package_offset = open_resource(pak, resources, catalog_id)
    upload_count = resource[package_offset + 2]
    upload_vram = []
    for index in range(upload_count):
        offset = package_offset + struct.unpack_from("<I", resource, package_offset + 4 + index * 4)[0]
        _length, ux, uy, _uw, _uh = struct.unpack_from("<I4H", resource, offset)
        upload_vram.append((ux, uy))
    marker_offset = struct.unpack_from("<H", resource, sections[0] + 2)[0]
    marker_page = struct.unpack_from("<H", resource, marker_offset + 6)[0]
    marker_ppw = 4 if (marker_page >> 7) & 3 == 0 else 2
    marker_vram = (
        (marker_page & 0xF) * 64 + resource[marker_offset + 8] // marker_ppw,
        256 if marker_page & 0x10 else 0,
    )
    marker_uploads = [index for index, vram in enumerate(upload_vram) if vram == marker_vram]
    scope_end = marker_uploads[1] if len(marker_uploads) > 1 else upload_count
    image, anchor_x, anchor_y = _shop.compose_direction(
        resource, package_offset, palette, marker_offset, upload_vram, scope_end,
    )
    image.save(DESTINATION / f"{slug}-0.png")
    make_icon(image).save(ICON_DESTINATION / f"{slug}.png")
    return 1, [{"x": anchor_x, "y": anchor_y}]


def main() -> None:
    pak = _shop.PAK.read_bytes()
    resources = {entry["id"]: entry for entry in json.loads(_shop.MANIFEST.read_text(encoding="utf-8"))["resources"]}
    palette = _facility.load_facility_palette(pak, resources)

    DESTINATION.mkdir(parents=True, exist_ok=True)
    ICON_DESTINATION.mkdir(parents=True, exist_ok=True)
    for previous in DESTINATION.glob("*.png"):
        previous.unlink()

    export_scenery, export_terrain, export_bus = make_scenery_exporter(pak, resources)
    construction_costs, country_costs = read_construction_costs()

    terrain = {slug: export_terrain(group, frames, slug) for slug, (group, frames) in TERRAIN_OBJECTS.items()}
    TERRAIN_CONFIG.write_text(json.dumps(terrain, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    bus = {
        "_note": [
            "バスの車体。parts は 0 = 先頭、1 = 中間、2 = 後尾。",
            "先頭を基準点に、中間をバージョン数だけ partSpacing 間隔で並べ、後尾をその後ろへつなげる。",
            "offset は基準点から画像左上までのずらし。",
        ],
        "partSpacing": BUS_PART_SPACING,
        "variants": [
            {"versions": versions, "parts": export_bus(group, index)}
            for index, (group, versions) in enumerate(BUS_GROUPS)
        ],
    }
    BUS_CONFIG.write_text(json.dumps(bus, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    entries = []
    for facility_id, slug, name, width, height, placement in FACILITIES:
        if placement == "building":
            frames, offsets = export_building(pak, resources, palette, BUILDING_RESOURCE[facility_id], slug)
        else:
            frames, offsets = export_scenery(facility_id, slug)
        entry = {
            "id": slug,
            "name": name,
            "facilityId": facility_id,
            "width": width,
            "height": height,
            "placement": placement,
            "constructionCost": construction_costs[facility_id],
            "frames": frames,
            "imageOffsets": offsets,
            "assetBase": f"/assets/park/facilities/{slug}",
        }
        if facility_id == 6:
            entry["countryNames"] = COUNTRY_PLANTS
            entry["countryConstructionCosts"] = country_costs
        entries.append(entry)

    lines = ",\n".join("  " + json.dumps(item, ensure_ascii=False) for item in entries)
    CONFIG.write_text("[\n" + lines + "\n]\n", encoding="utf-8")
    print(f"wrote {len(entries)} facilities")


if __name__ == "__main__":
    main()
