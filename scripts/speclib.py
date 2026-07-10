"""Shared helpers for the EvolveOS spec-consistency checks.

Design goals: standard library only, no heavy dependencies, and every check
function takes its inputs explicitly so it can be unit-tested against small
fixtures (see scripts/test_checks.py). The command-line entry points in the
sibling check_*.py scripts wire these functions to the real repository.
"""
from __future__ import annotations

import os
import re

# --- Repository layout -----------------------------------------------------

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEC_DIR = os.path.join(REPO_ROOT, "spec")
DOCS_DIR = os.path.join(REPO_ROOT, "docs")

# The 19 canonical specification files. This list is the source of truth for
# "the spec is complete"; it uses the REAL on-disk filenames. To add a Part,
# add its filename here (and to spec/00-overview.md's document map).
EXPECTED_SPEC_FILES = [
    "00-overview.md",
    "01-philosophy.md",
    "02-system-thinking.md",
    "03-organizational-architecture.md",
    "04-multi-agent-system.md",
    "05-business-creation-pipeline.md",
    "06-knowledge-system.md",
    "07-decision-engine.md",
    "08-finance.md",
    "09-technology.md",
    "10-security.md",
    "11-governance.md",
    "12-self-evolution.md",
    "13-failure-analysis.md",
    "14-implementation-roadmap.md",
    "15-critique-and-revisions.md",
    "appendix-a-glossary.md",
    "appendix-b-agent-registry.md",
    "appendix-c-decision-gates.md",
]

# --- Gate range ------------------------------------------------------------

GATE_MIN, GATE_MAX = 0, 18
# A gate CITATION is "G-" followed by exactly two digits, bounded by non-word
# characters. This deliberately ignores shorthand like "G-0n" or "G-01→G-03"
# ranges written in prose, and template forms like "G-xx".
GATE_CITATION_RE = re.compile(r"(?<![\w-])G-(\d{2})(?![\w-])")

# --- Canonical taxonomies --------------------------------------------------
# Each taxonomy must have every one of its labels present at least once in its
# "home" file. Home files are where the taxonomy is defined (Part 0 section 9
# rules: a taxonomy is owned by exactly one document).
TAXONOMIES = {
    "Reversibility R1-R4": ("00-overview.md", ["R1", "R2", "R3", "R4"]),
    "Autonomy A0-A4": ("00-overview.md", ["A0", "A1", "A2", "A3", "A4"]),
    "Gates G-00-G-18": (
        "appendix-c-decision-gates.md",
        [f"G-{n:02d}" for n in range(GATE_MIN, GATE_MAX + 1)],
    ),
    "Privacy PC-0-PC-3": ("06-knowledge-system.md", ["PC-0", "PC-1", "PC-2", "PC-3"]),
    "Data class C0-C4": ("10-security.md", ["C0", "C1", "C2", "C3", "C4"]),
    "Provenance P0-P4": ("10-security.md", ["P0", "P1", "P2", "P3", "P4"]),
}

# --- Agent-ID detection ----------------------------------------------------
# A backticked token is treated as an AGENT REFERENCE when it matches the agent
# lexical shape (hyphenated uppercase, or an all-caps word of length >= 4) and
# is not claimed by a non-agent namespace below. Such a token must resolve to
# the Appendix B registry.
#
# Note: 2-3 char non-hyphenated IDs (ADS, FPA, QA, SRE) are intentionally NOT
# validated -- they are lexically indistinguishable from ordinary prose
# abbreviations (IC, EC, GC, DR, KI, ...). This is a deliberate, documented gap.
AGENT_CANDIDATE_RE = re.compile(r"^(?:[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+|[A-Z][A-Z0-9]{3,})$")

