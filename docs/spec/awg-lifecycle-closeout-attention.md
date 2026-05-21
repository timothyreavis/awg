# AWG V2.4.2 Lifecycle Closeout And Attention Hygiene

V2.4.2 should fix a dogfood problem that becomes serious in long-lived vaults: old tasks, risks, decisions, planning nodes, and review items can remain `active`, `in_progress`, or `needs_review` long after the underlying work finished. Those stale open statuses then pollute current focus, queues, handoff, lenses, and the viewer.

The goal is not to make agents spend every run doing broad cleanup. The goal is to give AWG a deterministic attention layer and low-ceremony closeout primitives so agents can keep current work current, carry forward intentional open items without hiding them, and stop old historical work from looking like today's priority.

## Problem

AWG already has durable nodes, run attribution, maintenance inbox, work queues, coordination, template guidance, freshness metadata, and preflight warnings. The gap is that a node lifecycle status is currently doing too much:

- A task may be `active` because it is truly current work.
- A roadmap/spec task may be `active` because it is a long-lived parent.
- A risk may be `active` because it is still material.
- A risk may be `active` because nobody closed or acknowledged it after mitigation.
- A `needs_review` node may need immediate human review.
- A `needs_review` node may be an intentionally carried-forward question.
- An old completed implementation may have evidence, but its planning task can still appear as active because no agent updated the status.

That makes agents distrust `current focus` and `queue next`, and it creates token waste because every handoff repeats historical backlog.

## Principles

- Keep canonical history append-only.
- Do not make work queues mutable source of truth.
- Separate durable lifecycle status from derived attention state.
- Prefer conservative suggestions over automatic cleanup.
- Make closeout easy for touched work and bounded maintenance sweeps.
- Keep status vocabulary small; do not solve this by adding many new statuses.
- Preserve backwards compatibility with older vaults that have no acknowledgements or attention data.
- Keep current focus compact, recent, and goal-sensitive.
- Keep maintenance debt visible without making every old open item look urgent.
- Make all JSON stable enough for agents.
- Keep everything local, deterministic, and offline.

## Non-Goals

- No daemon, scheduler, hosted sync, MCP server, network call, LLM call, vector search, or external task manager sync.
- No hard locks, permission model, or multi-user auth.
- No destructive deletion, squashing, or hidden mutation of old nodes.
- No broad automatic bulk closeout.
- No command that silently marks many nodes complete.
- No domain-specific status model.
- No requirement that every run clean the whole vault before finishing.

## Target Outcome

After V2.4.2, AWG can answer:

- Which open nodes are genuinely current?
- Which open nodes are stale open items?
- Which nodes are closeout candidates because evidence, runs, or relationships imply the work finished?
- Which open risks/blockers/questions are intentionally carried forward, until when, and why?
- Which queue items belong in `next` versus maintenance/human review?
- Which touched nodes should an agent close, acknowledge, or explicitly carry forward before finishing?

The important behavioral change is that `active` and `needs_review` are no longer sufficient by themselves to promote a node into current focus forever.

## Terminology

- **Lifecycle status**: the node's durable `status`, such as `active`, `in_progress`, `needs_review`, `blocked`, `completed`, `resolved`, `archived`, or `proposed`.
- **Attention state**: a derived classification that says how strongly the node should surface now.
- **Current focus**: compact, high-signal work that is recent, claimed, run-touched, explicitly marked current, or goal-matched at runtime.
- **Closeout candidate**: an open-looking node that likely should be marked complete, resolved, archived, superseded, or intentionally carried forward.
- **Acknowledgement**: an append-only record saying an open item was reviewed and deliberately carried forward until a review date or until the node changes.
- **Sweep**: a bounded read-only scan for stale open items, closeout candidates, and attention debt.

## Attention Index

Add a derived attention index:

- `graph.attention_index`
- `.awg/compiled/indexes/attention.json`

The index is compiled from canonical logs, compiled graph state, runs, maintenance inbox, coordination, claims/evidence, diagnostics, topology, and existing reconciliation relationships. It must not depend on work queues for its base state, because work queues should consume attention. The index must never be edited directly.

