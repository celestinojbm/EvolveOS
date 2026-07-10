"""Extract canonical machine-readable data from the EvolveOS spec markdown.

This module is the single extraction source of truth for issue #4. It parses the
normative markdown (Appendix B, Appendix C, Part 0, Part VI, Part X) and produces
the canonical data structures written to schemas/data/*.json. The validator
(validate_schemas.py) re-runs this extraction and diffs it against the committed
JSON, so the data can never drift from the spec without CI failing.

Standard library only. Markdown remains the human-normative source; the JSON is
the derived, machine-readable operational source.

Derived fields (not stated verbatim per-item in the spec) are computed by the
documented rules below and flagged in docs/SCHEMAS.md:
  * gate reversibility_class = the highest R-class named in the raw cell.
  * gate human_approval_required = False only for the two agent-auto intake gates
    (G-01, G-02, per the Appendix C approver column); True otherwise.
  * gate mandatory_kill_criteria_required = True for the stage-advancing pipeline
    gates G-01..G-15 (Appendix C gate mechanic 1); False for the standing gates.
  * gate implemented_status = "planned" for the MVP-scope set (issue #4 /
    docs/MVP_SCOPE.md), "deferred" otherwise. Nothing is "active" (no running
    system yet).
Capabilities are NOT defined per-agent in Appendix B (they live in Part IV prose),
so allowed_capabilities / forbidden_capabilities are emitted as null (unknown).
"""
from __future__ import annotations

import os
import re

import speclib as S

DATA_VERSION = "0.1.0"

# --- Source files ----------------------------------------------------------
GATES_MD = os.path.join(S.SPEC_DIR, "appendix-c-decision-gates.md")
AGENTS_MD = os.path.join(S.SPEC_DIR, "appendix-b-agent-registry.md")
OVERVIEW_MD = os.path.join(S.SPEC_DIR, "00-overview.md")
KNOWLEDGE_MD = os.path.join(S.SPEC_DIR, "06-knowledge-system.md")
SECURITY_MD = os.path.join(S.SPEC_DIR, "10-security.md")

# MVP-scope gates (issue #4 "implemented: true" set / docs/MVP_SCOPE.md).
_MVP_GATES = {"G-00", "G-01", "G-02", "G-03", "G-04", "G-05", "G-06", "G-17", "G-18"}
# Gates whose approver is a pure agent auto-approval (Appendix C approver column).
_AUTO_APPROVAL_GATES = {"G-01", "G-02"}


# --- Small markdown helpers ------------------------------------------------

def _unbold(s: str) -> str:
    return s.replace("**", "").strip()


def _cells(line: str):
    """Split a markdown table row into stripped cells (no leading/trailing empties)."""
    parts = [c.strip() for c in line.split("|")]
    if parts and parts[0] == "":
        parts = parts[1:]
    if parts and parts[-1] == "":
        parts = parts[:-1]
    return parts


def _ceiling_level(raw: str):
    """Return the autonomy CEILING = the highest A-level named in the cell.

    A ceiling is the maximum level the agent may operate at (Part 0 §6), so a
    compound cell like "A3 (monitoring) / A0 (limit changes)" resolves to A3.
    """
    for n in range(4, -1, -1):
        if f"A{n}" in raw:
            return f"A{n}"
    return None


# --- Gates (Appendix C) ----------------------------------------------------

_GATE_ROW = re.compile(r"^\|\s*\*\*G-\d\d\*\*\s*\|")


def _reversibility_class(raw: str) -> str:
    for cls in ("R4", "R3", "R2", "R1"):
        if cls in raw:
            return cls
    return "control"  # G-00 "Control action (always available)"


