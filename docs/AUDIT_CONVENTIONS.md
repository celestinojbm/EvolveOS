# Audit-trail conventions + event-log verification

**Status:** Phase 0 · Implements issue **[#13](https://github.com/celestinojbm/EvolveOS/issues/13)** (P0-12), the last Phase 0 issue. Blocked by (builds on) [#6](https://github.com/celestinojbm/EvolveOS/issues/6).

This document is the **event taxonomy** of Phase 0: every event type the productive modules emit, and the exact contract of each (who may emit it, what it is about, and the shape of its payload). It is paired with a CLI, [`ops/verify-log.ts`](../ops/verify-log.ts), that re-verifies the whole hash chain **and** every convention and produces a human-readable audit extract for a date range or a venture.

**Normative sources.** Part VI §1 (the L0 append-only event log and its derived views); Part XI §3.3 (the Portfolio/Audit review, "ARC" here at pathfinder scale), §10.3 (avoiding oversight theater), §11 (accountability), §13.1 (internal audit); the constitutional [`schemas/event.schema.json`](../schemas/event.schema.json); and the integrity design in [`docs/EVENT_LOG.md`](EVENT_LOG.md). The single machine-readable source of the conventions is [`app/src/lib/audit-conventions.ts`](../app/src/lib/audit-conventions.ts) — this document mirrors it, and `pnpm check:audit` fails CI if the two ever diverge.

## L0 is the source of truth

The append-only `events` table is **L0** — the ground truth of what happened. Every queryable projection (users and roles, ventures, gate passes, decision records, the system-stop state) is a *derived view* that can be rebuilt from L0; none of them is authoritative on its own. An audit therefore reads L0, not the projections: the projections are convenience, the event log is the record.

## Base event format

Every row is exactly the fields of [`schemas/event.schema.json`](../schemas/event.schema.json) plus a `seq`:

| Field | Meaning |
|---|---|
| `seq` | `bigint` identity — insertion order **is** chain order (gaps allowed; strictly increasing) |
| `id` | caller-supplied logical id (**non-blank** — at least one non-whitespace char) |
| `timestamp` | RFC3339 instant, stored verbatim so the hash is reproducible |
| `actor_type` | one of `human, agent, kernel, watchdog, system` |
| `actor_id` | who acted (**non-blank**) |
| `event_type` | what happened (must be a registered type) |
| `object_type`, `object_id` | what it was about |
| `payload` | event-specific JSON, or `null` |
| `previous_hash` | the prior row's `hash` (`null` for the genesis event) |
| `hash` | this row's hash (see below) |
| `trace_id` | optional correlation id (`null` or **non-blank**) |

### Non-blank strings

Every field the contracts describe as required / non-empty means **non-blank**: a string with at least one non-whitespace character. `""`, `" "`, `"\t"`, `"\n"`, and `" \t "` are all rejected — for ids, `actor_id`, `object_type`/`object_id` where required, `trace_id` (when not null), venture references, session ids, non-null `reason`/`rationale`, and every payload id/reference. The validator only *rejects* whitespace-only values; it never trims or normalizes the stored data (the log is immutable). The shared JSON-Schema fragment is `{ type: "string", minLength: 1, pattern: "\\S" }` and the primitive is `isNonBlankString`.

## Hashing and previous-hash linkage

The hash covers the **whole record**, and `previous_hash` is part of the hashed object:

```
hash = sha256( canonicalize({ id, timestamp, actor_type, actor_id, event_type,
                              object_type, object_id, payload, previous_hash, trace_id }) )
```

`canonicalize` is the deterministic key-sorted JSON of [`app/src/lib/eventlog.ts`](../app/src/lib/eventlog.ts), the **single hashing authority**. The verifier does not re-implement SHA-256 or canonicalization — it imports `computeHash`/`canonicalize` from there. Because `previous_hash` is inside the hash, tampering with any field of any row (or rewriting a link) breaks the chain and is detected. This is the integrity layer; the conventions below are a second, independent *contract* layer on top of it — a cryptographically valid event can still violate its convention.

## Naming conventions

Event types are lowercase, dot-namespaced by domain: `user.*`, `role.*`, `auth.*`, `venture.*`, `decision_record.*`, `ratification.*`, `system.*`, and the bare `gate_passed`. A type is stable once shipped — corrections are new events, never a rename of a stored one. Every productive type is declared exactly once in the registry, emitted by exactly one owner module, and listed exactly once in the table below.

## Actor attribution

`actor_type` records the *kind* of actor; `actor_id` records *which* one. In Phase 0 every productive event is `actor_type: human` — the only actors are registered humans acting through opaque sessions. **This is attribution, not a cryptographic identity:** an `actor_id` is a recorded claim bound to a session, not a signed assertion of a personal key. Closing a session never alters a historical event.

## Object binding

`object_type` / `object_id` say what an event is *about*. Most types bind to a fixed object type (a `user`, a `session`, a `venture`, a `decision-record`, a `founding-ratification-pack`, the `system-stop` singleton). Two types bind to a **caller-supplied** object type: `approval.recorded` binds to whatever artifact is approved, and `gate_passed` binds to a `venture` (pipeline gates) or to the authorized subject's type (standing gates). Where the table says an object id is *required*, it must be a non-blank string. The caller-supplied bindings are further pinned by that event's **invariants** (below): a pipeline `gate_passed`'s `object_id` must equal its `payload.venture_id`, a standing gate's `object_type`/`object_id` must equal its `payload.subject_type`/`subject_id`, and a decision-record `approval.recorded` must carry a real content digest.

## Trace IDs

`trace_id` is an optional correlation id: `null`, or a non-blank string linking related events across a workflow. Phase 0 modules do not yet populate it; the convention reserves and validates it (null or non-blank) so a later phase can adopt it without a schema change.

## Timestamp rules

`timestamp` must be a **strict RFC3339 / ISO-8601 instant** with real calendar fields — no silent roll-over (`2026-02-30` is rejected), no ambiguous local dates, and it must resolve to a finite instant. An event with a malformed timestamp is a convention violation even if its hash is valid, and it makes `verify` fail. The extract's `--from` / `--to` bounds are parsed with the same strict rule.

## Corrections are new events, never mutation

The log is append-only at the database layer (`UPDATE`/`DELETE`/`TRUNCATE` are rejected by triggers). A mistake is never edited away; it is corrected by appending a **new** event (the same way a Decision Record is "revised" only by filing an amendment that references the original). The audit trail thus shows both the error and its correction — that history is the point.

## The complete Phase 0 event taxonomy

Every event type emitted by a Phase 0 productive module (issues #7–#12), with its owner, allowed actor types, object binding, payload fields, and its number of cross-field invariants. A `?` marks an **optional** payload field; all others are required. `_null_` means the payload must be null. This is a human summary — the **complete** machine-readable contract (field types, enums, patterns, nullability, and the invariant statements) is in [Full machine-readable contracts](#full-machine-readable-contracts) below. Both are generated from the registry — do not edit by hand; run `pnpm check:audit`.

<!-- AUDIT_CONVENTIONS_TABLE_START -->
| Event type | Issue | Owner module | Actor types | Object (type / id) | Payload fields | Invariants | Description |
|---|---|---|---|---|---|---|---|
| `user.created` | #7 | `app/src/lib/auth.ts` | `human` | `user` / id required | `display_name` | 0 | A user was registered in the projection. |
| `role.granted` | #7 | `app/src/lib/auth.ts` | `human` | `user` / id required | `role` | 0 | A role (operator/approver/viewer) was granted to a user. |
| `role.revoked` | #7 | `app/src/lib/auth.ts` | `human` | `user` / id required | `role` | 0 | An active role grant was revoked from a user. |
| `approval.recorded` | #7 | `app/src/lib/auth.ts` | `human` | _(caller-supplied)_ / id required | `proposer_actor_id`, `object_digest` | 3 | A human approval of an artifact (e.g. a decision-record), bound to the proposer and, for a decision-record, the content digest. Separation: the approver differs from the proposer. |
| `auth.session_started` | #7 | `app/src/lib/auth.ts` | `human` | `session` / id required | _null_ | 0 | A user opened an opaque session (Phase 0 session attribution). |
| `auth.session_ended` | #7 | `app/src/lib/auth.ts` | `human` | `session` / id required | _null_ | 0 | A user closed a session (does not alter historical events). |
| `venture.stage_handoff` | #8 | `app/src/lib/venture.ts` | `human` | `venture` / id required | `from`, `to`, `transition_kind`, `authorization_gate_id`, `authorization_ref` | 0 | The intra-envelope Trend Analysis → Research handoff (Part V Stage 2): no new gate pass, reuses the venture's stored G-01 authorization. |
| `venture.analysis_item_completed` | #8 | `app/src/lib/venture.ts` | `human` | `venture` / id required | `item`, `evidence_ref` | 0 | One of the five stage 5–9 analysis-block items was filed with a non-empty artifact reference. |
| `venture.killed` | #8 | `app/src/lib/venture.ts` | `human` | `venture` / id required | `reason`, `post_mortem_ref` | 0 | A venture was killed to Archived from a non-terminal state, with a mandatory reason and post-mortem reference. |
| `gate_passed` | #9 | `app/src/lib/gates.ts` | `human` | _(caller-supplied)_ / id required | `gate_id`, `gate_name`, `dr_id`, `approval_event_id`, `proposer_actor_id`, `approver_actor_id`, `kill_criteria`, `reversibility_class`, `dr_digest`, `transition_kind`, `from_state`, `to_state`, `venture_id`, `effect`?, `opportunity_ref`?, `subject_type`?, `subject_id`? | 5 | Exactly one authorization event per gate pass. Pipeline gates (G-01..G-06) bind to a venture and carry an effect; standing gates (G-17/G-18) authorize a subject and carry subject_type/subject_id. The event IS the authorization and (for pipeline gates) the venture effect. |
| `decision_record.filed` | #10 | `app/src/lib/dr.ts` | `human` | `decision-record` / id required | `content_digest`, `schema_version`, `amends_dr_id` | 0 | A new immutable Decision Record was filed (amends_dr_id is null). |
| `decision_record.amended` | #10 | `app/src/lib/dr.ts` | `human` | `decision-record` / id required | `content_digest`, `schema_version`, `amends_dr_id` | 0 | An amendment: a new immutable Decision Record that references an existing one via a non-null amends_dr_id. |
| `ratification.signature_recorded` | #11 | `app/src/lib/ratification-core.ts` | `human` | `founding-ratification-pack` / id required | `pack_digest`, `pack_version`, `signer_actor_id`, `signer_capacity`, `acknowledgement_version`, `session_id` | 1 | One required signer's human signature on the Founding Ratification Pack, attributed to an active session (Phase 0 session auth, not a cryptographic key). |
| `system.stop_engaged` | #12 | `app/src/lib/stop.ts` | `human` | `system-stop` / id required | `generation`, `reason`, `session_id` | 0 | The manual emergency stop was engaged (G-00) — the cheapest action: any authorized human, one call, optional reason. |
| `system.stop_released` | #12 | `app/src/lib/stop.ts` | `human` | `system-stop` / id required | `generation`, `rationale`, `session_id`, `released_stop_event_id` | 0 | The stop was released (restart) by an approver with a mandatory non-empty rationale, referencing the released stop event. |
<!-- AUDIT_CONVENTIONS_TABLE_END -->

### Venture references

The extract's `--venture` filter matches an event to a venture through the **declared** binding points only — never a recursive scan of arbitrary payload strings:

- the universal rule: `object_type = 'venture'` with `object_id` equal to the venture id (covers `gate_passed` for pipeline gates and every `venture.*` event); plus
- each convention's declared `ventureReferencePaths`. Today only `gate_passed` declares one — `payload.venture_id` — so a **standing** gate pass that authorizes a subject but concerns a venture is still matched, even though its object is the subject.

A payload string that merely happens to equal a venture id (and is not a declared reference) is **not** treated as a reference, so the extract cannot be fooled into over- or under-matching.

## Full machine-readable contracts

The summary table above is the human quick-reference. This section is the **complete** contract of every event, generated from the registry: each block is the canonical JSON of one convention — its actor types, object binding, the full payload JSON Schema (field types, enums, patterns, nullability, `required`/optional, `additionalProperties`), its declared venture-reference paths, and its cross-field invariants. A single **contracts digest** (SHA-256 over the canonical definitions) pins the whole taxonomy. `pnpm check:audit` compares this entire section to `renderConventionsContracts()`, so changing a field type, an enum, a pattern, a nullability, a required/optional status, a `gate_passed` variant, or an invariant fails CI until this section is regenerated. Do not edit it by hand.

<!-- AUDIT_CONVENTIONS_CONTRACTS_START -->
#### `user.created`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "user.created",
  "invariants": [],
  "issue": 7,
  "objectContract": {
    "objectId": "required",
    "objectType": "user"
  },
  "ownerModule": "app/src/lib/auth.ts",
  "payloadSchema": {
    "additionalProperties": false,
    "properties": {
      "display_name": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      }
    },
    "required": [
      "display_name"
    ],
    "type": "object"
  },
  "ventureReferencePaths": []
}
```

#### `role.granted`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "role.granted",
  "invariants": [],
  "issue": 7,
  "objectContract": {
    "objectId": "required",
    "objectType": "user"
  },
  "ownerModule": "app/src/lib/auth.ts",
  "payloadSchema": {
    "additionalProperties": false,
    "properties": {
      "role": {
        "enum": [
          "operator",
          "approver",
          "viewer"
        ],
        "type": "string"
      }
    },
    "required": [
      "role"
    ],
    "type": "object"
  },
  "ventureReferencePaths": []
}
```

