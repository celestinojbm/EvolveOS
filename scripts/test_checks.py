#!/usr/bin/env python3
"""Fixture tests for the spec-consistency checks.

For every check this asserts two things:
  * a deliberately-broken fixture makes the check FIRE (returns a violation);
  * the real repository PASSES the check.

Standard library only; no pytest. Run:  python scripts/test_checks.py
Exit 0 = all fixtures behave as expected.
"""
from __future__ import annotations

import os
import sys
import tempfile

import speclib as S
import check_spec_consistency as C
import check_markdown_links as L
import check_no_placeholders as P

_failures = []


def expect(cond, msg):
    if cond:
        print(f"ok    {msg}")
    else:
        print(f"FAIL  {msg}")
        _failures.append(msg)


def write(dir_, name, text):
    path = os.path.join(dir_, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return path


def test_expected_files():
    with tempfile.TemporaryDirectory() as d:
        # Only one of the expected files present, plus an orphan.
        write(d, "00-overview.md", "# ok\n")
        write(d, "zztop.md", "# orphan\n")
        v = C.check_expected_files(d, S.EXPECTED_SPEC_FILES)
        expect(any("missing expected" in x for x in v), "expected-files: fires on missing file")
        expect(any("unexpected" in x for x in v), "expected-files: fires on orphan file")
    # Real tree passes.
    expect(C.check_expected_files(S.SPEC_DIR, S.EXPECTED_SPEC_FILES) == [],
           "expected-files: real tree passes")


def test_gate_range():
    with tempfile.TemporaryDirectory() as d:
        good = write(d, "good.md", "Cleared at G-05 then G-16.\n")
        bad = write(d, "bad.md", "Escalate to G-42 for sign-off.\n")
        shorthand = write(d, "sh.md", "Runs G-01 through G-0n and G-xx forms.\n")
        expect(C.check_gate_range([bad]) != [], "gate-range: fires on G-42")
        expect(C.check_gate_range([good]) == [], "gate-range: clean on G-05/G-16")
        expect(C.check_gate_range([shorthand]) == [], "gate-range: ignores G-0n / G-xx shorthand")
    expect(C.check_gate_range(S.default_content_files()) == [],
           "gate-range: real tree passes")


def test_agent_ids():
    registry = {"PRIME", "SCOUT", "RED-CELL"}
    with tempfile.TemporaryDirectory() as d:
        bad = write(d, "bad.md", "The `FOO-DIR` agent files it.\n")
        good = write(d, "good.md", "`PRIME` delegates to `SCOUT` and `RED-CELL`.\n")
        macro = write(d, "macro.md", "Venture enters `SHUTDOWN` then `ARCHIVED`.\n")
        struct = write(d, "struct.md", "See `RISK-ORG-01`, `V-2027-004`, `G-07`, `CEO-1`.\n")
        acro = write(d, "acro.md", "Store as `JSON`, encrypt per `GDPR`, via `OIDC`, `OTLP`, `SVID`.\n")
        vocab = write(d, "vocab.md", "This `MUST` hold; the `DECISION` is `ADOPTED`.\n")
        fenced = write(d, "fenced.md", "```json\n{ \"agent\": \"`MADE-UP-DIR`\" }\n```\n")
        typo_mm = write(d, "typo.md", "The `COMMS-DIR` and `DEALDDESK` and `SUMMARIZER`.\n")
        riskcat = write(d, "riskcat.md", "Category `RISK-ECON` and `RISK-AI` and item `RISK-ORG-01`.\n")
        riskbad = write(d, "riskbad.md", "The `RISK-FOO` agent triages it.\n")
        placeholder = write(d, "ph.md", "IDs shaped `YYYY-MM` and `V-YYYY-SEQ`.\n")
        expect(C.check_agent_ids([bad], registry) != [], "agent-ids: fires on invented FOO-DIR")
        expect(C.check_agent_ids([good], registry) == [], "agent-ids: clean on registry IDs")
        expect(C.check_agent_ids([macro], registry) == [], "agent-ids: ignores pipeline macro-states")
        expect(C.check_agent_ids([struct], registry) == [], "agent-ids: ignores structured namespaces")
        expect(C.check_agent_ids([acro], registry) == [], "agent-ids: ignores technical acronyms")
        expect(C.check_agent_ids([vocab], registry) == [], "agent-ids: ignores spec vocabulary words")
        expect(C.check_agent_ids([fenced], registry) == [], "agent-ids: ignores tokens in fenced blocks")
        expect(C.check_agent_ids([typo_mm], registry) != [], "agent-ids: fires on MM/DD-containing invented IDs")
        expect(C.check_agent_ids([riskcat], registry) == [], "agent-ids: ignores risk category codes")
        expect(C.check_agent_ids([riskbad], registry) != [], "agent-ids: fires on invented RISK-prefixed ID")
        expect(C.check_agent_ids([placeholder], registry) == [], "agent-ids: ignores format placeholders")
    real_registry = S.load_agent_registry(os.path.join(S.SPEC_DIR, "appendix-b-agent-registry.md"))
    expect(C.check_agent_ids(S.markdown_files(S.SPEC_DIR), real_registry) == [],
           "agent-ids: real tree passes")


def test_taxonomies():
    with tempfile.TemporaryDirectory() as d:
        # Home file missing a label -> should fire.
        write(d, "00-overview.md", "Levels A0 A1 A2 A3.\n")  # missing A4
        tax = {"Autonomy": ("00-overview.md", ["A0", "A1", "A2", "A3", "A4"])}
        expect(C.check_taxonomies(d, tax) != [], "taxonomies: fires on missing label")
        write(d, "00-overview.md", "Levels A0 A1 A2 A3 A4.\n")
        expect(C.check_taxonomies(d, tax) == [], "taxonomies: clean when all present")
    expect(C.check_taxonomies(S.SPEC_DIR, S.TAXONOMIES) == [],
           "taxonomies: real tree passes")


def test_table_integrity():
    with tempfile.TemporaryDirectory() as d:
        broken = write(d, "t.md",
                        "| a | b |\n|---|---|\n| 1 | 2 |\n"
                        "> a note wedged in\n"
                        "| 3 | 4 |\n")
        multiline = write(d, "ml.md",
                          "| a | b |\n|---|---|\n"
                          "> note line one\n> note line two\n"
                          "| 3 | 4 |\n")
        okfile = write(d, "ok.md",
                       "| a | b |\n|---|---|\n| 1 | 2 |\n\n> a note after the table\n")
        blanksep = write(d, "bs.md",
                         "| a | b |\n|---|---|\n\n> standalone note\n\n| c | d |\n")
        fenced = write(d, "fen.md",
                       "```markdown\n| a | b |\n|---|---|\n> anti-pattern shown\n| 3 | 4 |\n```\n")
        expect(C.check_table_integrity([broken]) != [], "table-integrity: fires on split table")
        expect(C.check_table_integrity([multiline]) != [], "table-integrity: fires on multi-line blockquote split")
        expect(C.check_table_integrity([okfile]) == [], "table-integrity: clean when note is outside")
        expect(C.check_table_integrity([blanksep]) == [], "table-integrity: clean when blank-separated note between tables")
        expect(C.check_table_integrity([fenced]) == [], "table-integrity: ignores anti-pattern shown in fenced example")
    expect(C.check_table_integrity(S.default_content_files()) == [],
           "table-integrity: real tree passes")


def test_markdown_links():
    with tempfile.TemporaryDirectory() as d:
        write(d, "target.md", "# target\n")
        bad = write(d, "bad.md", "See [gone](does-not-exist.md).\n")
        good = write(d, "good.md", "See [ok](target.md) and [ext](https://x.example) and [a](#sec).\n")
        fenced = write(d, "fen.md", "```json\n{ \"note\": \"See [runbook](./nope-42.md)\" }\n```\n")
        expect(L.check_links([bad]) != [], "links: fires on broken relative link")
        expect(L.check_links([good]) == [], "links: clean on valid/external/anchor links")
        expect(L.check_links([fenced]) == [], "links: ignores link-shaped strings in fenced blocks")
    expect(L.check_links(S.default_content_files()) == [],
           "links: real tree passes")


def test_placeholders():
    with tempfile.TemporaryDirectory() as d:
        bad = write(d, "bad.md", "Section pending: TODO wire this up.\n")
        good = write(d, "good.md", "This section is complete and final.\n")
        literal = write(d, "lit.md", "The check flags `TODO`, `TBD` and `FIXME` tokens.\n")
        fenced = write(d, "fen.md", "```bash\n# TODO: parameterize the region\ndeploy\n```\n")
        optout = write(d, "opt.md", "<!-- spec-check: allow-placeholders -->\nTODO later\n")
        expect(P.check_placeholders([bad]) != [], "placeholders: fires on bare TODO")
        expect(P.check_placeholders([good]) == [], "placeholders: clean when none")
        expect(P.check_placeholders([literal]) == [], "placeholders: ignores backticked literals")
        expect(P.check_placeholders([fenced]) == [], "placeholders: ignores TODO inside fenced code block")
        expect(P.check_placeholders([optout]) == [], "placeholders: honors opt-out marker")
    expect(P.check_placeholders(S.default_content_files()) == [],
           "placeholders: real tree passes")


def test_fenced_blocks():
    with tempfile.TemporaryDirectory() as d:
        unterminated = write(d, "u.md", "Intro\n```python\nx = 1\n## still fenced\n")
        balanced = write(d, "b.md", "Intro\n```python\nx = 1\n```\nDone\n")
        expect(C.check_fenced_blocks([unterminated]) != [], "fenced-blocks: fires on unterminated fence")
        expect(C.check_fenced_blocks([balanced]) == [], "fenced-blocks: clean on balanced fence")
    expect(C.check_fenced_blocks(S.default_content_files()) == [],
           "fenced-blocks: real tree passes")
    # strip_fenced_blocks unit behavior: nested 4-backtick block does not leak,
    # and an unterminated fence blanks to EOF (surfaced by check_fenced_blocks).
    nested = ["````markdown", "```", "The `GHOST-DIR` agent", "```", "````", "after"]
    stripped = S.strip_fenced_blocks(nested)
    expect("GHOST-DIR" not in "".join(stripped), "strip: nested 4-backtick block is fully blanked")
    expect(stripped[-1] == "after", "strip: content after a closed nested block is preserved")


def main():
    for fn in (
        test_expected_files, test_gate_range, test_agent_ids, test_taxonomies,
        test_table_integrity, test_fenced_blocks, test_markdown_links,
        test_placeholders,
    ):
        fn()
    print()
    if _failures:
        print(f"test_checks: {len(_failures)} assertion(s) failed")
        return 1
    print("test_checks: all fixture assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
