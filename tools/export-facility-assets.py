"""原作のマップ用施設画像を Web 用 PNG として出力する。

アトラクションの絵はコマ送りのアニメになっている。リソースの構成は
グループ表(先頭のコマ表オフセット列)→ コマ表 → 部品ディスクリプタで、
コマ表は 1 コマ 4 バイト。先頭バイトが送り方(0=次へ、0x80=最後で先頭へ戻る、
0xff=最後で止まる)、次のバイトが表示フレーム数、後半 2 バイトが
部品ディスクリプタの位置を指す。

部品ディスクリプタは 20 バイトで、+18 がその部品の絵をどの転送ブロックから
取るかの番号(1 起点)になっている。同じ転送先へ絵を何枚も持つ種類があり、
コマごとに差し替えて動かすため、転送先の位置から探すと取り違える。
部品は奥から手前の順に並んでいる。

グループが 2 つある種類は 0 が停止中、1 が稼働中の絵になる。
1 つしかない種類は稼働中だけそのグループを送る。

全コマを共通の大きさの画布に描き、attractions.json の imageOffset を
その分だけずらして書き戻す。
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from unpack_sprites import decode_upload_images, psx_color  # noqa: E402


PAK = ROOT / "recovery" / "disc" / "TEX" / "UNPACK.PAK"
MANIFEST = ROOT / "recovery" / "manifests" / "unpack-pak.json"
DESTINATION = ROOT / "public" / "assets" / "park" / "attractions"
CONFIG = ROOT / "src" / "config" / "attractions.json"
FACILITIES = {
    "bungee-jump": 36,
    "g-shock": 37,
    "space-dive": 38,
    "dome-zero": 39,
    "pirate-ship": 40,
    "space-shuttle": 41,
    "magic-carpet": 42,
    "hammer-swing": 43,
    "coffee-cup": 44,
    "merry-go-round": 45,
    "joy-plane": 46,
    "parasol-chair": 47,
    "super-spinner": 48,
    "wild-roll": 49,
    "dish-spin": 50,
    "ferris-wheel": 51,
    "sky-tower": 52,
    "great-wheel": 53,
    "albatross": 54,
    "virtual-flight": 55,
    "jigoku-meguri": 56,
    "haunted-mansion": 57,
    "inferno": 58,
    "athletic": 59,
    "circus-show": 60,
    "virtual-wars": 61,
    "maze": 62,
    "ninja-house": 63,
    "marine-show": 64,
    "fantasy-castle": 65,
    "oedo-castle": 66,
    "pool-skate-rink": 67,
    "skate-rink-pool": 68,
    "boat-dock": 69,
    "mississippi-cruise": 71,
    "treasure-island": 74,
}


def load_facility_palette(pak: bytes, resources: dict[int, dict[str, int]]) -> list[tuple[int, int, int, int]]:
    entry = resources[0]
    resource = pak[entry["offset"] : entry["offset"] + entry["size"]]
    _length, x, y, width, height = struct.unpack_from("<I4H", resource, 4)
    if (x, y, width, height) != (0, 480, 256, 1):
        raise ValueError("施設用カラーパレットを確認できません")
    return [psx_color(value) for value in struct.unpack_from("<256H", resource, 16)]


def read_uploads(resource: bytes, package_offset: int, palette):
    uploads = []
    for index in range(resource[package_offset + 2]):
        offset = package_offset + struct.unpack_from("<I", resource, package_offset + 4 + index * 4)[0]
        _length, x, y, width, height = struct.unpack_from("<I4H", resource, offset)
        uploads.append((x, y, width, height))
    return uploads, dict(decode_upload_images(resource, package_offset, palette))


def compose_parts(resource: bytes, descriptor_offset: int, uploads, upload_images):
    """1 コマ分の部品を、基準点からの相対位置つきで取り出す。"""
    parts = []
    offset = descriptor_offset
    while True:
        flags, offset_x, offset_y, texture_page = struct.unpack_from("<HhhH", resource, offset)
        u, v, width, height = resource[offset + 8 : offset + 12]
        # 部品が使う転送ブロックの番号(1 起点)。同じ転送先へ絵を何枚も持つ種類があり、
        # コマごとに差し替えて動かすので、転送先の位置から探さずこの番号で選ぶ
        block = struct.unpack_from("<H", resource, offset + 18)[0] - 1
        image = upload_images.get(block)
        if image is None:
            raise ValueError("部品が使う転送ブロックがありません")
        upload_x, upload_y, upload_width, _upload_height = uploads[block]
        left = upload_x * (image.width // upload_width)
        pixels_per_word = 4 if (texture_page >> 7) & 3 == 0 else 2
        texture_x = (texture_page & 0xF) * 64 * pixels_per_word + u
        texture_y = (256 if texture_page & 0x10 else 0) + v
        crop = image.crop((
            texture_x - left,
            texture_y - upload_y,
            texture_x - left + width,
            texture_y - upload_y + height,
        ))
        parts.append((offset_x, offset_y, crop))
        if flags & 0x8000:
            break
        offset += 20
    return parts


def read_groups(resource: bytes, section_count: int, sections: list[int], table_end: int):
    """グループごとの (コマ表の位置, 送り方) を読む。最後のコマは先頭バイトで分かる。"""
    groups = []
    for index, start in enumerate(sections):
        limit = sections[index + 1] if index + 1 < section_count else table_end
        entries = []
        last_control = 0
        offset = start
        while offset + 4 <= limit:
            last_control, duration = resource[offset], resource[offset + 1]
            descriptor = struct.unpack_from("<H", resource, offset + 2)[0]
            entries.append((duration, descriptor))
            offset += 4
            if last_control != 0:
                break
        if not entries:
            raise ValueError("コマ表が空です")
        groups.append({"entries": entries, "loop": last_control == 0x80})
    return groups


def main() -> None:
    pak = PAK.read_bytes()
    resources = {
        entry["id"]: entry
        for entry in json.loads(MANIFEST.read_text(encoding="utf-8"))["resources"]
    }
    palette = load_facility_palette(pak, resources)
    DESTINATION.mkdir(parents=True, exist_ok=True)
    catalog = json.loads(CONFIG.read_text(encoding="utf-8"))
    by_id = {entry["id"]: entry for entry in catalog}

    for facility_id, resource_id in FACILITIES.items():
        entry = resources[resource_id]
        resource = pak[entry["offset"] : entry["offset"] + entry["size"]]
        section_count = struct.unpack_from("<H", resource)[0]
        sections = [struct.unpack_from("<H", resource, 2 + index * 2)[0] for index in range(section_count)]
        package_offset = resource.find(b"\x0d\x60", sections[-1])
        uploads, upload_images = read_uploads(resource, package_offset, palette)
        groups = read_groups(resource, section_count, sections, package_offset)

        # 全コマの部品を集め、共通の画布の大きさと基準点を決める
        composed = []
        for group in groups:
            for _duration, descriptor in group["entries"]:
                composed.append(compose_parts(resource, descriptor, uploads, upload_images))
        left = min(-offset_x for parts in composed for offset_x, _oy, _im in parts)
        top = min(-offset_y for parts in composed for _ox, offset_y, _im in parts)
        right = max(-offset_x + image.width for parts in composed for offset_x, _oy, image in parts)
        bottom = max(-offset_y + image.height for parts in composed for _ox, offset_y, image in parts)

        for previous in DESTINATION.glob(f"{facility_id}-*.png"):
            previous.unlink()
        for index, parts in enumerate(composed):
            # 部品は奥から手前の順に並んでいる(来園者のスプライトと同じ)
            output = Image.new("RGBA", (right - left, bottom - top))
            for offset_x, offset_y, image in parts:
                output.alpha_composite(image, (-offset_x - left, -offset_y - top))
            output.save(DESTINATION / f"{facility_id}-{index}.png")

        # 基準点(部品の原点)が画布の中でどこに来るか。設置時はここをマスに合わせる
        catalog_entry = by_id[facility_id]
        catalog_entry["imageOffset"] = {"x": -left, "y": -top}
        cursor = 0
        catalog_groups = []
        for group in groups:
            catalog_groups.append({
                "from": cursor,
                "count": len(group["entries"]),
                "loop": group["loop"],
                "durations": [duration for duration, _descriptor in group["entries"]],
            })
            cursor += len(group["entries"])
        catalog_entry.pop("asset", None)
        catalog_entry["assetBase"] = f"/assets/park/attractions/{facility_id}"
        catalog_entry["animation"] = {"frames": cursor, "groups": catalog_groups}
        print(f'{facility_id}: {cursor} frames, groups={[g["count"] for g in catalog_groups]}')

    CONFIG.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
