"""スタッフメニュー用の 16×16 アイコンを、来園者バンクから 1 コマ切り出して生成する。

来園者バンクのスプライトシートはコマの並びが `facing * 4 + walkFrame` で、
`facing 0`(南向き = 画面手前)の 1 コマ目を切り取って中心に置く。
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
STAFF_CONFIG = ROOT / "src/config/staff.json"
GUEST_SPRITES = ROOT / "src/config/guestSprites.json"
GUESTS_DIR = ROOT / "public/assets/park/guests"
DESTINATION = ROOT / "public/assets/park/staff-icons"
ICON_SIZE = 16


def crop_front_frame(sheet: Image.Image, frame_width: int, frame_height: int) -> Image.Image:
    frame = sheet.crop((0, 0, frame_width, frame_height))
    bbox = frame.getbbox()
    if bbox:
        frame = frame.crop(bbox)
    scale = min(ICON_SIZE / frame.width, ICON_SIZE / frame.height, 1)
    scaled = frame.resize(
        (max(1, round(frame.width * scale)), max(1, round(frame.height * scale))),
        Image.Resampling.NEAREST,
    )
    icon = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    icon.paste(scaled, ((ICON_SIZE - scaled.width) // 2, (ICON_SIZE - scaled.height) // 2))
    return icon


def main() -> None:
    staff = json.loads(STAFF_CONFIG.read_text(encoding="utf-8"))
    sprites = json.loads(GUEST_SPRITES.read_text(encoding="utf-8"))
    banks_by_index = {bank["bank"]: bank for bank in sprites["sets"]["a"]}
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for entry in staff:
        bank_index = entry["bank"]
        bank = banks_by_index[bank_index]
        sheet = Image.open(GUESTS_DIR / f"a-{bank_index}.png").convert("RGBA")
        icon = crop_front_frame(sheet, bank["frameWidth"], bank["frameHeight"])
        icon.save(DESTINATION / f"{entry['id']}.png")


if __name__ == "__main__":
    main()