#### `role.revoked`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "role.revoked",
  "invariants": [],
  "issue": 7,
  "objectContract": {
    "objectId": "required",
    "objectType": "user"
  },
  "ownerModule": "app/src/lib/auth.ts",
  "payloadSchema": {
    "additionalProperties": false,
    "properties": {
      "role": {
        "enum": [
          "operator",
          "approver",
          "viewer"
        ],
        "type": "string"
      }
    },
    "required": [
      "role"
    ],
    "type": "object"
  },
  "ventureReferencePaths": []
}
```

#### `approval.recorded`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "approval.recorded",
  "invariants": [
    "actor_id !== payload.proposer_actor_id (approver differs from proposer)",
    "object_type === 'decision-record' ⇒ payload.object_digest is a 64-char lowercase SHA-256 (never null)",
    "object_type !== 'decision-record' ⇒ payload.object_digest is null or a 64-char lowercase SHA-256"
  ],
  "issue": 7,
  "objectContract": {
    "objectId": "required",
    "objectType": "*"
  },
  "ownerModule": "app/src/lib/auth.ts",
  "payloadSchema": {
    "additionalProperties": false,
    "properties": {
      "object_digest": {
        "type": [
          "string",
          "null"
        ]
      },
      "proposer_actor_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      }
    },
    "required": [
      "proposer_actor_id",
      "object_digest"
    ],
    "type": "object"
  },
  "ventureReferencePaths": []
}
```

