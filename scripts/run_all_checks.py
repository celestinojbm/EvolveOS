#!/usr/bin/env python3
"""Run every spec-consistency check and report a combined result.

This is the single convenient command:  python scripts/run_all_checks.py
CI runs the individual scripts as separate steps so failures are attributable,
but this mirrors them for local use.
"""
from __future__ import annotations

import sys

import check_markdown_links
import check_no_placeholders
import check_spec_consistency


def main():
    rc = 0
    for name, mod in (
        ("spec consistency", check_spec_consistency),
        ("markdown links", check_markdown_links),
        ("no placeholders", check_no_placeholders),
    ):
        print(f"=== {name} ===")
        rc |= mod.run()
        print()
    if rc:
        print("RESULT: FAIL")
    else:
        print("RESULT: PASS")
    return rc


if __name__ == "__main__":
    sys.exit(main())