def build_gates():
    gates = []
    for line in S.read_lines(GATES_MD):
        if not _GATE_ROW.match(line):
            continue
        c = _cells(line)
        # Both the standing and pipeline tables share column positions:
        # 0 id | 1 name | 2 trigger/transition | 3 reversibility | 4 inputs
        # | 5 approver | 6 sla/envelope
        gid = _unbold(c[0]).replace("`", "")
        raw_rev = _unbold(c[3])
        num = int(gid.split("-")[1])
        section = "standing" if gid in {"G-00", "G-16", "G-17", "G-18"} else "pipeline"
        gates.append({
            "id": gid,
            "name": _unbold(c[1]),
            "section": section,
            "trigger_or_transition": _unbold(c[2]),
            "reversibility_class": _reversibility_class(raw_rev),
            "reversibility_raw": raw_rev,
            "decision_inputs": _unbold(c[4]),
            "approver_body": _unbold(c[5]),
            "human_approval_required": gid not in _AUTO_APPROVAL_GATES,
            "mandatory_kill_criteria_required": 1 <= num <= 15,
            "sla_or_envelope": _unbold(c[6]),
            "implemented_status": "planned" if gid in _MVP_GATES else "deferred",
            "source_markdown_reference": "spec/appendix-c-decision-gates.md",
        })
    gates.sort(key=lambda g: g["id"])
    return {"version": DATA_VERSION,
            "source": "spec/appendix-c-decision-gates.md",
            "gates": gates}


# --- Agents (Appendix B) ---------------------------------------------------

_TIER_HEADER = re.compile(r"^##\s*(T[1-4])\b")
_ROW_ID = re.compile(r"^\|\s*`([A-Z][A-Z0-9-]+)`\s*\|")
_HUMAN_BODIES = [
    "Executive Committee", "Investment Committee", "Audit & Risk Committee",
    "Tech & Safety Committee", "Board", "General Counsel", "Head of People",
    "CEO", "CFO", "CISO",
]


def _human_officer(text: str):
    found = [b for b in _HUMAN_BODIES if b in text]
    return found[0] if found else None


def build_agents():
    agents = []
    tier = None
    for line in S.read_lines(AGENTS_MD):
        h = _TIER_HEADER.match(line)
        if h:
            tier = h.group(1)
            continue
        if tier is None or not _ROW_ID.match(line):
            continue
        c = _cells(line)
        aid = c[0].replace("`", "").strip()
        rec = {
            "id": aid,
            "tier": tier,
            "allowed_capabilities": None,   # not defined in Appendix B (Part IV prose)
            "forbidden_capabilities": None,
            "source_markdown_reference": "spec/appendix-b-agent-registry.md",
        }
        if tier in ("T1", "T2"):
            # | ID | Name | Scope | Purpose | Autonomy ceiling | Reports to |
            rec["name"] = c[1]
            rec["scope"] = c[2]
            rec["purpose"] = c[3]
            rec["autonomy_ceiling"] = _ceiling_level(c[4])
            rec["autonomy_ceiling_raw"] = c[4]
            rec["reports_to"] = c[5].replace("`", "")
            rec["human_accountable_officer"] = _human_officer(c[5])
        elif tier == "T3":
            # | ID | Name | Domain (director) | Purpose | Autonomy ceiling |
            rec["name"] = c[1]
            rec["domain"] = c[2].replace("`", "")
            rec["purpose"] = c[3]
            rec["autonomy_ceiling"] = _ceiling_level(c[4])
            rec["autonomy_ceiling_raw"] = c[4]
            rec["human_accountable_officer"] = None  # reports to a director agent
        else:  # T4
            # | Class ID | Spawned by | Purpose | Autonomy ceiling | Lifetime |
            rec["name"] = aid
            rec["spawned_by"] = c[1].replace("`", "")
            rec["purpose"] = c[2]
            rec["autonomy_ceiling"] = _ceiling_level(c[3])
            rec["autonomy_ceiling_raw"] = c[3]
            rec["lifetime"] = c[4]
            rec["human_accountable_officer"] = None
        agents.append(rec)
    agents.sort(key=lambda a: (a["tier"], a["id"]))
    return {"version": DATA_VERSION,
            "source": "spec/appendix-b-agent-registry.md",
            "agents": agents}


# --- Taxonomies ------------------------------------------------------------

