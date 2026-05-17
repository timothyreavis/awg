# AWG V2.4 Multi-Agent Coordination

V2.4 adds local-first coordination primitives so one or more agents can work in the same AWG vault without accidentally duplicating work, overwriting context, or leaving ambiguous handoffs.

The goal is not real-time collaboration. The goal is for agents to declare intent, inspect active work, avoid obvious collisions, and leave durable coordination evidence for the next agent.

## Principles

- Keep coordination append-only and event-backed.
- Treat coordination as soft intent and visibility, not a hard lock.
- Build on runs, run attribution, work queues, maintenance inbox, topology, handoff, and diagnostics.
- Prefer warnings, queue demotion, and preflight surfacing over write blocking.
- Keep all coordination local to the current vault unless the user explicitly switches into another vault.
- Preserve backwards compatibility with older logs and vaults that have no coordination events.
- Keep CLI and JSON stable enough for agents.
- Do not add daemon behavior, live sync, hosted collaboration, background scheduling, external task manager sync, multi-user permissions, vector search, LLM calls, or network calls.

## Non-Goals

- No hard file or graph locks.
- No server, daemon, websocket, or real-time presence.
- No hosted sync or multi-user auth.
- No automatic command execution.
- No external GitHub, Linear, Todoist, Slack, or calendar integration.
- No cross-vault writes from the current vault.
- No automatic conflict resolution.
- No ownership model that prevents the human or another agent from acting.

## Coordination Model

V2.4 should add a derived coordination index:

- `graph.coordination_index`
- `.awg/compiled/indexes/coordination.json`

Coordination source records are canonical `kind: "event"` entries. They should not be stored in a side database, and compiled coordination artifacts should never be treated as source.

Recommended event shape:

```json
{
  "awg": "0.1",
  "kind": "event",
  "type": "coordination.claimed",
  "id": "ev:...",
  "runId": "run:...",
  "agent": "codex",
  "coordinationId": "coord:...",
  "targetKind": "node",
  "targetIds": ["n:..."],
  "queueItemId": "wq:next:...",
  "mode": "exclusive",
  "summary": "Implement the queue-backed coordination slice.",
  "reason": "Avoid duplicate implementation work.",
  "expires_at": "2026-05-18T00:00:00.000Z",
  "created_at": "2026-05-17T00:00:00.000Z"
}
```

Release, handoff, and acknowledgement events:

```json
{
  "kind": "event",
  "type": "coordination.released",
  "coordinationId": "coord:...",
  "runId": "run:...",
  "status": "completed",
  "summary": "Finished and recorded evidence."
}
```

```json
{
  "kind": "event",
  "type": "coordination.handoff",
  "coordinationId": "coord:...",
  "runId": "run:...",
  "toAgent": "codex",
  "toRole": "reviewer",
  "summary": "Review the implementation for queue collision handling.",
  "targetIds": ["n:..."]
}
```

```json
{
  "kind": "event",
  "type": "coordination.collision_acknowledged",
  "coordinationId": "coord:...",
  "runId": "run:...",
  "reason": "Two agents are intentionally reviewing the same implementation from different angles."
}
```

Unknown fields on coordination events must be preserved and tolerated.

## Work Claims

Use the term `work claim` for coordination. This is distinct from V2.2 semantic claim nodes and claim/evidence trust status.

A work claim means: an agent intends to work on a target and asks other agents to avoid duplicating or colliding with that work.

Work claims are advisory:

- They do not block writes.
- They do not grant ownership.
- They do not prevent the human from redirecting work.
- They do not silently mutate task status.
- They should be visible in queue, handoff, lens, doctor, preflight, and viewer surfaces.

Claim modes:

- `exclusive`: one agent/run should work the target at a time.
- `shared`: parallel review or research is expected and should not conflict with other shared claims.
- `watch`: the agent is monitoring or reviewing the target but not claiming implementation ownership.

Conflict rules:

- Active `exclusive` claims conflict with any other active claim on an overlapping target unless they belong to the same run.
- Active `shared` claims do not conflict with other `shared` claims.
- Active `watch` claims do not conflict, but they should be shown as presence/context.
- Claims on queue items inherit the queue item's `nodeIds`, `runIds`, `claimIds`, `evidenceIds`, `vaultIds`, and `relationshipIds` for overlap detection.
- Claims on missing targets produce diagnostics but should not break compilation.

## Coordination Index

Suggested shape:

```json
{
  "awg": "0.1",
  "kind": "coordination-index",
  "generated_at": "2026-05-17T00:00:00.000Z",
  "claims": [],
  "collisions": [],
  "handoffs": [],
  "summary": {
    "activeClaims": 0,
    "staleClaims": 0,
    "collisions": 0,
    "handoffs": 0,
    "claimedQueueItems": 0,
    "claimedNodes": 0
  }
}
```

Claim records should include:

