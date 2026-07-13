"""Map CUE audio tracks to ISO 9660 CDA pseudo-files."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

RAW_SECTOR_SIZE = 2352
VIRTUAL_SECTOR_SIZE = 2048


def frames(value: str) -> int:
    minute, second, frame = (int(part) for part in value.split(":"))
    return (minute * 60 + second) * 75 + frame


def parse_cue(path: Path) -> list[dict[str, object]]:
    tracks: list[dict[str, object]] = []
    current_file: str | None = None
    current: dict[str, object] | None = None
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        file_match = re.match(r'\s*FILE\s+"(.+)"\s+BINARY', line, re.IGNORECASE)
        track_match = re.match(r"\s*TRACK\s+(\d+)\s+(\S+)", line, re.IGNORECASE)
        index_match = re.match(r"\s*INDEX\s+(\d+)\s+(\d\d:\d\d:\d\d)", line, re.IGNORECASE)
        if file_match:
            current_file = file_match.group(1)
        elif track_match:
            if current_file is None:
                raise ValueError("TRACK appeared before FILE")
            current = {
                "track": int(track_match.group(1)),
                "mode": track_match.group(2).upper(),
                "file": current_file,
                "indexes": {},
            }
            tracks.append(current)
        elif index_match and current is not None:
            indexes = current["indexes"]
            assert isinstance(indexes, dict)
            indexes[int(index_match.group(1))] = frames(index_match.group(2))
    return tracks


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("cue", type=Path)
    parser.add_argument("disc_manifest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    manifest = json.loads(args.disc_manifest.read_text(encoding="utf-8"))
    pseudo_files = sorted(
        (
            entry
            for entry in manifest["entries"]
            if entry["path"].startswith("CDA/") and not entry["directory"]
        ),
        key=lambda entry: entry["extent"],
    )
    audio_tracks = [track for track in parse_cue(args.cue) if track["mode"] == "AUDIO"]
    if len(pseudo_files) != len(audio_tracks):
        raise ValueError(f"CDA entries ({len(pseudo_files)}) and audio tracks ({len(audio_tracks)}) differ")

    mappings = []
    for pseudo, track in zip(pseudo_files, audio_tracks, strict=True):
        source = args.cue.parent / str(track["file"])
        indexes = track["indexes"]
        assert isinstance(indexes, dict)
        index01 = indexes.get(1, 0)
        raw_sectors = source.stat().st_size // RAW_SECTOR_SIZE
        expected_virtual_size = (raw_sectors - index01) * VIRTUAL_SECTOR_SIZE
        exact = expected_virtual_size == pseudo["size"]
        mappings.append(
            {
                "pseudoFile": pseudo["path"],
                "track": track["track"],
                "source": str(source),
                "rawSize": source.stat().st_size,
                "sha256": sha256(source),
                "index01Frames": index01,
                "durationFrames": raw_sectors - index01,
                "virtualSize": pseudo["size"],
                "sizeMatches": exact,
                "status": "confirmed" if exact else "inferred",
            }
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"tracks": mappings}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
