"""Audit required recovery outputs and write a compact status manifest."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def count(pattern: str) -> int:
    return sum(1 for path in ROOT.glob(pattern) if path.is_file())


def main() -> None:
    required = [
        "recovery/manifests/disc-files.json",
        "recovery/manifests/audio-tracks.json",
        "recovery/manifests/images.json",
        "recovery/manifests/tmd-models.json",
        "recovery/manifests/movies.json",
        "recovery/manifests/code-summary.json",
        "recovery/code/main/decompiled.c",
        "recovery/code/main-psyq/decompiled.c",
    ]
    missing = [path for path in required if not (ROOT / path).is_file()]
    summary = {
        "status": "complete" if not missing else "incomplete",
        "missing": missing,
        "counts": {
            "discFiles": count("recovery/disc/**/*"),
            "images": count("recovery/assets/images/**/*.png"),
            "tmdJson": count("recovery/assets/models/**/*.json"),
            "objModels": count("recovery/assets/models-obj/**/*.obj"),
            "cdAudio": count("recovery/assets/audio/*.flac"),
            "soundEffects": count("recovery/assets/sound-effects/**/*.wav"),
            "movies": count("recovery/assets/movies/*.avi"),
            "overlaySources": count("recovery/code/overlays/*/decompiled.c"),
            "psyqFunctions": max(0, sum(1 for _ in (ROOT / "recovery/code/main-psyq/functions.tsv").open(encoding="utf-8")) - 1),
        },
    }
    output = ROOT / "recovery/manifests/recovery-audit.json"
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if missing:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