- `id`
- `status`: `active`, `released`, `completed`, `abandoned`, `blocked`, or `stale`.
- `mode`: `exclusive`, `shared`, or `watch`.
- `agent`
- `runId`
- `targetKind`
- `targetIds`
- `queueItemId`
- `nodeIds`
- `runIds`
- `claimIds`
- `evidenceIds`
- `vaultIds`
- `relationshipIds`
- `summary`
- `reason`
- `createdAt`
- `updatedAt`
- `expiresAt`
- `releasedAt`
- `releaseStatus`
- `handoffIds`
- `collisionIds`
- `suggestedCommands`

Collision records should include:

- `id`
- `claimIds`
- `nodeIds`
- `queueItemIds`
- `runIds`
- `agents`
- `severity`
- `message`
- `acknowledged`
- `acknowledgedByRunId`
- `suggestedCommands`

Claim ids must be deterministic after append. Recommended: `coord:<16-hex>` from the first claim event id plus normalized target ids. Collision ids should be deterministic from sorted active claim ids and sorted overlapping target ids.

Timestamp rules:

- Use source event timestamps, run timestamps, and release/handoff event timestamps.
- Treat `expires_at` as source data written at claim time.
- A claim is stale when `expires_at` is earlier than the compiled graph `generated_at`, or when its owning run is finished and no release event exists.
- Do not call wall-clock time during compilation except through existing compiled graph timestamp conventions.

## CLI Contract

Add a small `coord` command namespace:

- `awg coord status [--json]`
- `awg coord claim <target> [--mode exclusive|shared|watch] [--summary <text>] [--reason <text>] [--ttl-hours <n>] [--run <run-id>|--no-run] [--json]`
- `awg coord release <coordination-id> --status completed|released|abandoned|blocked [--summary <text>] [--run <run-id>|--no-run] [--json]`
- `awg coord check [--target <id>] [--queue-item <id>] [--json]`
- `awg coord handoff <coordination-id> [--to-agent <name>] [--to-role <role>] --summary <text> [--run <run-id>|--no-run] [--json]`

Target parsing:

- `n:*` targets a node.
- `wq:*` targets a work queue item and expands overlap fields from `graph.work_queue_index`.
- `run:*` targets a run.
- `vault:*` targets a registered related vault reference, but still writes only to the current vault.

CLI behavior:

- All commands must support parseable `--json` output.
- `coord status`, `coord check`, and generated coordination views are read-only.
- `coord claim`, `coord release`, and `coord handoff` append normal events.
- Claiming an already-claimed target should warn but still allow the claim when explicit, because coordination is advisory.
- Claiming without an active run is allowed only if `--run` is provided or if the implementation deliberately supports unattributed coordination; prefer warning over failure unless strict mode already exists.
- `--ttl-hours` should write a concrete `expires_at` timestamp at append time. Default TTL should be conservative, such as 24 hours, and documented.
- `--no-run` should be available for deliberate unattributed coordination, but generated instructions should discourage it.

Example JSON for `coord check`:

```json
{
  "ok": true,
  "target": "n:...",
  "available": false,
  "warnings": [
    {
      "code": "AWG_COORDINATION_ACTIVE_CLAIM",
      "severity": "warning",
      "message": "Another active run has an exclusive work claim on this node.",
      "claimIds": ["coord:..."],
      "runIds": ["run:..."],
      "suggestedCommands": ["awg coord status --json"]
    }
  ]
}
```

## Queue Integration

V2.4 should integrate coordination into V2.3 queues without making queues mutable.

Required behavior:

- Queue items should include compact coordination state when their source ids overlap active claims.
- `queue next` should avoid active exclusive claims owned by other active runs by default.
- Add `--include-claimed` to show claimed items.
- Add `--mine` to show items claimed by the active/current run when available.
- `queue show` should include related coordination claims, collisions, and handoffs.
- Claimed-but-stale queue items should appear in `handoff_followup` or `maintenance`.
- Colliding queue items should appear in `human_review` and `risk_review`.

Do not append queue records. Coordination remains event-backed, and queue availability is derived.

## Runs, Handoff, And Preflight

Run integration:

- `run status --json` should show active claims for the active run.
- `run list --json` may include compact claim counts.
- `run finish` preflight should warn about unreleased active claims for the finishing run.
- `run finish --status completed` should make unreleased claims harder to ignore than partial/blocked/failed/abandoned runs, consistent with existing preflight behavior.
- Do not block finish forever. Use `--force` consistently if unresolved warnings require it.

Handoff integration:

- `awg handoff` should include active claims, stale claims, collisions, and coordination handoffs relevant to the active or most recent run.
- `handoff --compact` should mention only the highest priority coordination issues.
- `handoff --json` should include coordination sections without dumping the whole graph.

Preflight warnings:

