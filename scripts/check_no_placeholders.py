#!/usr/bin/env python3
"""Fail if unfinished-work placeholders leak into the spec or docs.

Flags TODO, TBD, FIXME and "lorem ipsum" (case-insensitive, word-bounded).
Occurrences inside inline code spans (backticks) are ignored, so a document
may legitimately *name* these tokens as literals -- e.g. this checker's own
documentation -- while a bare placeholder left in prose is still caught.

Opt-out: a file may declare `<!-- spec-check: allow-placeholders -->` anywhere
in its text to be skipped entirely. Use this only for a document explicitly
accepted as a live backlog/scratch area, and say why next to the marker.

Run locally:  python scripts/check_no_placeholders.py
"""
from __future__ import annotations

import re
import sys

import speclib as S

PLACEHOLDER_RE = re.compile(r"\b(TODO|TBD|FIXME)\b|lorem ipsum", re.IGNORECASE)
CODE_SPAN_RE = re.compile(r"`[^`]*`")
ALLOW_MARKER = "spec-check: allow-placeholders"


def check_placeholders(files):
    violations = []
    for path in files:
        raw = S.read_lines(path)
        if any(ALLOW_MARKER in ln for ln in raw):
            continue  # explicitly opted out
        # Blank fenced code blocks so TODO/FIXME comments inside examples do not
        # count; line numbers are preserved for accurate reporting.
        lines = S.strip_fenced_blocks(raw)
        for i, line in enumerate(lines, 1):
            # Ignore tokens that are inline-code literals (documentation).
            prose = CODE_SPAN_RE.sub(" ", line)
            m = PLACEHOLDER_RE.search(prose)
            if m:
                violations.append(
                    f"{S.rel(path)}:{i}: placeholder '{m.group(0)}' "
                    f"(resolve it, or opt the file out with '{ALLOW_MARKER}')"
                )
    return violations


def run():
    files = S.default_content_files()
    violations = check_placeholders(files)
    if violations:
        print(f"FAIL  placeholders ({len(violations)}):")
        for v in violations:
            print(f"        {v}")
        print(f"\nno-placeholders: {len(violations)} placeholder(s) found")
        return 1
    print("ok    placeholders")
    print("\nno-placeholders: none found")
    return 0


if __name__ == "__main__":
    sys.exit(run())