Compiler order must stay acyclic:

1. Derive nodes, edges, responses, views, runs, claims/evidence, diagnostics, topology, maintenance inbox, operating templates, and coordination.
2. Derive base attention from those sources.
3. Derive work queues from base attention plus the existing queue sources.
4. Optionally decorate attention read output with related queue item ids, but those ids must not affect attention ids, base attention state, or base score.

Persisted build output uses the graph's deterministic `generated_at` as `asOf`. Live read commands may compute a runtime projection with wall-clock `nowIso()` for due dates, coordination staleness, and review windows, but they must label that projection with `asOf` and must not write live projection data back to canonical logs or compiled files.

Suggested shape:

```json
{
  "awg": "0.1",
  "kind": "attention-index",
  "generated_at": "2026-05-21T00:00:00.000Z",
  "asOf": "2026-05-21T00:00:00.000Z",
  "items": [],
  "summary": {
    "total": 0,
    "current": 0,
    "open": 0,
    "staleOpen": 0,
    "closeoutCandidates": 0,
    "acknowledgedOpen": 0,
    "historical": 0
  }
}
```

Each attention item should include:

- `id`: deterministic `att:<hash>` id.
- `nodeId`
- `nodeType`
- `nodeStatus`
- `baseAttentionState`: `current`, `open`, `stale_open`, `closeout_candidate`, `acknowledged_open`, or `historical`.
- `baseFocusScore`: integer `0-100`.
- `scoreBreakdown`: deterministic reasons and numeric adjustments used to compute `baseFocusScore`.
- `queueWeight`: integer adjustment usable by work queues.
- `ageDays`
- `updatedAgeDays`
- `nodeRevision` or `nodeUpdatedAt` suitable for stale-read guards.
- `lastTouchedRunIds`
- `recentRunIds`
- `activeCoordinationClaimIds`
- `evidenceIds`
- `diagnosticIds`
- `inboxItemIds`
- `workQueueItemIds`
- `acknowledgementId`
- `acknowledgedUntil`
- `acknowledgementStale`
- `acknowledgedNodeRevision` or `acknowledgedNodeUpdatedAt`
- `acknowledgedMaterialKeys`
- `closeoutReasons`
- `staleReasons`
- `suggestedCommands`
- `needsHumanReview`
- `autonomousSafe`
- `createdAt`
- `updatedAt`

Ids should be deterministic. Use the node id plus the attention source codes and sorted source ids. Do not include unstable wall-clock values in ids.

## Attention States

Use these base derived states:

- `current`: should appear in base current focus because it is active in the current run, recently touched, actively coordinated, explicitly marked current/focus on the node, or urgent due to diagnostics/risks/blockers. Goal matching and queue membership are runtime overlays, not base compiled state.
- `open`: still open but not urgent enough to dominate current focus.
- `stale_open`: open for too long, past review date, or not touched recently.
- `closeout_candidate`: likely ready to close, resolve, archive, supersede, or acknowledge.
- `acknowledged_open`: explicitly reviewed and carried forward until a review date or node change.
- `historical`: completed/resolved/archived/superseded or otherwise not a live attention item.

`baseAttentionState` is not a new canonical node status. It is a derived retrieval and maintenance classification. Runtime commands may add `effectiveAttentionState`, `effectiveFocusScore`, `goalMatched`, `goalBoost`, and `runtimeScoreBreakdown` for a specific `--goal`, run, lens, or live `asOf` value, but those runtime overlays must not be persisted as compiled base state.

## Current Focus Scoring

The scoring model should be simple and explainable. Suggested compiled base signals:

- `+45` active run touched the node.
- `+40` active coordination claim overlaps the node.
- `+30` active blocker affecting an active run or current coordination target.
- `+25` high-severity diagnostic affecting an active run or current coordination target.
- `+20` active risk affecting an active run or current coordination target.
- `+15` recent run touched the node.
- `+10` node has explicit current/focus tag or field if the existing model supports it.
- `-20` stale open with no recent run or claim.
- `-30` acknowledged open until a future review date.
- `-40` completed/resolved/archived/superseded.
- `-50` closeout candidate not related to an active run or active coordination claim.