#### `auth.session_started`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "auth.session_started",
  "invariants": [],
  "issue": 7,
  "objectContract": {
    "objectId": "required",
    "objectType": "session"
  },
  "ownerModule": "app/src/lib/auth.ts",
  "payloadSchema": null,
  "ventureReferencePaths": []
}
```

#### `auth.session_ended`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "auth.session_ended",
  "invariants": [],
  "issue": 7,
  "objectContract": {
    "objectId": "required",
    "objectType": "session"
  },
  "ownerModule": "app/src/lib/auth.ts",
  "payloadSchema": null,
  "ventureReferencePaths": []
}
```

#### `venture.stage_handoff`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "venture.stage_handoff",
  "invariants": [],
  "issue": 8,
  "objectContract": {
    "objectId": "required",
    "objectType": "venture"
  },
  "ownerModule": "app/src/lib/venture.ts",
  "payloadSchema": {
    "additionalProperties": false,
    "properties": {
      "authorization_gate_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "authorization_ref": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "from": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "to": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "transition_kind": {
        "enum": [
          "handoff"
        ],
        "type": "string"
      }
    },
    "required": [
      "from",
      "to",
      "transition_kind",
      "authorization_gate_id",
      "authorization_ref"
    ],
    "type": "object"
  },
  "ventureReferencePaths": []
}
```

#### `venture.analysis_item_completed`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "venture.analysis_item_completed",
  "invariants": [],
  "issue": 8,
  "objectContract": {
    "objectId": "required",
    "objectType": "venture"
  },
  "ownerModule": "app/src/lib/venture.ts",
  "payloadSchema": {
    "additionalProperties": false,
    "properties": {
      "evidence_ref": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "item": {
        "enum": [
          "customer_discovery",
          "competitive_analysis",
          "financial_modeling",
          "risk_analysis",
          "legal_analysis"
        ],
        "type": "string"
      }
    },
    "required": [
      "item",
      "evidence_ref"
    ],
    "type": "object"
  },
  "ventureReferencePaths": []
}
```

