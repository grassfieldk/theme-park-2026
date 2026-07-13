"""Summarize recovered functions and cross-overlay references."""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path


def rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8") as source:
        return list(csv.DictReader(source, delimiter="\t"))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("main", type=Path)
    parser.add_argument("overlays", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    external = Counter()
    callers: dict[str, set[str]] = defaultdict(set)
    programs = []
    for directory in sorted(item for item in args.overlays.iterdir() if item.is_dir()):
        functions = rows(directory / "functions.tsv")
        references = rows(directory / "references.tsv")
        for reference in references:
            if reference["type"] != "UNCONDITIONAL_CALL":
                continue
            target = int(reference["to"], 16)
            if target < 0x801B0000:
                external[reference["to"]] += 1
                callers[reference["to"]].add(directory.name)
        programs.append({"name": directory.name, "functions": len(functions), "references": len(references)})

    main_functions = {row["address"]: row["name"] for row in rows(args.main / "functions.tsv")}
    main_strings = {row["address"]: row["value"] for row in rows(args.main / "strings.tsv")}
    string_references = []
    for reference in rows(args.main / "references.tsv"):
        if reference["to"] in main_strings:
            string_references.append({**reference, "value": main_strings[reference["to"]]})

    result = {
        "programs": programs,
        "externalCalls": [
            {"target": target, "name": main_functions.get(target), "calls": count, "overlays": sorted(callers[target])}
            for target, count in external.most_common()
        ],
        "mainStringReferences": string_references,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
