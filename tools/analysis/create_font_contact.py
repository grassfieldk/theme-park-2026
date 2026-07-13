"""Create an enlarged, indexed contact sheet for a range of FONT16 glyphs."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("glyphs", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--end", type=int, default=511)
    args = parser.parse_args()

    columns = 8
    cell = 80
    indices = range(args.start, args.end + 1)
    rows = (len(indices) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * cell, rows * cell), "#202020")
    draw = ImageDraw.Draw(sheet)

    for position, index in enumerate(indices):
        glyph = Image.open(args.glyphs / f"{index:03}.png").convert("RGBA")
        x = position % columns * cell
        y = position // columns * cell
        sheet.paste(glyph.resize((64, 64), Image.Resampling.NEAREST), (x, y), glyph.resize((64, 64), Image.Resampling.NEAREST))
        draw.text((x, y + 64), str(index), fill="white")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.output)


if __name__ == "__main__":
    main()