#### `venture.killed`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "venture.killed",
  "invariants": [],
  "issue": 8,
  "objectContract": {
    "objectId": "required",
    "objectType": "venture"
  },
  "ownerModule": "app/src/lib/venture.ts",
  "payloadSchema": {
    "additionalProperties": false,
    "properties": {
      "post_mortem_ref": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "reason": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      }
    },
    "required": [
      "reason",
      "post_mortem_ref"
    ],
    "type": "object"
  },
  "ventureReferencePaths": []
}
```

#### `gate_passed`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "gate_passed",
  "invariants": [
    "actor_id === payload.approver_actor_id; payload.proposer_actor_id !== payload.approver_actor_id",
    "G-01: transition_kind='gate_pass', object_type='venture', object_id===payload.venture_id (non-blank), from_state=null, to_state non-blank, effect='venture_created', opportunity_ref non-blank, subject_* absent, kill_criteria array",
    "G-02..G-06: transition_kind='gate_pass', object_type='venture', object_id===payload.venture_id, from_state & to_state non-blank, effect='stage_advanced', opportunity_ref/subject_* absent, kill_criteria array",
    "G-17/G-18: transition_kind='authorization', object_type===payload.subject_type, object_id===payload.subject_id (non-blank), from_state=null, to_state=null, venture_id null|non-blank, effect/opportunity_ref absent, kill_criteria array|null",
    "any other gate_id is rejected (only the Phase 0 implemented gates)"
  ],
  "issue": 9,
  "objectContract": {
    "objectId": "required",
    "objectType": "*"
  },
  "ownerModule": "app/src/lib/gates.ts",
  "payloadSchema": {
    "additionalProperties": false,
    "properties": {
      "approval_event_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "approver_actor_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "dr_digest": {
        "pattern": "^[0-9a-f]{64}$",
        "type": "string"
      },
      "dr_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "effect": {
        "enum": [
          "venture_created",
          "stage_advanced"
        ],
        "type": "string"
      },
      "from_state": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "minLength": 1,
            "pattern": "\\S",
            "type": "string"
          }
        ]
      },
      "gate_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "gate_name": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "kill_criteria": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "items": {
              "type": "string"
            },
            "type": "array"
          }
        ]
      },
      "opportunity_ref": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "proposer_actor_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "reversibility_class": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "subject_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "subject_type": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "to_state": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "minLength": 1,
            "pattern": "\\S",
            "type": "string"
          }
        ]
      },
      "transition_kind": {
        "enum": [
          "gate_pass",
          "authorization"
        ],
        "type": "string"
      },
      "venture_id": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "minLength": 1,
            "pattern": "\\S",
            "type": "string"
          }
        ]
      }
    },
    "required": [
      "gate_id",
      "gate_name",
      "dr_id",
      "approval_event_id",
      "proposer_actor_id",
      "approver_actor_id",
      "kill_criteria",
      "reversibility_class",
      "dr_digest",
      "transition_kind",
      "from_state",
      "to_state",
      "venture_id"
    ],
    "type": "object"
  },
  "ventureReferencePaths": [
    "payload.venture_id"
  ]
}
```