def _table_entries(path, row_prefix_re, id_split="—"):
    """Parse '| **ID — Name** | col1 | ... |' rows into (id, name, cols[])."""
    out = []
    for line in S.read_lines(path):
        if not row_prefix_re.match(line):
            continue
        c = _cells(line)
        head = _unbold(c[0])
        if id_split in head:
            tid, name = [x.strip() for x in head.split(id_split, 1)]
        else:
            tid, name = head.strip(), ""
        out.append((tid, name, c[1:]))
    return out


def build_taxonomies():
    tax = {}

    # Reversibility R1-R4 (Part 0 §5): | **R1** | Name | Definition | Examples |
    rev = []
    for line in S.read_lines(OVERVIEW_MD):
        if re.match(r"^\|\s*\*\*R[1-4]\*\*\s*\|", line):
            c = _cells(line)
            rev.append({"id": _unbold(c[0]), "name": _unbold(c[1]),
                        "description": _unbold(c[2]),
                        "source_markdown_reference": "spec/00-overview.md#5",
                        "normative_status": "constitutional"})
    tax["reversibility_classes"] = sorted(rev, key=lambda x: x["id"])

    # Autonomy A0-A4 (Part 0 §6): | **A0** | Name | Meaning |
    aut = []
    for line in S.read_lines(OVERVIEW_MD):
        if re.match(r"^\|\s*\*\*A[0-4]\*\*\s*\|", line):
            c = _cells(line)
            aut.append({"id": _unbold(c[0]), "name": _unbold(c[1]),
                        "description": _unbold(c[2]),
                        "source_markdown_reference": "spec/00-overview.md#6",
                        "normative_status": "constitutional"})
    tax["autonomy_levels"] = sorted(aut, key=lambda x: x["id"])

    # Gates G-00..G-18 (id + name only; full detail in gates.json)
    tax["gates"] = [{"id": g["id"], "name": g["name"],
                     "source_markdown_reference": "spec/appendix-c-decision-gates.md",
                     "normative_status": "constitutional"}
                    for g in build_gates()["gates"]]

    # Privacy classes PC-0..PC-3 (Part VI): | **PC-0 — Public** | ... | ... |
    pc = []
    for tid, name, cols in _table_entries(
            KNOWLEDGE_MD, re.compile(r"^\|\s*\*\*PC-[0-3]")):
        pc.append({"id": tid, "name": name,
                   "description": _unbold(cols[0]) if cols else "",
                   "source_markdown_reference": "spec/06-knowledge-system.md#8",
                   "normative_status": "normative"})
    tax["privacy_classes"] = sorted(pc, key=lambda x: x["id"])

    # Data classes C0-C4 (Part X): "- **C0 — public**: description"
    dc = []
    for line in S.read_lines(SECURITY_MD):
        m = re.match(r"^\s*-\s*\*\*(C[0-4])\s*—\s*([^*]+?)\*\*:\s*(.+)$", line)
        if m:
            dc.append({"id": m.group(1), "name": m.group(2).strip(),
                       "description": m.group(3).strip().rstrip("."),
                       "source_markdown_reference": "spec/10-security.md#5",
                       "normative_status": "constitutional"})
    tax["data_classes"] = sorted(dc, key=lambda x: x["id"])

    # Provenance labels P0-P4 (Part X): "- **P0** — Name: description"
    pv = []
    for line in S.read_lines(SECURITY_MD):
        m = re.match(r"^\s*-\s*\*\*(P[0-4])\*\*\s*—\s*(.+?):\s*(.+)$", line)
        if m:
            pv.append({"id": m.group(1), "name": m.group(2).strip(),
                       "description": m.group(3).strip().rstrip("."),
                       "source_markdown_reference": "spec/10-security.md#11",
                       "normative_status": "constitutional"})
    tax["provenance_labels"] = sorted(pv, key=lambda x: x["id"])

    return {"version": DATA_VERSION, "source": "spec/ (Parts 0, VI, X, Appendix C)",
            "taxonomies": tax}


BUILDERS = {
    "taxonomies": build_taxonomies,
    "gates": build_gates,
    "agents": build_agents,
}
