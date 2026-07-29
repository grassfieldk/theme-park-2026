"""UNPACK.PAK の指定リソースに含まれる描画部品を一覧画像へ出力する。"""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path

from PIL import Image, ImageDraw


def psx_color(value: int) -> tuple[int, int, int, int]:
    if value == 0:
        return 0, 0, 0, 0
    return (
        (value & 0x1F) * 255 // 31,
        ((value >> 5) & 0x1F) * 255 // 31,
        ((value >> 10) & 0x1F) * 255 // 31,
        255,
    )


def load_vram(resource: bytes, offset: int) -> list[int]:
    vram = [0] * (1024 * 512)
    while offset + 12 <= len(resource):
        size = struct.unpack_from("<I", resource, offset)[0]
        if size == 0xFFFFFFFF:
            break
        length = size & 0xFFFFFF
        if length < 12 or offset + length > len(resource):
            break
        x, y, width, height = struct.unpack_from("<4H", resource, offset + 4)
        if x + width > 1024 or y + height > 512 or 12 + width * height * 2 > length:
            break
        pixels = struct.unpack_from(f"<{width * height}H", resource, offset + 12)
        for row in range(height):
            start = (y + row) * 1024 + x
            vram[start : start + width] = pixels[row * width : (row + 1) * width]
        offset += length
    return vram


