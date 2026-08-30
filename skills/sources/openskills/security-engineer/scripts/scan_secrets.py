#!/usr/bin/env python3
"""Read-only heuristic scan for likely secrets; confirm all findings manually."""

import re
import sys
from pathlib import Path

PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "generic secret assignment": re.compile(r"(?i)\b(api[_-]?key|secret|password|token)\b\s*[:=]\s*['\"][^'\"]{8,}['\"]"),
}
SKIP_PARTS = {".git", "node_modules", "dist", "build", ".venv", "venv"}


def files(target: Path):
    if target.is_file():
        yield target
        return
    for path in target.rglob("*"):
        if path.is_file() and not any(part in SKIP_PARTS for part in path.parts):
            yield path


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: scan_secrets.py <file-or-directory>", file=sys.stderr)
        return 2
    target = Path(sys.argv[1])
    if not target.exists():
        print(f"Not found: {target}", file=sys.stderr)
        return 2
    findings = 0
    for path in files(target):
        try:
            for number, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                for label, pattern in PATTERNS.items():
                    if pattern.search(line):
                        print(f"{path}:{number}: possible {label}")
                        findings += 1
        except OSError:
            continue
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
