# G-00 — Manual Emergency Stop

Phase 0 issue [#12](https://github.com/celestinojbm/EvolveOS/issues/12) (P0-11). The v1 mechanism for the constitutional **G-00 Emergency Stop** (Appendix C) at pathfinder scale: a manual stop flag that any authorized human can engage in one call, that halts every gate-pass path and the agent-invocation boundary while set, and that only an approver can release — with a logged rationale. No Watchdogs, no auto-stop, no auto-restart (that machinery is deferred; see `BUILDABILITY_AUDIT.md` §6(g)).

The single owner is [`app/src/lib/stop.ts`](../app/src/lib/stop.ts); [`ops/check-stop-writer.mjs`](../ops/check-stop-writer.mjs) forbids any other production file from writing the state, emitting its events, defining a second guard, or reading a stop override from the environment.

## Stop asymmetry (Appendix C)

Stopping must always be **cheaper** than starting. That asymmetry is the whole design:

| | Stop (`engageSystemStop`) | Restart (`releaseSystemStop`) |
|---|---|---|
| Who | any **authorized human** | an authorized human with the **`approver`** role |
| Cost | one call, **optional reason** | one call, **mandatory non-empty rationale** |
| Requires | — no Decision Record, no prior approval, no quorum, no ratification, no `real_money` | the owning-gate approver role + rationale, recorded |
| Same person? | n/a | need **not** be the human who stopped |
| Automatic? | never | never |

An **authorized human** at Phase 0 = a registered user with an active session they own and **at least one** active role (`operator` / `approver` / `viewer`). This is session attribution, not a cryptographic signature — an opaque, registered session, no IdP. Closing the session afterwards does not alter the historical event.

## State model

A singleton projection `system_stop_state` (migration `0007_system_stop.sql`) plus the append-only event history:

- A **fresh database starts RUNNING at generation 0** with **no fabricated event** — the genesis row carries no event and no actor. Only real transitions (generation ≥ 1) reference an event and a human actor.
- `is_stopped`, a monotonic `generation` (bumped on each effective stop/restart), the `current_event_id` (FK to `events`), the human `actor_id`, an optional `reason` (or the mandatory restart rationale), and `updated_at`.
- A coherence CHECK makes incoherent states unrepresentable: genesis running (gen 0, no event/actor/reason); stopped (gen ≥ 1, event + actor, reason optional); restarted running (gen ≥ 1, event + actor, **non-empty rationale**). The PK is a constant `TRUE`, so a second row is impossible. The projection is mutable, but the full history lives in `events`.

## Events

Two stable, documented event types, each `actor_type: "human"`, `object_type: "system-stop"`, `object_id: "system"`:

- `system.stop_engaged` — payload `{ generation, reason (nullable), session_id }`.
- `system.stop_released` — payload `{ generation, rationale, session_id, released_stop_event_id }`.

The event and the projection change in the **same transaction** (via `appendEventTx`); a failure in either rolls back both.

## Concurrency & idempotence

Every mutation runs `BEGIN → acquireEventChainLock (advisory lock FIRST) → validate user/session/role → read state → event + projection → COMMIT`. The event-chain advisory lock is the one every audited mutation takes, so stops, restarts, gate passes, and agent invocations are **totally ordered**.

- **Stop when already stopped** is idempotent: no new event, no generation bump, returns the current stop.
- **Restart when already running** is rejected with a specific error — no event, no generation change.
- Two concurrent stops → exactly one event. Two concurrent restarts → exactly one effective release. Stop vs gate/invocation → totally ordered: if the stop wins the lock, the queued gate/invocation refuses; if the gate/invocation wins, it completes coherently and the stop lands immediately after, so the next operation refuses.

## Enforcement

- **Gates.** A single central guard — `assertSystemRunning` called inside `gates.ts`'s `runGateTx`, right after the advisory lock and before any DR load, event, or projection — covers **every** public route (`passG01CreateVenture`, `passPipelineGate`, `passStandingGate`, `passGate`). While stopped: zero `gate_passed` events, zero transitions, zero new ventures, zero partial effects. There is no second, independent check to drift.
- **Agent invocation.** Phase 0 has **no productive agent runtime**. `assertAgentInvocationAllowed` is the canonical boundary every future invocation MUST pass **before** resolving credentials, calling a model, or executing a tool. `runGuardedAgentInvocation(client, fn)` checks the boundary first and only runs `fn` (a local callback — no credentials, no model calls) when the system is running. The tests use a fake callback and prove it never runs while stopped. `check-stop-writer` prevents a second agent-invocation boundary from being defined outside `stop.ts`.

## Fail closed

`assertSystemRunning` and `assertAgentInvocationAllowed` permit **only** when the projection exists and says `running`. They throw a specific `SystemStoppedError` when stopped and `StopStateCorruptError` when the row is missing/duplicated. They never convert an SQL error, a missing row, or corruption into permission, never auto-repair the state, and never restart. Distinguishable errors: `SystemStoppedError`, `StopStateCorruptError`, `UnauthorizedStopActorError`, `RestartRequiresApproverError`, `RestartRationaleRequiredError`.

## G-00 vs `real_money`

They are orthogonal safety mechanisms:

- **`real_money`** ([RATIFICATION](RATIFICATION.md)) gates whether money may **ever** move — it is `false` until the Founding Ratification Pack is signed, and even `true` executes no spend (`THR-SPEND-EXEC = 0`).
- **G-00** halts activity **right now** regardless of ratification. The stop works while the pack is unratified and `real_money` is `false`; it is not a financial control, it is an operational halt.

## What this issue does NOT build

No real agents, external credentials, workers, queues, payments, spend execution, threshold changes, Ratification-Pack changes, auto-stop, watchdog, automatic restart, or dashboard/UI. Those remain out of scope (some are later phases). This issue delivers only: engage the manual stop, query the state, block gates and the agent-invocation boundary while stopped, restart via an approver with a rationale, and record stop/restart as events.

## Running it

```bash
pnpm migrate         # applies 0007_system_stop.sql (genesis = running)
pnpm check:stop      # CI guard: only stop.ts owns the stop mechanism
pnpm test            # app/test/stop.test.ts — authorization, atomicity, gates, boundary, races
```