def decode_descriptor(resource: bytes, offset: int, vram: list[int]) -> Image.Image | None:
    descriptor = resource[offset : offset + 20]
    if len(descriptor) < 20:
        return None
    texture_page = struct.unpack_from("<H", descriptor, 6)[0]
    u, v, width, height = descriptor[8:12]
    clut = struct.unpack_from("<H", descriptor, 12)[0]
    depth = (texture_page >> 7) & 3
    if width == 0 or height == 0 or depth > 1:
        return None
    pixels_per_word = 4 if depth == 0 else 2
    palette_size = 16 if depth == 0 else 256
    texture_x = (texture_page & 0xF) * 64 + u // pixels_per_word
    texture_y = (256 if texture_page & 0x10 else 0) + v
    clut_x = (clut & 0x3F) * 16
    clut_y = clut >> 6
    if texture_y + height > 512 or clut_y >= 512 or clut_x + palette_size > 1024:
        return None
    palette = [psx_color(vram[clut_y * 1024 + clut_x + index]) for index in range(palette_size)]
    image = Image.new("RGBA", (width, height))
    output = image.load()
    for y in range(height):
        for x in range(width):
            word = vram[(texture_y + y) * 1024 + texture_x + x // pixels_per_word]
            shift = (x % pixels_per_word) * (4 if depth == 0 else 8)
            output[x, y] = palette[(word >> shift) & (0xF if depth == 0 else 0xFF)]
    return image


def decode_rle(data: bytes, expected_size: int) -> bytes:
    marker = data[0]
    output = bytearray()
    offset = 1
    while offset < len(data) and len(output) < expected_size:
        value = data[offset]
        if value == marker and offset + 2 < len(data):
            count = data[offset + 1]
            if count:
                output.extend(bytes([data[offset + 2]]) * count)
            offset += 3
        else:
            output.append(value)
            offset += 1
    return bytes(output[:expected_size])


def decode_upload_images(
    resource: bytes,
    base: int = 0,
    external_palette: list[tuple[int, int, int, int]] | None = None,
) -> list[tuple[int, Image.Image]]:
    if base + 4 > len(resource):
        return []
    count = resource[base + 2]
    if count == 0 or base + 4 + count * 4 > len(resource):
        return []
    uploads = []
    for index in range(count):
        offset = base + struct.unpack_from("<I", resource, base + 4 + index * 4)[0]
        if offset + 12 > len(resource):
            return []
        length = int.from_bytes(resource[offset : offset + 3], "little")
        x, y, width, height = struct.unpack_from("<4H", resource, offset + 4)
        if length < 12 or offset + length > len(resource) or width == 0 or height == 0:
            return []
        pixels = decode_rle(resource[offset + 12 : offset + length], width * height * 2)
        if len(pixels) != width * height * 2:
            return []
        uploads.append((index, x, y, width, height, pixels))

    palettes: list[tuple[int, list[tuple[int, int, int, int]]]] = []
    images = []
    for index, _x, _y, width, height, pixels in uploads:
        if height == 1 and width in (16, 256):
            values = struct.unpack(f"<{width}H", pixels)
            palettes.append((index, [psx_color(value) for value in values]))
            continue
        preceding = [palette for palette_index, palette in palettes if palette_index < index]
        palette = preceding[-1] if preceding else external_palette
        if palette is None:
            image = Image.new("RGBA", (width, height))
            image.putdata([psx_color(value) for value in struct.unpack(f"<{width * height}H", pixels)])
            images.append((index, image))
            continue
        image = Image.new("RGBA", (width * (4 if len(palette) == 16 else 2), height))
        output = image.load()
        for y in range(height):
            row = pixels[y * width * 2 : (y + 1) * width * 2]
            for byte_index, value in enumerate(row):
                if len(palette) == 16:
                    output[byte_index * 2, y] = palette[value & 0xF]
                    output[byte_index * 2 + 1, y] = palette[value >> 4]
                else:
                    output[byte_index, y] = palette[value]
        images.append((index, image))
    return images


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("resource_ids", nargs="+", type=int)
    parser.add_argument("--pak", type=Path, default=Path("recovery/disc/TEX/UNPACK.PAK"))
    parser.add_argument("--manifest", type=Path, default=Path("recovery/manifests/unpack-pak.json"))
    parser.add_argument("--output", type=Path, default=Path("work/unpack-previews"))
    args = parser.parse_args()

    pak = args.pak.read_bytes()
    resources = {entry["id"]: entry for entry in json.loads(args.manifest.read_text(encoding="utf-8"))["resources"]}
    args.output.mkdir(parents=True, exist_ok=True)

    for resource_id in args.resource_ids:
        entry = resources[resource_id]
        resource = pak[entry["offset"] : entry["offset"] + entry["size"]]
        section_count = struct.unpack_from("<H", resource)[0]
        images = []
        package_offset = 0
        if 0 < section_count and 2 + section_count * 2 <= len(resource):
            descriptor_start = 2 + section_count * 2
            first_section = struct.unpack_from("<H", resource, 2)[0]
            last_section = struct.unpack_from("<H", resource, section_count * 2)[0]
            package_offset = resource.find(b"\x0d\x60", last_section)
            if package_offset < 0:
                package_offset = 0
            upload_offset = package_offset + 4
            if descriptor_start < first_section and upload_offset < len(resource):
                vram = load_vram(resource, upload_offset)
                for offset in range(descriptor_start, first_section - 19, 20):
                    image = decode_descriptor(resource, offset, vram)
                    if image and image.getbbox():
                        images.append((offset, image))
        if not images:
            images = decode_upload_images(resource, package_offset)
        if not images:
            continue
        cell_width = max(80, min(192, max(image.width for _, image in images) + 8))
        cell_height = max(64, min(160, max(image.height for _, image in images) + 22))
        columns = 6
        rows = (len(images) + columns - 1) // columns
        sheet = Image.new("RGBA", (columns * cell_width, rows * cell_height), (32, 38, 42, 255))
        draw = ImageDraw.Draw(sheet)
        for index, (offset, image) in enumerate(images):
            x = index % columns * cell_width
            y = index // columns * cell_height
            thumbnail = image.copy()
            thumbnail.thumbnail((cell_width - 8, cell_height - 22), Image.Resampling.NEAREST)
            sheet.alpha_composite(thumbnail, (x + 4, y + 16))
            draw.text((x + 3, y + 2), f"{index}: 0x{offset:x}", fill="white")
        sheet.save(args.output / f"resource-{resource_id:03d}.png")


if __name__ == "__main__":
    main()
