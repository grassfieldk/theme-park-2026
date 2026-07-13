"""Extract numbered 16x16 glyphs from the recovered FONT16 pages."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("contact", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    glyphs = []
    for page_path in sorted(args.source.glob("*.png")):
        page = Image.open(page_path).convert("RGBA")
        for y in range(0, page.height, 16):
            for x in range(0, page.width, 16):
                glyph = page.crop((x, y, x + 16, y + 16))
                index = len(glyphs)
                glyph.save(args.output / f"{index:03}.png")
                glyphs.append(glyph)

    columns = 16
    cell_width, cell_height = 48, 40
    rows = (len(glyphs) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell_width, rows * cell_height), "#202020")
    draw = ImageDraw.Draw(sheet)
    for index, glyph in enumerate(glyphs):
        x = index % columns * cell_width
        y = index // columns * cell_height
        enlarged = glyph.resize((32, 32), Image.Resampling.NEAREST)
        sheet.paste(enlarged, (x, y), enlarged)
        draw.text((x + 32, y + 10), f"{index:03}", fill="white")
    args.contact.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.contact)


if __name__ == "__main__":
    main()