# Structured non-agent namespaces (regex). Extend these when a new ID family is
# introduced in the spec (e.g. a new risk category or critique persona).
_NON_AGENT_PATTERNS = [
    r"^G-\d\d$",                                # gate IDs (range-checked elsewhere)
    # Risk-register IDs (Part XIII): a fixed set of category codes, optionally
    # numbered. Enumerated (not RISK-[A-Z]+) so an invented RISK-prefixed agent
    # such as a typo of RISK-DIR is still flagged.
    r"^RISK-(ECON|ORG|TECH|HUM|SEC|MKT|SPOF|EMRG|UNK|AI)(-\d+)?$",
    r"^(CEO|YC|ECON|DSA|AIR|SEC|VC|LAW)-\d+$",  # Part XV criticism IDs
    r"^MOAT-\d+$",                              # moat IDs (Part I)
    r"^V-\d{4}-\d+$",                           # venture ID examples
    r"^DR-\d{4}-\d+$",                          # decision-record IDs
    r"^XV-\d+$",                                # revision IDs
    r"^ADR-\d+$",                               # architecture decision records
    r"^M\d+[a-z]?$",                            # milestone IDs (docs)
    # Format placeholders, anchored to the placeholder token shape so it cannot
    # swallow ordinary tokens that merely CONTAIN MM/DD/etc. (e.g. COMMS-DIR).
    r"^(?:[A-Z]+-)?(?:YYYY|MM|DD|SEQ|NN|X{2,})(?:[-/](?:YYYY|MM|DD|SEQ|NN|X{2,}|\d+))*$",
    r"^[IVXLCDM]{2,}$",                         # roman numerals (Part references)
    r"^E-CF$",                                  # evidence tier (revision XV-10)
]
_NON_AGENT_RE = [re.compile(p) for p in _NON_AGENT_PATTERNS]

# Named literal non-agent tokens: pipeline macro-states from Part V. These are
# ordinary uppercase words that collide with the agent shape but name lifecycle
# states, not agents.
_PIPELINE_MACRO_STATES = {
    "ANALYSIS", "ARCHIVED", "EXIT-PROCESS", "EXPANSION",
    "INTERNATIONALIZATION", "MERGER-INTEGRATION", "OPERATING",
    "SHUTDOWN", "ACQ-INTEGRATION",
}

# Common technical / standards acronyms that share the agent lexical shape
# (4+ char all-caps). A spec on infrastructure, security and compliance uses
# these routinely; backticking one (a normal copy-edit) must not be mistaken
# for an invented agent ID. Add to this set as new acronyms appear.
TECH_ACRONYMS = frozenset({
    "JSON", "YAML", "TOML", "HTML", "HTTP", "HTTPS", "REST", "GRPC", "GRAPHQL",
    "SOAP", "OIDC", "SAML", "OAUTH", "WEBAUTHN", "FIDO2", "TOTP", "MTLS",
    "SPIFFE", "SPIRE", "SVID", "GDPR", "HIPAA", "CCPA", "SOC2", "SOX",
    "PCI-DSS", "FEDRAMP", "FIPS", "ISO27001", "SLSA", "SLSA-L3", "CIDR",
    "UUID", "ULID", "CRUD", "ACID", "OLTP", "OTLP", "SIEM", "SOAR", "SBOM",
    "SAST", "DAST", "OODA", "SDLC", "AMQP", "MTTR", "MTTD", "PITR",
    "POSTGRES", "REDIS", "KAFKA", "GITHUB", "OPENTOFU", "OPENTELEMETRY",
    "TERRAFORM", "KUBERNETES", "SLIS", "SLOS", "SLAS", "RTOS", "RPOS",
    "SCIM", "LDAP", "IMAP", "SMTP", "REGO", "COBOL", "NGINX",
    # Finance / operating acronyms used in the spec
    "EBITDA", "COGS", "MOIC", "CSAT", "MAPE", "RACI", "JTBD", "SPOF", "HRIS",
})

# The specification's own controlled vocabulary (RFC-2119 keywords and the
# marker / disposition words used throughout). These are ordinary words that
# share the agent lexical shape; backticking one for emphasis must not read as
# an invented agent ID.
_SPEC_VOCABULARY = frozenset({
    "MUST", "SHOULD", "SHALL", "OPTIONAL", "REQUIRED", "MANDATORY",
    "ASSUMPTION", "UNCERTAIN", "DECISION", "ADOPTED", "ADOPT", "DEFERRED",
    "REJECTED", "PARTIALLY", "CHOSEN", "TERMINAL",
})

