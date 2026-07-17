# Spec Consistency Checks

**Status:** v1.0 · Implements Phase 0 issue **[#2](https://github.com/celestinojbm/EvolveOS/issues/2)** (P0-1). Automated guardrails so the EvolveOS specification cannot degrade without CI catching it.

Everything here is **standard-library Python 3** — no third-party dependencies, no database, no framework.

## What CI validates

CI runs on every `push` and `pull_request` (workflow: `.github/workflows/spec-consistency.yml`) and executes four steps:

| Check | Script | What it enforces |
|---|---|---|
| Spec consistency | `scripts/check_spec_consistency.py` | (1) all 19 expected spec files exist and there are no orphan `spec/*.md`; (2) no unterminated code fence; (3) every gate citation `G-NN` is within `G-00…G-18`; (4) every backticked agent reference resolves to the Appendix B registry; (5) every canonical taxonomy is fully present in its owning document; (6) no blockquote — single- or multi-line — splits a markdown table |
| Markdown links | `scripts/check_markdown_links.py` | every internal relative link in `spec/`, `docs/`, and `README.md` resolves to a real file |
| No placeholders | `scripts/check_no_placeholders.py` | no `TODO` / `TBD` / `FIXME` / `lorem ipsum` leaks into a finished document |
| Fixture tests | `scripts/test_checks.py` | each check above actually **fires** on a deliberately-broken fixture (and passes on the real tree) |

The canonical taxonomies checked and their owning files:

| Taxonomy | Labels | Owning file |
|---|---|---|
| Reversibility | `R1`–`R4` | `spec/00-overview.md` |
| Autonomy | `A0`–`A4` | `spec/00-overview.md` |
| Gates | `G-00`–`G-18` | `spec/appendix-c-decision-gates.md` |
| Privacy classes | `PC-0`–`PC-3` | `spec/06-knowledge-system.md` |
| Data classes | `C0`–`C4` | `spec/10-security.md` |
| Provenance labels | `P0`–`P4` | `spec/10-security.md` |

## How to run it locally

Requires only Python 3 (tested on 3.11). From the repository root:

```bash
python scripts/run_all_checks.py        # all checks, combined PASS/FAIL
```

Or individually:

```bash
python scripts/check_spec_consistency.py
python scripts/check_markdown_links.py
python scripts/check_no_placeholders.py
python scripts/test_checks.py           # the fixture tests
```

Every script exits `0` on success and `1` on the first failing check, printing the offending `file:line`.

## How to extend without breaking the checks

All extension points live in `scripts/speclib.py`:

- **Add a specification Part / rename a file** → update `EXPECTED_SPEC_FILES`. The orphan check fails loudly if a `spec/*.md` file exists that is not on the list, so renames cannot slip through.
- **Add a decision gate** (one numbered beyond the current maximum) → raise `GATE_MAX`, and add the new gate to Appendix C. The gate-range and taxonomy checks read these automatically.
- **Add an agent** → add its row to `spec/appendix-b-agent-registry.md`. The registry is parsed at runtime; no code change is needed. New citations of that ID then pass.
- **Introduce a new non-agent ID family** (e.g. a new risk category prefix, a new critique-persona code, a new venture-ID shape) → add a pattern to `_NON_AGENT_PATTERNS`, or a literal to `_PIPELINE_MACRO_STATES`, in `speclib.py`. Otherwise the agent check will flag those tokens as suspected invented agent IDs.
- **Backtick a new technical acronym or spec keyword** (e.g. a standard like `` `GDPR` ``, or a controlled-vocabulary word like `` `MUST` ``) → add it to `TECH_ACRONYMS` or `_SPEC_VOCABULARY` in `speclib.py` so it is not mistaken for an invented agent ID. (Acronyms of 3 characters or fewer are already ignored by shape.) The check's error message names both extension points.
- **Add a taxonomy** → add an entry to `TAXONOMIES` (label list + owning file).

### Fenced code blocks

The placeholder, link, agent-reference and table-integrity checks blank fenced code blocks (triple-backtick or `~~~`) before scanning, so illustrative examples — an unfinished-work marker in a shell snippet, a link inside a JSON payload, a backticked token, or a table anti-pattern shown in a fenced example — do not produce false failures. Fence matching follows CommonMark: a closing fence uses the same character, a run at least as long as the opener, and no info string, so a four-backtick block that wraps a three-backtick example is handled correctly. The **gate-range** check is the deliberate exception: a gate cited even inside an example is treated as a real citation, because an out-of-range gate anywhere signals a genuine inconsistency.

An **unterminated** code fence is caught as its own violation (the "no unterminated code fence" check) rather than silently blanking the rest of the file — so a forgotten closing fence fails CI loudly instead of quietly disabling the prose checks.

## Known limitations (deliberate)

- **Short agent IDs are not typo-checked.** The four 2–3 character non-hyphenated IDs (`ADS`, `FPA`, `QA`, `SRE`) are lexically indistinguishable from ordinary prose abbreviations (`IC`, `EC`, `GC`, `DR`, `KI`, …), so the agent check skips tokens of that shape to avoid false positives. A typo of one of these four would not be caught.
- **External links are not verified.** `http(s)://` and `mailto:` links are skipped (would require network access). Only internal relative links are validated.
- **In-page anchors are not verified.** `#section` fragments are stripped before resolving; a link to a real file with a wrong `#anchor` still passes.
- **Table integrity targets one failure mode.** The table check targets the high-value, low-false-positive failure — a blockquote (single- or multi-line) wedged directly between two table rows — rather than attempting full markdown-table structural validation (column-count consistency, alignment rows, etc.).

These are documented gaps, not oversights: each was a conscious trade to keep the checks free of false positives so that a red build always means a real problem.

## Application-side consistency guards

Beyond the standard-library-Python spec checks above, the application workflow `.github/workflows/app-ci.yml` runs static guards over `app/src` and `ops` that keep the *implementation* internally consistent. They are ordinary Node/tsx scripts (they need the workspace installed), so they live in that workflow, not this one:

| Guard | Script | What it enforces |
|---|---|---|
| Event single writer | `pnpm check:eventlog` | every `events` write goes through `app/src/lib/eventlog.ts` |
| Gate single writer | `pnpm check:gates` | no production bypass of the gated venture primitives outside `gates.ts` |
| DR single writer | `pnpm check:dr` | one Decision-Record store + one canonicalization/digest, in `dr.ts` |
| Ratification single owner | `pnpm check:ratification` | `real_money` is derived, one owner; manifest ⇄ human tables agree |
| G-00 stop single owner | `pnpm check:stop` | the stop state, its events, and its guards live only in `stop.ts` |
| Audit conventions drift | `pnpm check:audit` | the event registry, its productive writers, and `docs/AUDIT_CONVENTIONS.md` agree (issue [#13](https://github.com/celestinojbm/EvolveOS/issues/13)) |

`check:audit` is the drift guard for the **event taxonomy**: it fails if a productive module emits an event type absent from `app/src/lib/audit-conventions.ts`, if a registered type has no writer, or if the conventions table in `docs/AUDIT_CONVENTIONS.md` diverges from the registry. See [Audit Conventions](AUDIT_CONVENTIONS.md).
