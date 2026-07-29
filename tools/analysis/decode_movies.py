"""Decode STR movie streams to AVI using the vendored jpsxdec."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
VENDOR = ROOT / "tools" / "vendor" / "jpsxdec"


def find_jar() -> Path:
    jar = next(VENDOR.rglob("jpsxdec.jar"), None)
    if jar is None:
        raise SystemExit(f"jpsxdec.jar not found under {VENDOR}")
    return jar


def java_bin() -> str:
    home = subprocess.run(
        ["mise", "where", "java"], check=True, capture_output=True, text=True
    ).stdout.strip()
    return str(Path(home) / "bin" / "java")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("disc", type=Path, help="raw disc image (.bin)")
    parser.add_argument("output", type=Path, help="AVI output directory")
    parser.add_argument("index", type=Path, help="jpsxdec index file to write")
    args = parser.parse_args()

    java = java_bin()
    jar = find_jar()
    args.output.mkdir(parents=True, exist_ok=True)

    subprocess.run(
        [java, "-jar", str(jar), "-f", str(args.disc), "-x", str(args.index)],
        check=True,
    )
    subprocess.run(
        [java, "-jar", str(jar), "-x", str(args.index),
         "-a", "video", "-vf", "avi:mjpg", "-dir", str(args.output)],
        check=True,
    )

    count = len(list(args.output.glob("*.avi")))
    print(f"decoded {count} avi -> {args.output}")


if __name__ == "__main__":
    main()
