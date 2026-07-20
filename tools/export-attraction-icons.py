"""アトラクション・ショップのマップ用スプライトから 16×16 のメニューアイコンを生成する。

`src/config/attractions.json` の asset と `src/config/shops.json` の assetBase が指す
エクスポート済み PNG を切り抜き、最近傍縮小でドット絵の質感を保ったまま 16×16 に収める。
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "src/config/attractions.json"
SHOP_CONFIG = ROOT / "src/config/shops.json"
PUBLIC = ROOT / "public"
DESTINATION = PUBLIC / "assets/park/attraction-icons"
SHOP_DESTINATION = PUBLIC / "assets/park/shop-icons"
ICON_SIZE = 16


def export_icon(asset: Path, destination: Path) -> None:
    image = Image.open(asset).convert("RGBA")
    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)
    scale = min(ICON_SIZE / image.width, ICON_SIZE / image.height, 1)
    scaled = image.resize(
        (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
        Image.Resampling.NEAREST,
    )
    icon = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    icon.paste(scaled, ((ICON_SIZE - scaled.width) // 2, (ICON_SIZE - scaled.height) // 2))
    icon.save(destination)


def main() -> None:
    attractions = json.loads(CONFIG.read_text(encoding="utf-8"))
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for attraction in attractions:
        asset = PUBLIC / attraction["asset"].lstrip("/")
        export_icon(asset, DESTINATION / f"{attraction['id']}.png")
    shops = json.loads(SHOP_CONFIG.read_text(encoding="utf-8"))
    SHOP_DESTINATION.mkdir(parents=True, exist_ok=True)
    for shop in shops:
        asset = PUBLIC / f"{shop['assetBase'].lstrip('/')}-0.png"
        export_icon(asset, SHOP_DESTINATION / f"{shop['id']}.png")


if __name__ == "__main__":
    main()