#### `decision_record.filed`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "decision_record.filed",
  "invariants": [],
  "issue": 10,
  "objectContract": {
    "objectId": "required",
    "objectType": "decision-record"
  },
  "ownerModule": "app/src/lib/dr.ts",
  "payloadSchema": {
    "additionalProperties": false,
    "properties": {
      "amends_dr_id": {
        "type": "null"
      },
      "content_digest": {
        "pattern": "^[0-9a-f]{64}$",
        "type": "string"
      },
      "schema_version": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      }
    },
    "required": [
      "content_digest",
      "schema_version",
      "amends_dr_id"
    ],
    "type": "object"
  },
  "ventureReferencePaths": []
}
```

#### `decision_record.amended`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "decision_record.amended",
  "invariants": [],
  "issue": 10,
  "objectContract": {
    "objectId": "required",
    "objectType": "decision-record"
  },
  "ownerModule": "app/src/lib/dr.ts",
  "payloadSchema": {
    "additionalProperties": false,
    "properties": {
      "amends_dr_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "content_digest": {
        "pattern": "^[0-9a-f]{64}$",
        "type": "string"
      },
      "schema_version": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      }
    },
    "required": [
      "content_digest",
      "schema_version",
      "amends_dr_id"
    ],
    "type": "object"
  },
  "ventureReferencePaths": []
}
```

