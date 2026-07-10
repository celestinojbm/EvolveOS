#!/usr/bin/env python3
"""EvolveOS spec-consistency checks.

Validates that the specification cannot silently degrade:

  1. all expected spec files exist (and no unexpected spec/*.md orphans);
  2. every gate citation (G-NN) is within the canonical range G-00..G-18;
  3. every backticked agent reference resolves to the Appendix B registry;
  4. every canonical taxonomy (R1-R4, A0-A4, G-00..G-18, PC-0..PC-3, C0-C4,
     P0-P4) has all its labels present in its owning document;
  5. no blockquote splits a markdown table (a real rendering bug).

Run locally:  python scripts/check_spec_consistency.py
Exit code 0 = all checks pass, 1 = at least one violation.

Each check is a pure function taking explicit inputs so it can be exercised by
fixtures in scripts/test_checks.py.
"""
from __future__ import annotations

import os
import sys

import speclib as S


# --- Check 1: expected files exist, no orphans -----------------------------

def check_expected_files(spec_dir, expected):
    violations = []
    present = {n for n in os.listdir(spec_dir) if n.endswith(".md")} if os.path.isdir(spec_dir) else set()
    for name in expected:
        if name not in present:
            violations.append(f"missing expected spec file: spec/{name}")
    for name in sorted(present - set(expected)):
        violations.append(f"unexpected spec/*.md file (rename? add to EXPECTED_SPEC_FILES): spec/{name}")
    return violations


# --- Check 2: gate citations in range --------------------------------------

def check_gate_range(files):
    violations = []
    for path in files:
        for i, line in enumerate(S.read_lines(path), 1):
            for m in S.GATE_CITATION_RE.finditer(line):
                n = int(m.group(1))
                if not (S.GATE_MIN <= n <= S.GATE_MAX):
                    violations.append(
                        f"{S.rel(path)}:{i}: gate {m.group(0)} out of range "
                        f"G-{S.GATE_MIN:02d}..G-{S.GATE_MAX:02d}"
                    )
    return violations


# --- Check 3: agent references resolve to the registry ---------------------

def check_agent_ids(files, registry_ids):
    violations = []
    for path in files:
        # Blank fenced blocks: a backticked token shown inside a fenced example
        # is illustrative, not a real citation.
        lines = S.strip_fenced_blocks(S.read_lines(path))
        for i, line in enumerate(lines, 1):
            for m in S.BACKTICK_TOKEN_RE.finditer(line):
                tok = m.group(1)
                if not S.AGENT_CANDIDATE_RE.match(tok):
                    continue
                if tok in registry_ids:
                    continue
                if S.is_non_agent_token(tok):
                    continue
                violations.append(
                    f"{S.rel(path)}:{i}: `{tok}` looks like an agent ID but is "
                    f"not in Appendix B (typo, or add it to the registry / an "
                    f"exclusion namespace in speclib.py)"
                )
    return violations


# --- Check 4: taxonomies fully present in their home file ------------------

def check_taxonomies(spec_dir, taxonomies):
    violations = []
    for name, (home, labels) in taxonomies.items():
        path = os.path.join(spec_dir, home)
        if not os.path.isfile(path):
            violations.append(f"taxonomy '{name}': home file spec/{home} missing")
            continue
        text = "\n".join(S.read_lines(path))
        for label in labels:
            # Word-ish boundary so 'C1' does not match inside 'C10'/'ABC1'.
            import re
            if not re.search(rf"(?<![\w-]){re.escape(label)}(?![\w-])", text):
                violations.append(
                    f"taxonomy '{name}': label '{label}' not found in spec/{home}"
                )
    return violations


# --- Check 5: no blockquote splitting a markdown table ---------------------

def check_table_integrity(files):
    """Flag a blockquote wedged directly between two table rows.

    This is the bug class where an added `> note` breaks a markdown table's
    rendering. It fires on a maximal run of consecutive blockquote lines (so a
    multi-line note is caught, not just a single line) whose immediately
    adjacent lines above and below are both table rows. Immediate adjacency is
    intentional: a blank line legitimately ends a table, so a note separated by
    a blank line is not a split and is not flagged.
    """
    violations = []
    for path in files:
        lines = S.strip_fenced_blocks(S.read_lines(path))
        n = len(lines)
        i = 0
        while i < n:
            if not lines[i].lstrip().startswith(">"):
                i += 1
                continue
            start = i
            while i < n and lines[i].lstrip().startswith(">"):
                i += 1
            before = lines[start - 1] if start - 1 >= 0 else None
            after = lines[i] if i < n else None
            if before and after and _is_table_row(before) and _is_table_row(after):
                violations.append(
                    f"{S.rel(path)}:{start + 1}: blockquote splits a markdown table "
                    f"(put a blank line above the note, or move it out of the table)"
                )
    return violations


def _is_table_row(line):
    s = line.strip()
    return s.startswith("|") and s.count("|") >= 2


# --- Runner ----------------------------------------------------------------

def run():
    registry_path = os.path.join(S.SPEC_DIR, "appendix-b-agent-registry.md")
    registry_ids = S.load_agent_registry(registry_path) if os.path.isfile(registry_path) else set()
    spec_files = S.markdown_files(S.SPEC_DIR)
    content_files = S.default_content_files()

    results = {
        "expected files": check_expected_files(S.SPEC_DIR, S.EXPECTED_SPEC_FILES),
        "gate range": check_gate_range(content_files),
        "agent references": check_agent_ids(spec_files, registry_ids),
        "taxonomies": check_taxonomies(S.SPEC_DIR, S.TAXONOMIES),
        "table integrity": check_table_integrity(content_files),
    }

    total = 0
    for name, violations in results.items():
        if violations:
            total += len(violations)
            print(f"FAIL  {name} ({len(violations)}):")
            for v in violations:
                print(f"        {v}")
        else:
            print(f"ok    {name}")

    if total:
        print(f"\nspec-consistency: {total} violation(s)")
        return 1
    print("\nspec-consistency: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(run())