- active claim left unreleased.
- active claim has unresolved collision.
- touched node is claimed by another active run.
- queue item claimed during the run still has no evidence or release.
- stale claim owned by the current run.
- coordination handoff recorded but target is missing or ambiguous.

## Diagnostics And Doctor

Add diagnostics:

- `AWG_COORDINATION_ACTIVE_COLLISION`
- `AWG_COORDINATION_STALE_CLAIM`
- `AWG_COORDINATION_FINISHED_RUN_UNRELEASED_CLAIM`
- `AWG_COORDINATION_MISSING_TARGET`
- `AWG_COORDINATION_HANDOFF_MISSING_TARGET`
- `AWG_COORDINATION_INVALID_EVENT`

Doctor fix suggestions must be conservative:

- inspect claim: `awg coord status --json`
- inspect target: `awg node show n:... --json`
- release claim: `awg coord release coord:... --status released --summary "..."`
- mark abandoned: `awg coord release coord:... --status abandoned --summary "..."`
- acknowledge intentional collision: `awg coord handoff coord:... --to-role reviewer --summary "..."`

Doctor must not suggest destructive commands, log rewrites, or automatic conflict resolution.

## Lenses

Add configurable lens source `"coordination"`.

Supported query keys:

- `status`
- `mode`
- `agent`
- `runId`
- `targetId`
- `targetIds`
- `queueItemId`
- `hasCollision`
- `stale`
- `limit`

Built-in lenses:

- `lens resume` should include compact active claims and collisions.
- `lens task --goal ...` should include coordination state for matched nodes, queue items, and related runs.
- Existing lens sources must continue to work.

## Viewer Surface

Add a minimal read-only `#/coordination` route if it fits the current viewer architecture.

The route should show:

- active claims.
- stale claims.
- collisions.
- handoffs.
- claimed queue items.
- run and node links.
- suggested next commands.

Also add lightweight coordination indicators on `#/queues`, `#/overview`, and node detail if low-risk. The viewer must not write back, poll, sync, or execute commands.

## Agent Guidance

Generated instructions should teach agents:

- Before picking undirected queue work, run `awg queue next --json` and `awg coord status --json`.
- Before touching a node surfaced as claimed, run `awg coord check --target <id> --json`.
- Use `awg coord claim` for non-trivial implementation work when another agent could plausibly collide.
- Use `shared` or `watch` for review/research lanes.
- Release claims before finishing the run.
- Record a coordination handoff when intentionally passing work to another agent or reviewer.
- Claims are advisory; human direction overrides them.
- Do not use coordination as a permission system or a substitute for evidence.

## Tests Required

- Older vaults without coordination events compile.
- Coordination event unknown fields are tolerated.
- `coord claim` appends an event with active run attribution.
- `coord release` marks the derived claim released/completed/abandoned/blocked.
- `coord check` reports active exclusive claims.
- Shared claims do not collide with shared claims.
- Exclusive claims collide with overlapping active claims from other runs.
- Claims on queue items expand queue source ids for overlap detection.
- Stale claims derive deterministically from `expires_at` and compiled graph time.
- Finished runs with unreleased claims warn in doctor/preflight.
- Missing claim targets warn without crashing.
- `queue next` excludes other-run active exclusive claims by default.
- `queue next --include-claimed` includes claimed work.
- `queue next --mine` includes work claimed by the active run.
- `queue show` includes related coordination data.
- `handoff`, `handoff --compact`, and `handoff --json` include compact coordination context.
- `lens resume` and `lens task` include relevant coordination context.
- configurable lens source `coordination` works.
- viewer `#/coordination` handles missing coordination data without crashing.
- `doctor --fix-suggestions --json` returns conservative coordination suggestions.
- `run finish --status completed` surfaces unreleased claims and collisions.
- `--force` finish records unresolved coordination warnings when applicable.
- Full verification: `npm run typecheck`, `npm test`, `awg build --json`, `awg doctor --fix-suggestions --json`, fresh temp-vault smoke, `npm pack --dry-run --json`, and `git diff --check`.

## Fresh Temp-Vault Smoke

Use an isolated temp `HOME` and temp project vault.

Suggested smoke:

- `awg init`
- create two task nodes and one risk node.
- start run A and claim task A.
- verify `coord status --json` shows the active claim.
- verify `queue next --json` excludes task A for another run by default.
- start run B and run `coord check --target <task A> --json`.
- create a shared review claim and verify no collision with another shared claim.
- create an exclusive overlapping claim and verify collision diagnostics.
- release one claim.
- build and doctor.
- verify handoff/lens/queue show include coordination context.
- finish runs with and without unreleased claims to verify preflight behavior.

## Definition Of Done

AWG can deterministically show who or what run is actively working on which nodes or queue items, where work claims overlap, which claims are stale, which handoffs need follow-up, and what another agent should avoid or inspect before acting. Coordination remains local-first, append-only, advisory, and compatible with older AWG vaults.