#### `ratification.signature_recorded`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "ratification.signature_recorded",
  "invariants": [
    "actor_id === payload.signer_actor_id"
  ],
  "issue": 11,
  "objectContract": {
    "objectId": "required",
    "objectType": "founding-ratification-pack"
  },
  "ownerModule": "app/src/lib/ratification-core.ts",
  "payloadSchema": {
    "additionalProperties": false,
    "properties": {
      "acknowledgement_version": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "pack_digest": {
        "pattern": "^[0-9a-f]{64}$",
        "type": "string"
      },
      "pack_version": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "session_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "signer_actor_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "signer_capacity": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      }
    },
    "required": [
      "pack_digest",
      "pack_version",
      "signer_actor_id",
      "signer_capacity",
      "acknowledgement_version",
      "session_id"
    ],
    "type": "object"
  },
  "ventureReferencePaths": []
}
```

#### `system.stop_engaged`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "system.stop_engaged",
  "invariants": [],
  "issue": 12,
  "objectContract": {
    "objectId": "required",
    "objectType": "system-stop"
  },
  "ownerModule": "app/src/lib/stop.ts",
  "payloadSchema": {
    "additionalProperties": false,
    "properties": {
      "generation": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "type": "integer"
      },
      "reason": {
        "oneOf": [
          {
            "type": "null"
          },
          {
            "minLength": 1,
            "pattern": "\\S",
            "type": "string"
          }
        ]
      },
      "session_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      }
    },
    "required": [
      "generation",
      "reason",
      "session_id"
    ],
    "type": "object"
  },
  "ventureReferencePaths": []
}
```

#### `system.stop_released`

```json
{
  "allowedActorTypes": [
    "human"
  ],
  "eventType": "system.stop_released",
  "invariants": [],
  "issue": 12,
  "objectContract": {
    "objectId": "required",
    "objectType": "system-stop"
  },
  "ownerModule": "app/src/lib/stop.ts",
  "payloadSchema": {
    "additionalProperties": false,
    "properties": {
      "generation": {
        "maximum": 9007199254740991,
        "minimum": 1,
        "type": "integer"
      },
      "rationale": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "released_stop_event_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      },
      "session_id": {
        "minLength": 1,
        "pattern": "\\S",
        "type": "string"
      }
    },
    "required": [
      "generation",
      "rationale",
      "session_id",
      "released_stop_event_id"
    ],
    "type": "object"
  },
  "ventureReferencePaths": []
}
```

**Contracts digest (SHA-256 of the canonical contract definitions):** `90d19e7cdd4181593bab29eea28d1d49512762e64928bb05399722613487c9ca`
<!-- AUDIT_CONVENTIONS_CONTRACTS_END -->

## Using the CLI

The tool runs from the repo root via `tsx` — no build step:

