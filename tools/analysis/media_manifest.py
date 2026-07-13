"""Create hashes and ffprobe metadata for recovered media files."""

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
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    files = []
    extensions = {".avi", ".flac", ".wav", ".mp4", ".mkv"}
    for path in sorted(item for item in args.source.rglob("*") if item.is_file() and item.suffix.lower() in extensions):
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
            check=True,
            capture_output=True,
            text=True,
        )
        files.append(
            {
                "path": path.relative_to(args.source).as_posix(),
                "size": path.stat().st_size,
                "sha256": sha256(path),
                "probe": json.loads(result.stdout),
                "status": "confirmed",
            }
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"files": files}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