Runtime `--goal` or lens-query matching should be applied after loading the compiled index:

- `+35` exact or strong goal match on title/summary/tags/anchors.
- `+20` body/field match when budget allows and the body match is relevant.
- `+15` goal-matched related node or edge.

Clamp scores to `0-100`. Sort current focus by effective score descending when a runtime overlay exists, otherwise by base score descending, then priority/severity, then updated timestamp, then id.

The exact weights may be adjusted during implementation, but the final method must be deterministic and documented.

## Closeout Candidate Detection

The compiler should conservatively identify closeout candidates. Examples:

- Active or in-progress task has completed implementation evidence linked to it.
- Active or in-progress task was completed by a run summary but status remains open.
- Active roadmap parent has explicit closeout evidence or an explicit resolver edge. Completed child implementation nodes alone should route parent/roadmap/process/standard nodes to `acknowledge_or_schedule_review` or human review, not automatic completion.
- Risk has mitigation evidence or a completed resolver but remains `active`.
- Blocker has a completed/resolved `resolved_by` target but remains active.
- Question has an answer response but remains `needs_review` or active.
- Proposed decision has implemented/completed linked work but remains proposed.
- Node is superseded by or duplicate of another node but remains active/current.
- Node is older than the configured open-age threshold and has no active run, claim, review date, explicit acknowledgement, or lifecycle policy that marks it as evergreen/recurring/manual-closeout.
- A prior acknowledgement is stale because the review date passed or a material watched key changed after acknowledgement.

Candidate detection should be conservative. If AWG cannot infer the right final state, it should suggest inspection or acknowledgement rather than completion.

Long-lived nodes need special care. Nodes with a type, tag, field, or template rule indicating `evergreen`, `recurring`, `parent`, `roadmap`, `process`, `standard`, `policy`, or `manual_closeout` should not be suggested as completed from age or child-completion alone. They may still be stale, due for review, or candidates for acknowledgement.

## Acknowledgement Model

V2.4.2 should generalize the existing `reconcile intentionally-open` concept.

Recommended canonical event:

```json
{
  "awg": "0.1",
  "kind": "event",
  "type": "node.acknowledged",
  "id": "ev:...",
  "target": "n:...",
  "at": "2026-05-21T00:00:00.000Z",
  "by": "agent:codex",
  "run": "run:...",
  "runId": "run:...",
  "scope": "focus",
  "reason": "This risk remains intentionally open until the V2 viewer pilot.",
  "review_after": "2026-06-15T00:00:00.000Z",
  "acknowledgedNodeUpdatedAt": "2026-05-20T00:00:00.000Z",
  "acknowledgedMaterialKeys": ["status", "summary", "body", "fields", "freshness", "edges"]
}
```

Rules:

- Acknowledgements must be append-only events, not side-table rows.
- Event timestamps should follow normal AWG event conventions: use `at`, `by`, `run`, and `runId` when available. Readers may tolerate legacy `created_at` fields as compatibility input, but new writes should use the current event shape.
- Unknown event fields must be preserved.
- The latest valid acknowledgement controls suppression until `review_after`.
- `review_after` should be materialized on write. If the user omits it, use the configured/default review window and include a warning in command output.
- Acknowledgements should record the acknowledged node revision or `updated_at` plus the material keys watched by the acknowledgement.
- An acknowledgement becomes stale when `review_after` passes or a material watched key changes after acknowledgement. Trivial unrelated metadata changes should not always resurface the item.
- Acknowledgement does not make the node complete, resolved, or hidden.
- Acknowledged open items remain visible in maintenance, node detail, and JSON, but should be demoted from current focus until due.
- `reconcile intentionally-open` must remain compatible. Existing `intentionally_open` edges should be adapted into acknowledgement-like derived records with `source: "legacy_intentionally_open"`, no false completion, and conservative `acknowledgedUntil` behavior. If the edge has no review date, treat it as acknowledged but due for scheduled review instead of silently hiding it forever.

## CLI Contract

Add a small closeout/attention surface.

All read commands should apply filters before ranking and limits:

1. Scope filters such as `--run`, `--goal`, `--older-than`, queue, type, or status.
2. Runtime scoring overlays such as `goalBoost`.
3. Deterministic sort.
4. Limit and truncation metadata.

All JSON command output should include:

- `ok`
- `generated_at` when compiled graph data is used.
- `asOf` for the base or live projection.
- `warnings`
- stable ids for nodes/events/candidates where applicable.

Errors should use stable JSON when `--json` is present:

```json
{
  "ok": false,
  "code": "AWG_CLOSEOUT_STALE_TARGET",
  "message": "The node changed since this candidate was generated.",
  "nodeId": "n:...",
  "suggestedCommands": ["awg node show n:... --json"]
}
```

### `awg closeout candidates`

```sh
awg closeout candidates [--run <run-id|current>] [--goal "<goal>"] [--older-than <duration>] [--limit <n>] [--json]
```

Behavior:

- Read-only.
- Returns closeout candidates from the attention index.
- With `--run`, prioritize nodes touched by that run.
- With `--goal`, prioritize goal-matched nodes.
- With `--older-than`, filter stale open candidates by age or updated age.
- Text output should be compact and grouped by suggested disposition.
- JSON output should include stable candidate records and suggested commands.

Candidate JSON shape:

```json
{
  "ok": true,
  "candidates": [
    {
      "id": "att:...",
      "nodeId": "n:...",
      "title": "Old active task",
      "nodeType": "task",
      "nodeStatus": "active",
      "baseAttentionState": "closeout_candidate",
      "baseFocusScore": 42,
      "effectiveFocusScore": 77,
      "goalMatched": true,
      "nodeUpdatedAt": "2026-05-20T00:00:00.000Z",
      "suggestedDisposition": "completed",
      "confidence": "medium",
      "reasons": ["linked evidence exists", "completed run touched node"],
      "suggestedCommands": [
        "awg node show n:... --json",
        "awg closeout mark n:... --status completed --reason \"...\" --expect-updated-at 2026-05-20T00:00:00.000Z --json"
      ],
      "needsHumanReview": false
    }
  ]
}
```

### `awg closeout run`

```sh
awg closeout run [--run <run-id|current>] [--limit <n>] [--category-limit <n>] [--json]
```

Behavior:

- Read-only.
- Focuses on nodes touched by a run.
- Intended for finish preflight and end-of-run cleanup.
- Reports touched open tasks, risks, blockers, questions, decisions, missing evidence, unreleased coordination, stale acknowledgements, and closeout candidates.
- Should not scan the whole vault by default.
- Should default to compact category caps and include `truncated` counts in JSON/text when more results exist.
- JSON should include `ok`, `runId`, `generated_at`, `asOf`, `summary`, `categories`, `warnings`, `truncated`, and `suggestedCommands`.

### `awg closeout mark`

```sh
awg closeout mark <node-id> --status <completed|resolved|archived|superseded|needs_review> --reason <text> [--target <node-id>] [--rel <implements|verified_by|supports|resolved_by|superseded_by>] [--expect-updated-at <iso>] [--force] [--run <run-id>|--no-run] [--json]
```

Behavior:

- Mutating and append-only.
- Should be implemented as a wrapper around the existing `update node` path wherever possible so normal node snapshot/upsert behavior, run attribution, unknown-field preservation, and run summaries keep working.
- Appends a normal node update event through the existing update path.
- Appends a closeout event if compatible with existing event conventions.
- When `--target` is provided:
  - `--status superseded` should add `superseded_by`.
  - `--status resolved` should add `resolved_by`.
  - `--status completed` must require an explicit `--rel implements|verified_by|supports` if an edge should be created.
  - If `--target` is provided with an incompatible or missing relation, fail clearly instead of guessing.
- Does not delete or merge nodes.
- Does not bulk-apply candidates.
- Requires a non-empty reason.
- Uses run attribution by default.
- Should compare `--expect-updated-at` or equivalent candidate snapshot metadata to the current node. If the node changed, fail or warn with `AWG_CLOSEOUT_STALE_TARGET` unless `--force` is present with a reason.
- JSON should include `ok`, `nodeId`, `runId`, `updatedNodeId`, `eventIds`, `edgeIds`, `previousStatus`, `status`, `reason`, `warnings`, and stale-read metadata.