```bash
# Verify the whole chain and every convention (exit 1 if anything is wrong)
pnpm audit:log -- verify
pnpm verify:events                      # alias of `verify`

# Human audit extract; --from is inclusive, --to is exclusive, both strict RFC3339
pnpm audit:log -- extract --from 2026-01-01T00:00:00Z --to 2026-02-01T00:00:00Z

# Everything for one venture (object-bound events + declared payload references)
pnpm audit:log -- extract --venture V-2026-1

# Combined filters are ANDed; --jsonl emits one JSON object per line instead
pnpm audit:log -- extract --venture V-2026-1 --from 2026-01-01T00:00:00Z
```

`extract` **always verifies the whole chain first** and refuses (exit 1, printing no events) if any part of it is invalid — tampering outside the requested range still blocks the extract, because a partial view over a broken chain is not trustworthy. Output has no ANSI colour and escapes untrusted event text so it cannot forge log lines. The full `DATABASE_URL` (which may embed credentials) is never printed.

**Exit codes:** `0` valid and complete · `1` an integrity or convention violation (or an extract refused because the chain is invalid) · `2` bad arguments, a connection failure, or another operational error. Normal output goes to stdout; diagnostics and errors go to stderr.

## Recommended ARC (audit review) process

At pathfinder scale the "Audit / Portfolio review" (Part XI §3.3) is a lightweight human ritual, not a committee. To avoid oversight theater (§10.3), the review works from the verified log, not from a summary someone typed:

1. Run `pnpm audit:log -- verify` and confirm exit `0`. Record the reported **head hash** and event count.
2. Generate the extract you are reviewing (`--from`/`--to` for the period, and/or `--venture` for a specific venture).
3. Keep the **head hash and the exact filters** with the audit artifact. Anyone can re-run the same commands later and reproduce the identical extract from the identical chain; if the head hash differs, the log changed and the review is stale.

That is the whole discipline: the log verifies, the extract is reproducible, and the head hash pins the state the decision was reviewed against. Phase 0 has no automatic ARC scheduling or random sampling — those are later phases.

## Honest limitations

The verifier detects any tampering with, deletion of, or reordering of an *existing* row, and any event that violates its convention. It does **not**, and Phase 0 does not claim to, detect:

- **A full re-forge by a database superuser.** Someone with DDL access can disable the append-only triggers, rewrite the entire chain tail from a chosen point (recomputing every hash), and re-enable them. The chain would then verify cleanly. Detecting this needs an **external trusted anchor** — periodically publishing the head hash somewhere append-only and outside this database — which is deliberately **not** built in this issue.
- **Tail truncation.** Deleting the most recent rows leaves a shorter but internally consistent chain. Without a trusted external record of the expected head, a missing tail is invisible.
- **Actor identity as cryptography.** `actor_id` is session attribution, not a signature. The log proves *what was recorded*, not that a specific human personally authorized it with a key.

These are properties of the single-Postgres, single-writer Phase 0 design (ADR-002), stated plainly so no one over-trusts the tool.

## Adding an event type without breaking CI

Three edits, kept in lock-step (that lock-step is exactly what `pnpm check:audit` enforces):

1. **Register it** in [`app/src/lib/audit-conventions.ts`](../app/src/lib/audit-conventions.ts): append an `EventConvention` (in issue order) with its owner module, allowed actor types, object contract, and a strict payload schema (`additionalProperties: false`, exact types) or `null`.
2. **Emit it** from exactly one productive owner module — as an `event_type:` literal or a `*_EVENT_TYPE` constant. A registered type with no writer, or a new literal with no registration, fails the check.
3. **Mirror the docs**: regenerate **both** generated regions — the summary table between the `AUDIT_CONVENTIONS_TABLE` markers (so it equals `renderConventionsTable()`) and the full contracts section between the `AUDIT_CONVENTIONS_CONTRACTS` markers (so it equals `renderConventionsContracts()`). The owner-aware AST drift guard also requires your new type to be emitted by exactly one productive module.

Then `pnpm check:audit`, `pnpm test`, and `pnpm audit:log -- verify` must all pass.

## Running it

```bash
pnpm migrate         # no new tables for #13 (read-only tooling over the existing log)
pnpm check:audit     # CI guard: registry ⇄ productive writers ⇄ this doc agree
pnpm audit:log -- verify
pnpm test            # app/test/audit-conventions.test.ts — validator, CLI, tampering, drift
```
