#!/usr/bin/env python3
"""Validate the EvolveOS machine-readable schemas and canonical data.

Standard library only (no jsonschema dependency): a small validator covers the
JSON-Schema subset the schemas use (type, enum, const, pattern, minimum,
maximum, minLength, minItems, properties, required, additionalProperties, items).
Using that subset keeps CI dependency-free, matching the rest of the repo.

Checks:
  1. every schemas/*.schema.json and schemas/data/*.json parses;
  2. drift: schemas/data/*.json equals a fresh extraction from the spec markdown
     (the Appendix C / Appendix B / taxonomy "diff check" — either side changing
     unilaterally fails CI);
  3. each data file validates against its schema;
  4. completeness: gates are exactly G-00..G-18, taxonomies are complete, and the
     agents match the Appendix B registry;
  5. fixtures: every schemas/examples/valid/* validates, every invalid/* fails.

Run locally:  python scripts/validate_schemas.py
Regenerate the data files from the spec:  python scripts/validate_schemas.py --write
"""
from __future__ import annotations

import json
import os
import re
import sys

import speclib as S
import schema_tools as T

SCHEMAS_DIR = os.path.join(S.REPO_ROOT, "schemas")
DATA_DIR = os.path.join(SCHEMAS_DIR, "data")
EX_VALID = os.path.join(SCHEMAS_DIR, "examples", "valid")
EX_INVALID = os.path.join(SCHEMAS_DIR, "examples", "invalid")

# data-file name -> schema file
DATA_SPECS = {
    "taxonomies": "taxonomies.schema.json",
    "gates": "gates.schema.json",
    "agents": "agents.schema.json",
}
# fixture basename -> schema file
FIXTURE_SPECS = {
    "decision-record": "decision-record.schema.json",
    "knowledge-item": "knowledge-item.schema.json",
    "event": "event.schema.json",
    "task-contract": "task-contract.schema.json",
}


# --- minimal JSON-Schema validator ----------------------------------------

def _type_ok(v, t):
    if t == "object":
        return isinstance(v, dict)
    if t == "array":
        return isinstance(v, list)
    if t == "string":
        return isinstance(v, str)
    if t == "boolean":
        return isinstance(v, bool)
    if t == "integer":
        return isinstance(v, int) and not isinstance(v, bool)
    if t == "number":
        return isinstance(v, (int, float)) and not isinstance(v, bool)
    if t == "null":
        return v is None
    return False


def validate(instance, schema, path="$"):
    errors = []
    t = schema.get("type")
    if t is not None:
        types = t if isinstance(t, list) else [t]
        if not any(_type_ok(instance, tt) for tt in types):
            errors.append(f"{path}: expected type {t}, got {type(instance).__name__}")
            return errors  # further keyword checks are unreliable on wrong type

    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: {instance!r} not in enum {schema['enum']}")
    if "const" in schema and instance != schema["const"]:
        errors.append(f"{path}: {instance!r} != const {schema['const']!r}")

    if isinstance(instance, str):
        if "pattern" in schema and not re.search(schema["pattern"], instance):
            errors.append(f"{path}: {instance!r} does not match /{schema['pattern']}/")
        if "minLength" in schema and len(instance) < schema["minLength"]:
            errors.append(f"{path}: shorter than minLength {schema['minLength']}")

    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        if "minimum" in schema and instance < schema["minimum"]:
            errors.append(f"{path}: {instance} < minimum {schema['minimum']}")
        if "maximum" in schema and instance > schema["maximum"]:
            errors.append(f"{path}: {instance} > maximum {schema['maximum']}")

    if isinstance(instance, list):
        if "minItems" in schema and len(instance) < schema["minItems"]:
            errors.append(f"{path}: fewer than minItems {schema['minItems']}")
        if "items" in schema:
            for i, item in enumerate(instance):
                errors += validate(item, schema["items"], f"{path}[{i}]")

    if isinstance(instance, dict):
        props = schema.get("properties", {})
        for req in schema.get("required", []):
            if req not in instance:
                errors.append(f"{path}: missing required property '{req}'")
        if schema.get("additionalProperties") is False:
            for k in instance:
                if k not in props:
                    errors.append(f"{path}: additional property '{k}' not allowed")
        for k, sub in props.items():
            if k in instance:
                errors += validate(instance[k], sub, f"{path}.{k}")
    return errors


# --- helpers ---------------------------------------------------------------

def _load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _serialize(data):
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def write_data():
    os.makedirs(DATA_DIR, exist_ok=True)
    for name, builder in T.BUILDERS.items():
        with open(os.path.join(DATA_DIR, f"{name}.json"), "w", encoding="utf-8") as fh:
            fh.write(_serialize(builder()))
        print(f"wrote schemas/data/{name}.json")