### `awg ack`

```sh
awg ack <node-id> --reason <text> [--review-after <date>] [--scope focus|risk|question|task|general] [--expect-updated-at <iso>] [--force] [--run <run-id>|--no-run] [--json]
```

Behavior:

- Mutating and append-only.
- Writes a `node.acknowledged` event or the closest compatible event shape.
- Intended for intentionally carried-forward open items.
- Should warn when acknowledging without a review date, but not fail unless strict mode requires one.
- Should be conservative in generated suggestions: agents may acknowledge their own touched planning questions or low-risk housekeeping, but human-sensitive risks/blockers should default to human review.
- Should stale-read guard with `--expect-updated-at` or equivalent candidate snapshot metadata. If the target changed since inspection, fail or warn unless `--force` is present.
- JSON should include `ok`, `nodeId`, `runId`, `acknowledgementId`, `eventId`, `reviewAfter`, `acknowledgedNodeUpdatedAt`, `acknowledgedMaterialKeys`, `warnings`, and suggested inspection commands.

### `awg sweep`

```sh
awg sweep [--goal "<goal>"] [--older-than <duration>] [--limit <n>] [--json]
```

Behavior:

- Read-only.
- Summarizes stale open items, closeout candidates, old acknowledgements, and noisy current-focus contributors.
- Intended for maintenance agents, not every normal run.
- Must not mutate state.
- Should include `truncated` counts when limits apply.
- JSON should include `ok`, `generated_at`, `asOf`, `summary`, `groups`, `warnings`, `truncated`, and `suggestedCommands`.
- Should group items by suggested disposition:
  - `safe_closeout_candidate`
  - `needs_evidence`
  - `needs_human_review`
  - `acknowledge_or_schedule_review`
  - `stale_but_current_goal_related`
  - `historical_background`

## Integration Requirements

### Compiler

- Derive `graph.attention_index`.
- Write `.awg/compiled/indexes/attention.json`.
- Preserve old vault compatibility.
- Preserve unknown event/node fields.
- Keep compilation deterministic.
- Do not read prior compiled attention output as source.
- Do not derive base attention from work queues; queues consume base attention. If attention output needs queue ids, decorate them after queue derivation without affecting base ids/state/score.
- Persist `asOf` on the index. Build output uses graph `generated_at`; live read commands may use a live `asOf` only in command output.

### Required And Deferrable Slice Boundaries

Mandatory V2.4.2 core:

- Base attention index and compiled artifact.
- Acyclic compiler order.
- Existing `intentionally_open` compatibility.
- Read-only `closeout candidates`, `closeout run`, and `sweep`.
- Mutating `ack` and `closeout mark` with stale-read guards.
- Queue, handoff, lens resume/task, run preflight, doctor, and inbox integration for the core attention signals.
- Generated instruction and docs updates.
- Tests for all mandatory behavior.

Deferrable if scope grows too large:

- Static viewer route/panel.
- Configurable lens source `attention`.
- Rich UI drilldowns beyond node-detail attention metadata.
- Bulk closeout apply commands.
- Domain-specific lifecycle policies.

If a deferrable item is skipped, the implementation must document the deferral and leave stable JSON fields absent or empty rather than half-populated.

### Work Queues

Queues should consume the attention index rather than treating every open status as equal.

Required behavior:

- `queue next` should prioritize `current` attention items.
- `needs_review` should route to `human_review` or maintenance unless recent, goal-matched, active-run-touched, or high severity.
- Old open tasks should demote to maintenance or closeout candidates when no current signal exists.
- Acknowledged open items should not appear in `next` until due, unless active run or explicit goal context makes them relevant.
- `queue show` should include attention state and closeout suggestions for related nodes.
- Runtime queue commands with `--goal` must compute goal overlays after filtering relevant queue/attention records and before limiting results.

### Current View, Handoff, And Lenses

