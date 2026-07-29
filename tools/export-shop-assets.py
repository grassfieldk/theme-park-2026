"""原作のマップ用ショップ画像(向き別)を Web 用 PNG として出力し、設定を生成する。

ショップのリソース(UNPACK.PAK、リソース番号 = 施設 ID 1〜22)はグループ 0 のフレームが
各向きに対応する。1 つの向きは 1 枚とは限らず、アトラクション同様に複数の部品を連結して
1 枚の向き画像を作る店もある(例: バラエティショップ、ラッキーショット、ステーキハウス)。

原作は各向きを描画する直前に、その向きの部品を VRAM へアップロードする(向きによって同じ
VRAM 領域を上書きする)。そのため向き d の画像は「向き d までのアップロードを適用した VRAM」
に対して、フレーム d の descriptor チェーンを合成することで得られる。各向きの画像を
`public/assets/park/shops/{id}-{向き}.png` に出力し、施設経済テーブル
(`recovery/manifests/facility-economy.json`)の設置費・維持費と合わせて
`src/config/shops.json` を生成する。ショップの面積はすべて 5 × 5。
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import importlib.util

_spec = importlib.util.spec_from_file_location("export_facility_assets", ROOT / "tools" / "export-facility-assets.py")
_facility = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_facility)

_preview = importlib.import_module("unpack_sprites")


def build_vram(resource: bytes, package_offset: int, upload_end: int) -> list[int]:
    """パッケージ内のアップロードを先頭から upload_end 個だけ VRAM(1024×512 の 16bit)へ適用する。"""
    vram = [0] * (1024 * 512)
    upload_count = resource[package_offset + 2]
    for index in range(min(upload_end, upload_count)):
        offset = package_offset + struct.unpack_from("<I", resource, package_offset + 4 + index * 4)[0]
        length, x, y, width, height = struct.unpack_from("<I4H", resource, offset)
        pixels = _preview.decode_rle(resource[offset + 12 : offset + (length & 0xFFFFFF)], width * height * 2)
        if len(pixels) != width * height * 2:
            continue
        values = struct.unpack(f"<{width * height}H", pixels)
        for row in range(height):
            start = (y + row) * 1024 + x
            vram[start : start + width] = values[row * width : (row + 1) * width]
    return vram


def read_part(vram: list[int], palette: list[tuple[int, int, int, int]], descriptor: bytes) -> Image.Image:
    texture_page = struct.unpack_from("<H", descriptor, 6)[0]
    u, v, width, height = descriptor[8:12]
    depth = (texture_page >> 7) & 3
    pixels_per_word = 4 if depth == 0 else 2
    texture_x = (texture_page & 0xF) * 64 + u // pixels_per_word
    texture_y = (256 if texture_page & 0x10 else 0) + v
    image = Image.new("RGBA", (width, height))
    out = image.load()
    for py in range(height):
        for px in range(width):
            word = vram[(texture_y + py) * 1024 + texture_x + px // pixels_per_word]
            shift = (px % pixels_per_word) * (4 if depth == 0 else 8)
            out[px, py] = palette[(word >> shift) & (0xF if depth == 0 else 0xFF)]
    return image


def compose_direction(
    resource: bytes,
    package_offset: int,
    palette: list[tuple[int, int, int, int]],
    descriptor_offset: int,
    upload_vram: list[tuple[int, int]],
    scope_end: int,
) -> tuple[Image.Image, int, int]:
    """フレームの descriptor チェーン(0x8000 で終端)を合成し、画像と基準点(-left, -top)を返す。

    1 方向の中でも同じ VRAM 領域が後続アップロードで上書きされ、さらに次の方向がその領域を
    再アップロードせず前の方向のデータを再利用する。そのため各部品は「その部品の供給アップロード
    時点の VRAM」で読む必要がある。部品の読み取り座標 (tx, ty) は供給アップロードの座標に一致する
    ので、その座標へのアップロードのうち direction のスコープ内で最後のものまでを適用して読む。"""
    parts = []
    offset = descriptor_offset
    while True:
        descriptor = resource[offset : offset + 20]
        flags, offset_x, offset_y, texture_page = struct.unpack_from("<HhhH", descriptor)
        u, v = descriptor[8], descriptor[9]
        pixels_per_word = 4 if (texture_page >> 7) & 3 == 0 else 2
        source_vram = ((texture_page & 0xF) * 64 + u // pixels_per_word, (256 if texture_page & 0x10 else 0) + v)
        cutoffs = [index for index in range(scope_end) if upload_vram[index] == source_vram]
        upload_end = (cutoffs[-1] + 1) if cutoffs else scope_end
        vram = build_vram(resource, package_offset, upload_end)
        parts.append((offset_x, offset_y, read_part(vram, palette, descriptor)))
        if flags & 0x8000:
            break
        offset += 20
    left = min(-offset_x for offset_x, _oy, _img in parts)
    top = min(-offset_y for _ox, offset_y, _img in parts)
    right = max(-offset_x + img.width for offset_x, _oy, img in parts)
    bottom = max(-offset_y + img.height for _ox, offset_y, img in parts)
    output = Image.new("RGBA", (right - left, bottom - top))
    for offset_x, offset_y, img in reversed(parts):
        output.alpha_composite(img, (-offset_x - left, -offset_y - top))
    return output, -left, -top

PAK = ROOT / "recovery" / "disc" / "TEX" / "UNPACK.PAK"
MANIFEST = ROOT / "recovery" / "manifests" / "unpack-pak.json"
ECONOMY = ROOT / "recovery" / "manifests" / "facility-economy.json"
DESTINATION = ROOT / "public" / "assets" / "park" / "shops"
CONFIG = ROOT / "src" / "config" / "shops.json"
SHOP_SIZE = 5
SHOPS = {
    "wally-ice": 1,
    "big-burger": 2,
    "pon-pon-corn": 3,
    "steak-house": 4,
    "pizza-marukajirita": 5,
    "donkey-cola": 6,
    "coffee-shop": 7,
    "beer-hall": 8,
    "variety-shop": 9,
    "toy-zamasu": 10,
    "lucky-shot": 11,
    "kong-dunk": 12,
    "game-center": 13,
    "fortune-house": 14,
    # インフォメーション(15)・イベントカイジョウ(16)は設備でありショップではない
    "seafood-restaurant": 17,
    "chinraiken": 18,
    "kurekure-crepe": 19,
    "hirikara-curry": 20,
    "nihontei": 21,
    "every-kitchen": 22,
}


def main() -> None:
    pak = PAK.read_bytes()
    resources = {
        entry["id"]: entry
        for entry in json.loads(MANIFEST.read_text(encoding="utf-8"))["resources"]
    }
    economy = {
        entry["facilityId"]: entry
        for entry in json.loads(ECONOMY.read_text(encoding="utf-8"))["facilities"]
    }
    palette = _facility.load_facility_palette(pak, resources)
    DESTINATION.mkdir(parents=True, exist_ok=True)

    shops = []
    for shop_id, facility_id in SHOPS.items():
        entry = resources[facility_id]
        resource = pak[entry["offset"] : entry["offset"] + entry["size"]]
        section_count = struct.unpack_from("<H", resource)[0]
        sections = [struct.unpack_from("<H", resource, 2 + index * 2)[0] for index in range(section_count)]
        last_section = sections[-1]
        package_offset = resource.find(b"\x0d\x60", last_section)
        section_end = sections[1] if section_count > 1 else package_offset
        direction_count = (section_end - sections[0]) // 4
        for previous in DESTINATION.glob(f"{shop_id}-*.png"):
            previous.unlink()

        # 各アップロードの VRAM 座標(halfword)を得る
        upload_count = resource[package_offset + 2]
        upload_vram = []
        for index in range(upload_count):
            offset = package_offset + struct.unpack_from("<I", resource, package_offset + 4 + index * 4)[0]
            _length, ux, uy, _uw, _uh = struct.unpack_from("<I4H", resource, offset)
            upload_vram.append((ux, uy))

        # 各向きは同じ VRAM 領域(アトラス)を再アップロードして描画される。frame0 の先頭部品が
        # 参照する VRAM をアトラス原点とみなし、そこへのアップロードが向きの区切りになる。
        # 向き d は「その原点への d 番目のアップロード」から始まるので、向き d までを適用した
        # VRAM で frame d のチェーンを合成すればよい(u,v でアトラス内のサブ矩形を読む)。
        marker_offset = struct.unpack_from("<H", resource, sections[0] + 2)[0]
        marker_page = struct.unpack_from("<H", resource, marker_offset + 6)[0]
        marker_u = resource[marker_offset + 8]
        marker_ppw = 4 if (marker_page >> 7) & 3 == 0 else 2
        marker_vram = ((marker_page & 0xF) * 64 + marker_u // marker_ppw, 256 if marker_page & 0x10 else 0)
        marker_uploads = [index for index, vram in enumerate(upload_vram) if vram == marker_vram]
        upload_bounds = [marker_uploads[direction] for direction in range(direction_count)]
        upload_bounds.append(upload_count)

        image_offsets = []
        for direction in range(direction_count):
            descriptor_offset = struct.unpack_from("<H", resource, sections[0] + direction * 4 + 2)[0]
            image, anchor_x, anchor_y = compose_direction(
                resource, package_offset, palette, descriptor_offset, upload_vram, upload_bounds[direction + 1],
            )
            image.save(DESTINATION / f"{shop_id}-{direction}.png")
            image_offsets.append({"x": anchor_x, "y": anchor_y})
        economy_entry = economy[facility_id]
        shops.append({
            "id": shop_id,
            "name": economy_entry["name"],
            "width": SHOP_SIZE,
            "height": SHOP_SIZE,
            "constructionCost": economy_entry["constructionCost"],
            "maintenanceCost": economy_entry["maintenanceCost"],
            "directions": direction_count,
            "imageOffsets": image_offsets,
            "assetBase": f"/assets/park/shops/{shop_id}",
        })

    lines = ",\n".join("  " + json.dumps(shop, ensure_ascii=False) for shop in shops)
    CONFIG.write_text("[\n" + lines + "\n]\n", encoding="utf-8")


if __name__ == "__main__":
    main()