# --- checks ----------------------------------------------------------------

def run():
    violations = []

    # 1. schemas parse
    schemas = {}
    for fn in set(list(DATA_SPECS.values()) + list(FIXTURE_SPECS.values())):
        p = os.path.join(SCHEMAS_DIR, fn)
        try:
            schemas[fn] = _load(p)
        except Exception as e:  # noqa: BLE001
            violations.append(f"schema {fn} does not parse: {e}")

    # 2 + 3. data drift + schema validation
    for name, schema_fn in DATA_SPECS.items():
        committed_path = os.path.join(DATA_DIR, f"{name}.json")
        if not os.path.isfile(committed_path):
            violations.append(f"missing data file schemas/data/{name}.json (run --write)")
            continue
        with open(committed_path, encoding="utf-8") as fh:
            committed_text = fh.read()
        generated_text = _serialize(T.BUILDERS[name]())
        if committed_text != generated_text:
            violations.append(
                f"schemas/data/{name}.json has drifted from the spec — "
                f"run `python scripts/validate_schemas.py --write`")
        if schema_fn in schemas:
            data = json.loads(committed_text)
            errs = validate(data, schemas[schema_fn], f"data/{name}")
            violations += errs

    # 4. completeness
    gates = T.build_gates()["gates"]
    gate_ids = sorted(g["id"] for g in gates)
    expected_gates = [f"G-{n:02d}" for n in range(0, 19)]
    if gate_ids != expected_gates:
        violations.append(f"gates not exactly G-00..G-18: got {gate_ids}")

    tax = T.build_taxonomies()["taxonomies"]
    expected_tax = {
        "reversibility_classes": [f"R{n}" for n in range(1, 5)],
        "autonomy_levels": [f"A{n}" for n in range(0, 5)],
        "privacy_classes": [f"PC-{n}" for n in range(0, 4)],
        "data_classes": [f"C{n}" for n in range(0, 5)],
        "provenance_labels": [f"P{n}" for n in range(0, 5)],
    }
    for fam, ids in expected_tax.items():
        got = sorted(e["id"] for e in tax[fam])
        if got != ids:
            violations.append(f"taxonomy '{fam}' incomplete: expected {ids}, got {got}")
    if sorted(e["id"] for e in tax["gates"]) != expected_gates:
        violations.append("taxonomy 'gates' does not match G-00..G-18")

    agents = T.build_agents()["agents"]
    agent_ids = {a["id"] for a in agents}
    registry = S.load_agent_registry(os.path.join(S.SPEC_DIR, "appendix-b-agent-registry.md"))
    if agent_ids != registry:
        missing = registry - agent_ids
        extra = agent_ids - registry
        violations.append(f"agents data inconsistent with Appendix B "
                          f"(missing {sorted(missing)}, extra {sorted(extra)})")
    if len(agents) != 68:
        violations.append(f"expected 68 agents, got {len(agents)}")

    # 5. fixtures
    for name, schema_fn in FIXTURE_SPECS.items():
        schema = schemas.get(schema_fn)
        if schema is None:
            continue
        valid_p = os.path.join(EX_VALID, f"{name}.json")
        invalid_p = os.path.join(EX_INVALID, f"{name}.json")
        if os.path.isfile(valid_p):
            errs = validate(_load(valid_p), schema, f"valid/{name}")
            if errs:
                violations.append(f"valid fixture {name} unexpectedly failed: {errs[0]}")
        else:
            violations.append(f"missing valid fixture {name}")
        if os.path.isfile(invalid_p):
            errs = validate(_load(invalid_p), schema, f"invalid/{name}")
            if not errs:
                violations.append(f"invalid fixture {name} unexpectedly passed")
        else:
            violations.append(f"missing invalid fixture {name}")

    # report
    if violations:
        print(f"FAIL  schema validation ({len(violations)}):")
        for v in violations:
            print(f"        {v}")
        print(f"\nvalidate-schemas: {len(violations)} violation(s)")
        return 1
    print("ok    schemas parse")
    print("ok    data matches spec (no drift)")
    print("ok    data validates against schemas")
    print("ok    gates G-00..G-18 complete; taxonomies complete; agents match Appendix B")
    print("ok    fixtures (valid pass, invalid fail)")
    print("\nvalidate-schemas: all checks passed")
    return 0


if __name__ == "__main__":
    if "--write" in sys.argv[1:]:
        write_data()
        sys.exit(0)
    sys.exit(run())