- `view current`, `lens resume`, `lens task`, and `handoff` should use attention state to avoid dumping stale historical active items.
- `handoff --json` should include a compact attention summary.
- `lens task --goal` should include closeout candidates only when they match the goal or active/recent run.
- Handoff should mention background maintenance counts without listing the whole stale backlog.
- All budgeted retrieval should filter by run/goal/source first, then rank, then slice to budget or limit. Add regression tests for filter-before-limit behavior.

### Run Finish Preflight

`awg run finish` should use the run-scoped closeout view for touched nodes.

Warnings should include:

- touched active/in-progress tasks likely completed but not closed.
- touched risk/blocker still active and unacknowledged.
- touched question with answer but no review/closeout.
- touched proposed decision with implemented linked work.
- stale acknowledgements on touched nodes.
- unreleased coordination claims.

Do not require a run to clean unrelated vault-wide historical debt. For `completed` runs, unresolved touched closeout warnings should be harder to ignore and may require `--force` if that matches existing preflight behavior.

### Doctor And Inbox

- Doctor should surface malformed acknowledgement events as validation/diagnostic issues.
- Doctor fix suggestions should include conservative `awg node show`, `awg ack`, and `awg closeout mark` commands.
- Maintenance inbox should group closeout candidates and stale acknowledgements without duplicating the attention derivation logic.
- Suggestions must not include destructive commands or broad bulk apply.

Recommended diagnostic codes:

- `AWG_ACK_INVALID_EVENT`: acknowledgement event shape is malformed.
- `AWG_ACK_MISSING_TARGET`: acknowledgement target is missing or does not resolve to a node.
- `AWG_ACK_MISSING_REASON`: acknowledgement lacks a non-empty reason.
- `AWG_ACK_MALFORMED_REVIEW_AFTER`: `review_after` cannot be parsed.
- `AWG_ACK_STALE`: acknowledgement is due or stale against watched material keys.
- `AWG_CLOSEOUT_STALE_TARGET`: closeout/ack mutation target changed since inspection.
- `AWG_ATTENTION_INDEX_INCOMPLETE`: attention index could not be derived from required sources.

### Configurable Lenses

If low-risk, add a lens source named `attention` so reviewed vault-local lenses can include attention items. It should be read-only and budget-limited.

### Static Viewer

If low-risk, add a small read-only attention/closeout surface:

- `#/attention` or a panel inside `#/maintenance`.
- Show current-focus contributors, stale open items, acknowledged open items, and closeout candidates.
- Node detail should show attention state and latest acknowledgement when available.
- The viewer must not write state, execute commands, poll, or sync.

If this grows the slice too much, defer viewer additions and document the deferral.

## Operating Template Integration

V2.4.2 should read optional operating template guidance when available. Useful fields:

- `maintenance_rules`
- `queue_rules`
- `freshness_rules`
- `approval_rules`
- `coordination_rules`

Template rules may adjust thresholds and human-review behavior, but they must not disable core hygiene entirely. If no reviewed template exists, use safe defaults.

Suggested defaults:

- `staleOpenUpdatedDays`: 30
- `longOpenAgeDays`: 60
- `ackReviewDays`: 30 when no explicit `review_after` is provided
- `recentRunWindowDays`: 14
- `currentFocusLimit`: 8-12 items depending on existing budget conventions

## Agent Instruction Updates

Generated instructions should teach:

- Before finishing, update statuses for touched tasks, risks, blockers, questions, and decisions.
- Use `awg closeout run --json` or finish preflight to inspect touched lifecycle debt.
- Use `awg ack` when an item is intentionally carried forward with a reason and review date.
- Do not run broad sweeps during every normal task.
- Use `awg sweep --json` for dedicated maintenance work.
- Do not close human-sensitive risks, blockers, business facts, or client-facing decisions without sufficient evidence or approval.
- Queue priority is context, not permission to ignore the user.

Keep the instructions compact; do not bloat every prompt with the entire attention model.

## Tests

Add focused tests for:

Attention index:

