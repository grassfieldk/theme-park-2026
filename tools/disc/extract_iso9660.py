"""Extract the ISO 9660 filesystem from a raw PlayStation MODE2/2352 track."""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from dataclasses import asdict, dataclass
from pathlib import Path

SECTOR_SIZE = 2352
USER_DATA_OFFSET = 24
USER_DATA_SIZE = 2048


@dataclass
class Entry:
    path: str
    extent: int
    size: int
    directory: bool
    status: str = "listed"
    sha256: str | None = None


class Disc:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.file = path.open("rb")
        self.sector_count = path.stat().st_size // SECTOR_SIZE

    def close(self) -> None:
        self.file.close()

    def sector(self, lba: int) -> bytes:
        if not 0 <= lba < self.sector_count:
            raise ValueError(f"LBA outside data track: {lba}")
        self.file.seek(lba * SECTOR_SIZE + USER_DATA_OFFSET)
        data = self.file.read(USER_DATA_SIZE)
        if len(data) != USER_DATA_SIZE:
            raise EOFError(f"short sector at LBA {lba}")
        return data

    def payload(self, extent: int, size: int) -> bytes:
        result = bytearray()
        remaining = size
        lba = extent
        while remaining:
            sector = self.sector(lba)
            count = min(remaining, USER_DATA_SIZE)
            result.extend(sector[:count])
            remaining -= count
            lba += 1
        return bytes(result)


def root_directory(disc: Disc) -> tuple[int, int]:
    descriptor = disc.sector(16)
    if descriptor[1:6] != b"CD001":
        raise ValueError("ISO 9660 primary volume descriptor was not found")
    return struct.unpack_from("<II", descriptor, 158)[0], struct.unpack_from("<II", descriptor, 166)[0]


def list_directory(disc: Disc, extent: int, size: int, parent: str = "") -> list[Entry]:
    entries: list[Entry] = []
    data = disc.payload(extent, size)
    position = 0
    while position < len(data):
        record_length = data[position]
        if record_length == 0:
            position = ((position // USER_DATA_SIZE) + 1) * USER_DATA_SIZE
            continue
        record = data[position : position + record_length]
        entry_extent, entry_size = struct.unpack_from("<II", record, 2)[0], struct.unpack_from("<II", record, 10)[0]
        flags = record[25]
        name_length = record[32]
        raw_name = record[33 : 33 + name_length]
        position += record_length
        if name_length == 1 and raw_name[0] <= 1:
            continue
        name = raw_name.decode("ascii").removesuffix(";1")
        path = f"{parent}/{name}" if parent else name
        entry = Entry(path, entry_extent, entry_size, bool(flags & 2))
        entries.append(entry)
        if entry.directory:
            entries.extend(list_directory(disc, entry_extent, entry_size, path))
    return entries


def extract(disc: Disc, entries: list[Entry], output: Path) -> None:
    for entry in entries:
        destination = output / Path(entry.path)
        if entry.directory:
            destination.mkdir(parents=True, exist_ok=True)
            entry.status = "directory"
            continue
        last_lba = entry.extent + (entry.size + USER_DATA_SIZE - 1) // USER_DATA_SIZE
        if last_lba > disc.sector_count:
            entry.status = "outside-data-track"
            continue
        payload = disc.payload(entry.extent, entry.size)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(payload)
        entry.status = "extracted"
        entry.sha256 = hashlib.sha256(payload).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("disc", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("manifest", type=Path)
    args = parser.parse_args()

    disc = Disc(args.disc)
    try:
        root_extent, root_size = root_directory(disc)
        entries = list_directory(disc, root_extent, root_size)
        extract(disc, entries, args.output)
    finally:
        disc.close()

    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(
        json.dumps(
            {
                "source": str(args.disc),
                "sectorSize": SECTOR_SIZE,
                "userDataOffset": USER_DATA_OFFSET,
                "userDataSize": USER_DATA_SIZE,
                "entries": [asdict(entry) for entry in entries],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
