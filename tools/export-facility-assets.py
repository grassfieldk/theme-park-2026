"""原作のマップ用施設画像を Web 用 PNG として出力する。"""

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


def compose_idle_frame(
    resource: bytes,
    package_offset: int,
    descriptor_offset: int,
    descriptor_end: int,
    palette: list[tuple[int, int, int, int]],
) -> Image.Image:
    """原作の初期状態が参照する 1 フレームだけを描画順どおりに出力する。"""
    uploads = []
    for index in range(resource[package_offset + 2]):
        offset = package_offset + struct.unpack_from("<I", resource, package_offset + 4 + index * 4)[0]
        _length, x, y, width, height = struct.unpack_from("<I4H", resource, offset)
        uploads.append((x, y, width, height))
    upload_images = dict(decode_upload_images(resource, package_offset, palette))

    parts = []
    for offset in range(descriptor_offset, descriptor_end, 20):
        flags, offset_x, offset_y, texture_page = struct.unpack_from("<HhhH", resource, offset)
        u, v, width, height = resource[offset + 8 : offset + 12]
        pixels_per_word = 4 if (texture_page >> 7) & 3 == 0 else 2
        texture_x = (texture_page & 0xF) * 64 * pixels_per_word + u
        texture_y = (256 if texture_page & 0x10 else 0) + v
        for index, (upload_x, upload_y, upload_width, upload_height) in enumerate(uploads):
            image = upload_images.get(index)
            if image is None:
                continue
            pixels_per_word = image.width // upload_width
            left = upload_x * pixels_per_word
            top = upload_y
            if left <= texture_x and top <= texture_y and texture_x + width <= left + image.width and texture_y + height <= top + image.height:
                crop = image.crop((texture_x - left, texture_y - top, texture_x - left + width, texture_y - top + height))
                parts.append((offset_x, offset_y, crop))
                break
        else:
            raise ValueError("静止フレームの部品を特定できません")
        if flags & 0x8000:
            break

    left = min(-offset_x for offset_x, _offset_y, _image in parts)
    top = min(-offset_y for _offset_x, offset_y, _image in parts)
    right = max(-offset_x + image.width for offset_x, _offset_y, image in parts)
    bottom = max(-offset_y + image.height for _offset_x, offset_y, image in parts)
    output = Image.new("RGBA", (right - left, bottom - top))
    for offset_x, offset_y, image in reversed(parts):
        output.alpha_composite(image, (-offset_x - left, -offset_y - top))
    return output


def main() -> None:
    pak = PAK.read_bytes()
    resources = {
        entry["id"]: entry
        for entry in json.loads(MANIFEST.read_text(encoding="utf-8"))["resources"]
    }
    palette = load_facility_palette(pak, resources)
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for facility_id, resource_id in FACILITIES.items():
        entry = resources[resource_id]
        resource = pak[entry["offset"] : entry["offset"] + entry["size"]]
        section_count = struct.unpack_from("<H", resource)[0]
        last_section = struct.unpack_from("<H", resource, section_count * 2)[0]
        package_offset = resource.find(b"\x0d\x60", last_section)
        for previous in DESTINATION.glob(f"{facility_id}-*.png"):
            previous.unlink()
        first_section = struct.unpack_from("<H", resource, 2)[0]
        descriptor_offset = struct.unpack_from("<H", resource, first_section + 2)[0]
        image = compose_idle_frame(resource, package_offset, descriptor_offset, first_section, palette)
        image.save(DESTINATION / f"{facility_id}-0.png")


if __name__ == "__main__":
    main()