- older vaults without attention or acknowledgement data still compile.
- active run touched node becomes base `current`.
- active coordination claim increases base focus score.
- compiled base attention does not depend on arbitrary `--goal` input.
- live/read command output labels runtime `asOf` and goal overlays.
- old active task with no recent run or claim becomes `stale_open` or `closeout_candidate`.
- completed/resolved/archived nodes become `historical`.
- acknowledgement suppresses current focus until review date.
- acknowledgement becomes stale after review date or material watched-key update.
- legacy `intentionally_open` edges are adapted into acknowledgement-like derived records.

Closeout candidates:

- active task with linked evidence is a closeout candidate.
- active task completed by a run summary is a closeout candidate.
- active risk with completed mitigation/resolver is a closeout candidate.
- answered question is a closeout candidate or review candidate.
- proposed decision with implemented/completed linked work is a closeout candidate.
- superseded/duplicate active node is a closeout candidate.
- evergreen, recurring, roadmap, process, standard, policy, parent, and manual-closeout nodes are not suggested as completed from age or child completion alone.

CLI:

- `closeout candidates --json` is parseable and read-only.
- `closeout run --json` scopes to touched run nodes.
- `closeout run --limit` and `--category-limit` return truncation metadata.
- `closeout mark` appends normal updates, preserves run attribution, and does not delete source history.
- `closeout mark --expect-updated-at` detects stale targets.
- `ack` appends an acknowledgement event with reason/review date/run attribution.
- `ack --expect-updated-at` detects stale targets.
- `sweep --json` is parseable and read-only.
- missing nodes and malformed dates fail clearly.
- JSON error output uses stable `ok:false`, `code`, `message`, and suggested commands.

Queue and retrieval integration:

- `queue next` no longer surfaces old stale open items by default.
- `queue next --goal` can surface a stale item when goal-matched.
- `needs_review` goes to human review/maintenance unless current signals exist.
- acknowledged open items stay out of next until due.
- `handoff`, `lens resume`, and `lens task` include compact attention summaries without budget blowup.
- closeout, queue, lens, handoff, and preflight paths filter before ranking and limiting.

Preflight:

- finishing a completed run warns about touched unclosed tasks.
- finishing warns about touched unacknowledged risk/blocker.
- finishing does not require unrelated vault-wide cleanup.
- `--force` records unresolved warnings if existing run preflight supports that behavior.

Doctor/inbox:

- malformed acknowledgement events produce diagnostics.
- stale acknowledgement produces a conservative suggestion.
- closeout candidates appear in maintenance inbox or doctor suggestions.
- suggestions are command-like and non-destructive.

Viewer, if implemented:

- missing attention data does not crash.
- attention route or panel renders current, stale, acknowledged, and closeout groups.
- node detail surfaces attention state.

Compatibility:

- existing examples still build.
- unknown fields are preserved.
- tests isolate HOME/temp dirs and never touch real `~/.awg`.

## Verification

Run at minimum:

```sh
npm run typecheck
npm test
awg build --json
awg doctor --fix-suggestions --json
npm pack --dry-run --json
git diff --check
```

Fresh temp-vault smoke:

```sh
awg setup --yes
awg init
awg run start --goal "Attention smoke" --agent codex
awg add node --type task --title "Old task" --summary "Task that will look completed." --status active --json
awg add evidence --target <task-id> --summary "Implementation passed." --source terminal --command "npm test" --status passed --json
awg build --json
awg closeout candidates --json
awg ack <task-id> --reason "Intentionally carry forward for manual inspection." --review-after 2026-06-01 --json
awg build --json
awg queue next --json
awg sweep --json
awg closeout mark <task-id> --status completed --reason "Evidence exists and smoke test is complete." --json
awg build --json
awg doctor --fix-suggestions --json
```

Adjust command order to match final CLI constraints.

## Definition Of Done

AWG has a deterministic attention layer that keeps current focus and next-work queues from being dominated by stale historical open items. Agents can inspect closeout candidates, acknowledge intentionally carried-forward items with reasons and review dates, close touched work through append-only updates, and finish runs without being forced to clean unrelated vault-wide debt. All behavior remains local-first, append-only, backward compatible, domain-agnostic, and stable for multi-agent use.
