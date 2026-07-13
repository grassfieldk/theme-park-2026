"""Convert mapped raw CD-DA tracks to lossless FLAC files."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("mapping", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    args = parser.parse_args()

    tracks = json.loads(args.mapping.read_text(encoding="utf-8"))["tracks"]
    args.output.mkdir(parents=True, exist_ok=True)
    converted = []
    for track in tracks:
        source = Path(track["source"])
        name = Path(track["pseudoFile"]).stem + ".flac"
        destination = args.output / name
        skip_bytes = track["index01Frames"] * 2352
        subprocess.run(
            [
                args.ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "s16le",
                "-ar",
                "44100",
                "-ac",
                "2",
                "-skip_initial_bytes",
                str(skip_bytes),
                "-i",
                str(source),
                "-c:a",
                "flac",
                str(destination),
            ],
            check=True,
        )
        converted.append(
            {
                "pseudoFile": track["pseudoFile"],
                "sourceTrack": track["track"],
                "output": str(destination),
                "sha256": sha256(destination),
                "status": "confirmed",
            }
        )
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps({"tracks": converted}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
