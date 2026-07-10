#!/usr/bin/env python3
"""Check that internal relative markdown links resolve.

Scans spec/*.md, docs/*.md and README.md. For every `[text](target)` whose
target is a relative path (not http/https/mailto/anchor-only), resolves it
against the linking file's directory and verifies the file exists. Anchors
(`#section`) and query strings are stripped before resolving.

External links (http/https/mailto) and pure in-page anchors are intentionally
NOT verified -- doing so would require network access and heuristic anchor
slugging, which is out of scope for this check.

Run locally:  python scripts/check_markdown_links.py
"""
from __future__ import annotations

import os
import re
import sys

import speclib as S

# [text](target)  -- target captured up to the first closing paren or space.
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
SKIP_PREFIXES = ("http://", "https://", "mailto:", "#", "tel:", "//")


def check_links(files):
    violations = []
    for path in files:
        base = os.path.dirname(path)
        # Blank fenced code blocks: a link-shaped string inside a JSON/code
        # example is not a real document link.
        lines = S.strip_fenced_blocks(S.read_lines(path))
        for i, line in enumerate(lines, 1):
            for m in LINK_RE.finditer(line):
                target = m.group(1).strip()
                if target.startswith(SKIP_PREFIXES) or not target:
                    continue
                # Strip anchor and query, unescape a couple of common encodings.
                clean = target.split("#", 1)[0].split("?", 1)[0]
                if not clean:  # was a pure anchor like (#foo)
                    continue
                clean = clean.replace("%20", " ")
                resolved = os.path.normpath(os.path.join(base, clean))
                if not os.path.exists(resolved):
                    violations.append(
                        f"{S.rel(path)}:{i}: broken link -> {target} "
                        f"(resolved to {S.rel(resolved)})"
                    )
    return violations


def run():
    files = S.default_content_files()
    violations = check_links(files)
    if violations:
        print(f"FAIL  markdown links ({len(violations)}):")
        for v in violations:
            print(f"        {v}")
        print(f"\nmarkdown-links: {len(violations)} broken link(s)")
        return 1
    print("ok    markdown links")
    print("\nmarkdown-links: all internal links resolve")
    return 0


if __name__ == "__main__":
    sys.exit(run())
