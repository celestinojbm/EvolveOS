# Machine-Readable Schemas

**Status:** v1.0 · Implements Phase 0 issue **[#4](https://github.com/celestinojbm/EvolveOS/issues/4)** (P0-3). Extracts the minimal constitutional layer from the prose specification into versioned, machine-readable JSON so future implementations can validate gates, taxonomies, agents, and records without parsing Markdown.

**Source of truth.** The Markdown under `spec/` remains the **human-normative** source. The JSON here is the **first operational, machine-readable source**, *derived* from the Markdown and kept in sync by a drift check (below). When the two disagree, the Markdown wins and CI fails until the data is regenerated.

Standard-library Python 3 only — no `jsonschema` dependency, so CI needs no install step (the same zero-dependency design as the rest of the repo).

## What is here

```text
schemas/
  taxonomies.schema.json        # shape of the taxonomies data
  gates.schema.json             # shape of the gates data
  agents.schema.json            # shape of the agents data
  decision-record.schema.json   # shape of a Decision Record (future records)
  knowledge-item.schema.json    # shape of a Knowledge Item
  event.schema.json             # shape of an append-only event
  data/
    taxonomies.json             # R1-R4, A0-A4, G-00..G-18, PC-0..PC-3, C0-C4, P0-P4
    gates.json                  # the 19 gates as data
    agents.json                 # the 68 agents as data
  examples/
    valid/{decision-record,knowledge-item,event}.json
    invalid/{decision-record,knowledge-item,event}.json
scripts/
  schema_tools.py               # extracts the data from the spec Markdown
  validate_schemas.py           # validates + regenerates (--write)
```

## The canonical data

| File | Content | Extracted from |
|---|---|---|
| `data/taxonomies.json` | the six canonical taxonomies, each entry `{id, name, description, source_markdown_reference, normative_status}` | `spec/00-overview.md` §5–§6, `spec/appendix-c-decision-gates.md`, `spec/06-knowledge-system.md`, `spec/10-security.md` |
| `data/gates.json` | all 19 gates `G-00…G-18` with reversibility, approver, human-approval and kill-criteria flags, and MVP `implemented_status` | `spec/appendix-c-decision-gates.md` |
| `data/agents.json` | all 68 agents with tier, autonomy ceiling, and human accountable officer | `spec/appendix-b-agent-registry.md` |

The three data files are **generated from the spec**, never hand-edited. `scripts/schema_tools.py` parses the Markdown tables; `scripts/validate_schemas.py --write` writes the JSON. CI re-runs the extraction and fails if the committed JSON differs — so neither the spec nor the data can change unilaterally without the other being updated (the "diff check" from issue #4).

## Derived fields and their rules

A few fields are not stated verbatim per item in the spec; they are computed by documented rules:

- **Gate `reversibility_class`** — the highest R-class named in the Appendix C cell (`G-00` is `control`).
- **Gate `human_approval_required`** — `false` only for the two agent-auto intake gates `G-01`, `G-02` (per the Appendix C approver column); `true` otherwise.
- **Gate `mandatory_kill_criteria_required`** — `true` for the stage-advancing pipeline gates `G-01…G-15` (Appendix C gate mechanic 1); `false` for the standing gates.
- **Gate `implemented_status`** — `planned` for the MVP-scope set (`G-00…G-06, G-17, G-18`, per issue #4 and [MVP Scope](MVP_SCOPE.md)); `deferred` otherwise (including `G-16`, which needs committees that do not exist yet). Nothing is `active` — no running system enforces these yet.
- **Agent `allowed_capabilities` / `forbidden_capabilities`** — `null` (unknown): capabilities are described in Part IV prose, not in Appendix B, and were deliberately not extracted (see limitations).

## How to validate locally

```bash
python scripts/validate_schemas.py          # validate data + fixtures (CI runs this)
python scripts/validate_schemas.py --write   # regenerate schemas/data/*.json from the spec
```

The validator checks: every schema and data file parses; the data matches a fresh extraction from the spec (no drift); the data validates against its schema; the gates are exactly `G-00…G-18`; every taxonomy family is complete; the agents match the Appendix B registry; and every valid fixture passes while every invalid fixture fails.

It runs in CI as a fifth step in `.github/workflows/spec-consistency.yml`, alongside the existing consistency checks (`check_spec_consistency.py`, `check_markdown_links.py`, `check_no_placeholders.py`) and `test_checks.py` — all of which still pass. (`run_all_checks.py` is a local convenience wrapper that runs the three consistency checks together; CI invokes the individual scripts.)

## How to add a gate, agent, or taxonomy without breaking CI

Because the data is generated, you only edit the **Markdown**, then regenerate:

1. Edit the spec (add a gate row to `spec/appendix-c-decision-gates.md`, an agent row to `spec/appendix-b-agent-registry.md`, or a taxonomy row to its owning file).
2. Run `python scripts/validate_schemas.py --write` to regenerate `schemas/data/*.json`.
3. Commit both the spec change and the regenerated data. CI's drift check enforces that they travel together.

If you add a gate numbered beyond `G-18`, also raise `GATE_MAX` in `scripts/speclib.py` (the existing consistency check) and the expected range in `scripts/validate_schemas.py`.

## Fixtures

`schemas/examples/valid/` and `schemas/examples/invalid/` hold one valid and one deliberately-broken example each for Decision Records, Knowledge Items, and events. The invalid fixtures fail for concrete, checked reasons (a bad enum value, an out-of-range number, a missing required field, an additional property), so a regression that weakened a schema would make an invalid fixture start passing — and CI would catch it.

## Known limitations (deliberate)

- **Agent capabilities are not extracted.** Appendix B does not define per-agent tool allowlists; those live in the Part IV agent cards as prose. `allowed_capabilities` / `forbidden_capabilities` are `null`. Extracting the Part IV tool lists is a candidate for a later issue.
- **`implemented_status` is a build-scope classification, not a spec assertion.** It reflects the MVP scope (issue #4 / MVP Scope), not a normative value in the specification.
- **The JSON-Schema validator supports a subset** of draft 2020-12 (type, enum, const, pattern, minimum, maximum, minLength, minItems, properties, required, additionalProperties, items). The schemas are written within that subset on purpose to avoid an external dependency. `format` is not enforced.
- **Records are schemas, not stores.** The Decision Record, Knowledge Item, and event schemas define shape only; there is no database, no writer, and no runtime — those are later Phase 0/1 issues.

## Out of scope for this change

No application, dashboard, database, executable agents, credentials, APIs, infrastructure, login, workers, or external automation. This change is purely the canonical data + schemas + their validation. It changes no constitutional rule; it only mirrors the spec into machine-readable form.