BACKTICK_TOKEN_RE = re.compile(r"`([A-Za-z][A-Za-z0-9-]*)`")

# A code fence: 3+ backticks or tildes, optionally indented. Group 1 is the run.
_FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")


def is_non_agent_token(token: str) -> bool:
    """True if a backtick token belongs to a known non-agent namespace."""
    if token in _PIPELINE_MACRO_STATES:
        return True
    if token in TECH_ACRONYMS:
        return True
    if token in _SPEC_VOCABULARY:
        return True
    return any(r.match(token) for r in _NON_AGENT_RE)


def _fence_regions(lines):
    """Scan *lines* for fenced code blocks.

    Returns (regions, open_index): `regions` is a list of (start, end) inclusive
    line indices for each closed fenced block (markers included); `open_index`
    is the index of an opener whose fence is never closed, or None.

    Closing follows CommonMark: a closing fence uses the same character as the
    opener, a run at least as long, and carries no info string (nothing but
    whitespace after the run). This makes a 4-backtick block that wraps a
    3-backtick example close only on its matching 4-backtick line.
    """
    regions = []
    open_index = None
    open_char = None
    open_len = None
    for i, line in enumerate(lines):
        m = _FENCE_RE.match(line)
        if open_index is None:
            if m:
                run = m.group(1)
                open_index, open_char, open_len = i, run[0], len(run)
        else:
            if m:
                run = m.group(1)
                after = line[m.end():].strip()
                if run[0] == open_char and len(run) >= open_len and after == "":
                    regions.append((open_index, i))
                    open_index = open_char = open_len = None
    return regions, open_index


def strip_fenced_blocks(lines):
    """Return a same-length copy of *lines* with fenced code blocks blanked.

    Lines inside a ``` (or ~~~) fenced block -- and the fence markers -- are
    replaced with "" so line numbers are preserved but illustrative code /
    config examples do not trip the prose-oriented checks (placeholders, links,
    agent references, table integrity). The gate-range check deliberately does
    NOT use this: a gate cited even inside an example is a real citation.

    An unterminated fence blanks to EOF; that unterminated fence is separately
    surfaced as a violation by check_fenced_blocks (Part IX consistency check)
    so the blanking can never silently hide a real defect.
    """
    regions, open_index = _fence_regions(lines)
    blank = set()
    for start, end in regions:
        blank.update(range(start, end + 1))
    if open_index is not None:
        blank.update(range(open_index, len(lines)))
    return ["" if i in blank else line for i, line in enumerate(lines)]


def unterminated_fence_line(lines):
    """Return the 1-based line number of an unterminated code fence, or None."""
    _, open_index = _fence_regions(lines)
    return None if open_index is None else open_index + 1


def load_agent_registry(registry_path: str) -> set:
    """Return the set of agent IDs declared as table rows in Appendix B."""
    text = _read(registry_path)
    return set(re.findall(r"^\|\s*`([A-Z][A-Z0-9-]+)`", text, re.M))


# --- Small IO helpers ------------------------------------------------------

def _read(path: str) -> str:
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def read_lines(path: str):
    with open(path, encoding="utf-8") as fh:
        return fh.read().splitlines()


def markdown_files(*dirs: str):
    """Yield absolute paths of *.md files directly inside the given dirs."""
    out = []
    for d in dirs:
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if name.endswith(".md"):
                out.append(os.path.join(d, name))
    return out


def default_content_files():
    """spec/*.md + docs/*.md + README.md (whatever exists)."""
    files = markdown_files(SPEC_DIR, DOCS_DIR)
    readme = os.path.join(REPO_ROOT, "README.md")
    if os.path.isfile(readme):
        files.append(readme)
    return files


def rel(path: str) -> str:
    """Repo-relative path for readable reporting."""
    try:
        return os.path.relpath(path, REPO_ROOT)
    except ValueError:
        return path
