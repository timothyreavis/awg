# AWG V2.3 Agent Work Queues

V2.3 turns AWG's existing maintenance, run, claim, evidence, task, risk, and handoff data into deterministic work queues for agents.

The goal is not to create another task system. The goal is to let an agent ask: what should I do next, what is safe to do autonomously, what needs human review, what is blocked, what needs evidence, and what follow-up should not be dropped?

## Principles

- Derive queues from canonical AWG logs and compiled graph state.
- Keep queues read-only projections, not mutable source of truth.
- Build on `maintenance_inbox`, `run_summaries`, `claim_index`, `evidence_index`, diagnostics, and normal task/risk/blocker/question/decision nodes.
- Keep queue item ids stable and deterministic.
- Keep suggestions conservative and command-like.
- Make autonomous-safe work explicit, but do not execute work automatically.
- Do not add multi-agent assignment, reservations, locks, leases, or ownership claims in V2.3. Those belong to V2.4.
- Do not add scheduling, daemon behavior, network calls, LLM calls, vector search, or external task-system sync.

## Queue Model

V2.3 must add a derived work queue index:

- `graph.work_queue_index`
- `.awg/compiled/indexes/work-queues.json`

The index shape:

```json
{
  "awg": "0.1",
  "kind": "work-queue-index",
  "generated_at": "2026-05-16T00:00:00.000Z",
  "queues": [],
  "items": [],
  "summary": {
    "total": 0,
    "byQueue": {},
    "bySeverity": {},
    "autonomousSafe": 0,
    "needsHumanReview": 0,
    "blocked": 0,
    "highPriority": 0
  }
}
```

Queue summaries must include:

- `id`
- `title`
- `description`
- `count`
- `highPriority`
- `autonomousSafe`
- `needsHumanReview`

Work queue item records must include:

- `id`: deterministic `wq:<queue>:<hash>` id.
- `queue`: one of the built-in queue ids.
- `title`
- `summary`
- `severity`: `info`, `warning`, or `error`.
- `priority`: integer `0-100`.
- `sourceKind`: `node`, `inbox`, `diagnostic`, `claim`, `evidence`, `run`, or `topology`.
- `sourceIds`: source ids used to derive the item.
- `nodeIds`
- `edgeIds`
- `runIds`
- `inboxItemIds`
- `claimIds`
- `evidenceIds`
- `vaultIds`
- `relationshipIds`
- `reasons`
- `suggestedCommands`
- `autonomousSafe`
- `needsHumanReview`
- `blocked`
- `blockedByNodeIds`
- `reviewAfter`
- `updatedAt`
- `createdAt`

Queue item ids must be deterministic. Compute the hash from:

- queue id.
- source kind.
- source code when available, such as inbox item code or diagnostic code.
- sorted source ids.
- sorted node, edge, run, inbox item, claim, evidence, vault, and relationship ids.

Use SHA-256 over a null-delimited string and keep the first 16 hex characters, matching existing deterministic id style.

Timestamp derivation:

- `createdAt` should be the earliest `created_at`, `started_at`, or evidence/diagnostic source timestamp among related source nodes/runs when available.
- `updatedAt` should be the latest `updated_at`, `finished_at`, note timestamp, evidence timestamp, or diagnostic source timestamp among related source nodes/runs when available.
- For maintenance inbox items that lack timestamps, derive timestamps from the referenced nodes, runs, relationships, or diagnostics.
- If no source timestamp exists, use `graph.generated_at`.

Readers must tolerate unknown future item fields in compiled queue artifacts, but V2.3 must derive queue records from canonical graph state rather than merging previous compiled artifacts.

## Built-In Queues

V2.3 must derive these built-in queue ids:

- `next`: highest-value currently actionable work.
- `autonomous`: work an agent can do without human review under the current graph state.
- `human_review`: work that should be inspected or approved by a human.
- `blocked`: work that is blocked by active blockers, dependencies, unresolved risks, or explicit blocked status.
- `evidence_needed`: completed, evidence-required, claim-bearing, or verification work missing evidence.
- `maintenance`: stale, orphan, duplicate, hygiene, topology, and repair-oriented work.
- `stale_review`: stale, expired, review-after, and freshness/currentness work.
- `risk_review`: active risks, blockers, contradictions, and unresolved high-risk items.
- `handoff_followup`: unfinished runs, forced-finish preflight warnings, recent handoff next actions, and cross-run follow-up.

Items may appear in more than one queue when useful. The same underlying source should keep a stable item id per queue.

## Source Mapping

Maintenance inbox is the primary source. V2.3 should promote selected inbox items into queue items instead of duplicating inbox derivation logic.

Inbox mapping:

- `claims` with contradiction -> `risk_review`, `human_review`, `next`.
- `claims` with stale/expired/unverified required -> `evidence_needed`, `stale_review`, `next`.
- `evidence` -> `evidence_needed` or `stale_review`.
- `blockers` -> `blocked`, `risk_review`, `human_review`.
- `risks` -> `risk_review`, `human_review`.
- `stale` -> `stale_review`, `maintenance`.
- `needs_review` -> `human_review`, `maintenance`.
- `duplicates` -> `maintenance`, `human_review`.
- `orphans` -> `maintenance`.
- `questions` -> `next` or `human_review` depending on importance and template policy.
- `decisions` -> `human_review` and `next` when implemented work depends on a proposed decision.
- `topology` -> `maintenance` and `handoff_followup`.
- `hygiene` -> `maintenance`.

Node mapping:

- Active or in-progress `task` nodes -> `next`.
- `task` nodes with `status: blocked` -> `blocked`.
- Incoming blocking edges also make a task blocked when `edge.rel === "blocks" && edge.to === task.id` and the source node `edge.from` is active/actionable. Set `blockedByNodeIds` from those `edge.from` ids.
- Completed tasks without evidence or evidence-required tasks without evidence -> `evidence_needed`.
- `risk` and `blocker` nodes in active states -> `risk_review` and `human_review`.
- `question` nodes not resolved -> `next` or `human_review`.
- Proposed/draft decisions -> `human_review`.
- Stale, expired, or needs-review nodes -> `stale_review` or `maintenance`.

Run mapping:

- Active stale runs -> `handoff_followup`.
- Completed runs without evidence or changed nodes -> `handoff_followup` and `maintenance`.
- Runs finished with forced unresolved preflight warnings -> `handoff_followup`.
- Recent run notes containing unresolved blockers or follow-up language may surface only when already represented by run summary/preflight/diagnostics; do not parse arbitrary prose heuristically in V2.3.

Claim and evidence mapping:

- Contradicted claims -> `risk_review`, `human_review`, and `next`.
- Unverified claim-bearing work requiring evidence -> `evidence_needed`.
- Stale or expired claims -> `stale_review`.
- Expired evidence -> `evidence_needed` and `stale_review`.

## Priority And Sorting

Priority must be deterministic.

Base priority:

- Fatal/malformed graph diagnostic source: `100`.
- Contradicted claim or unresolved blocker: `96`.
- Active blocker: `92`.
- Expired claim/evidence: `90`.
- Completed or evidence-required work missing evidence: `88`.
- Active risk: `86`.
- Unverified required claim: `84`.
- Stale current knowledge: `78`.
- Proposed decision affecting implemented/completed work: `76`.
- Completed run without evidence or changed nodes: `74`.
- Active or in-progress task: `70`.
- Needs-review node: `68`.
- Duplicate candidate: `62`.
- Orphan node: `58`.
- Open question: `52`.

Adjustments:

- Add `round((importance - 0.5) * 20)` when there is a primary node with numeric `importance`.
- Add `8` when `reviewAfter` or `expiresAt` is in the past.
- Add `5` when the item affects the active run's touched nodes.
- Subtract `10` from the `autonomous` queue when evidence is missing but the repair is still autonomous-safe.
- Clamp final priority to `0-100`.

Sort order:

1. priority descending.
2. severity rank: error, warning, info.
3. blocked false before true, except inside the `blocked` queue.
4. `reviewAfter` ascending when present.
5. `updatedAt` descending when present.
6. `id` ascending.

## Autonomous Safety

`autonomousSafe` must be conservative.

Autonomous-safe examples:

- Adding evidence to a completed task when the agent has just run the command.
- Adding an edge for an orphan only when the related target node id is explicit and no placeholder remains.
- Marking stale knowledge `needs_review` when the diagnostic explicitly recommends it.
- Running read-only commands such as `awg node show`, `awg claim status`, `awg inbox show`, or `awg queue show`.

Human-review examples:

- Resolving risks or blockers.
- Accepting decisions.
- Reconciling duplicates.
- Changing current business/customer/project facts.
- Suppressing warnings or marking intentionally open.
- Any item with placeholder commands that require judgment.

When uncertain, set `autonomousSafe: false` and `needsHumanReview: true`.

## CLI Contract

V2.3 must add:

- `awg queue list [--queue <queue-id>] [--limit <n>] [--autonomous] [--human-review] [--json]`
- `awg queue next [--goal "<goal>"] [--queue <queue-id>] [--limit <n>] [--autonomous] [--include-human-review] [--json]`
- `awg queue show <work-queue-item-id> [--json]`

`awg queue list` returns grouped queue output. In JSON:

```json
{
  "ok": true,
  "generated_at": "2026-05-16T00:00:00.000Z",
  "summary": {},
  "queues": [],
  "items": []
}
```

`awg queue next` returns a flattened ranked list. By default it excludes `needsHumanReview: true` items; use `--include-human-review` to include them. `--goal` filters by deterministic text matching over item title, summary, reasons, queue id, node ids, source ids, and related node title/summary. It must not call embeddings or semantic search.

`awg queue show` returns:

```json
{
  "ok": true,
  "item": {},
  "nodes": [],
  "runs": [],
  "inboxItems": [],
  "diagnostics": [],
  "claims": [],
  "evidence": []
}
```

All queue commands are read-only and must build from canonical logs with `write: false`.

Errors:

- Unknown queue id should list valid queue ids.
- Unknown item id should fail clearly.
- Invalid limit should fail clearly.
- `--autonomous` and `--human-review` together should fail clearly unless the implementation chooses a documented intersection behavior. Prefer failing.
- `awg queue next --human-review` is not a supported flag; use `--include-human-review`.

## Compiler And Artifacts

The compiler must derive queues after diagnostics, runs, claim/evidence indexes, topology, and maintenance inbox are available.

Compiler requirements:

- Add `work_queue_index?: WorkQueueIndex` to `CompiledGraph`.
- Write `.awg/compiled/indexes/work-queues.json`.
- Include enough compact queue data in `graph.json` for CLI/lens/handoff/viewer use.
- Preserve deterministic ordering.
- Do not write queue data to canonical JSONL logs.
- Do not inspect repository files, run commands, or call network services while deriving queues.

## Lenses, Handoff, And Preflight

Built-in retrieval surfaces must use work queues:

- `awg lens resume` should include top queue summaries and high-priority queue items.
- `awg lens task --goal ...` should include queue items related to matched or nearby nodes, claim issues, evidence issues, and related runs.
- `awg handoff` should include compact top queue items and use queue data for recommended next actions.
- `awg run finish` preflight may reference work queue items affecting touched nodes, but must not make partial, blocked, failed, or abandoned runs unusable.

Configurable lenses must add source `"workQueues"` to `LENS_SECTION_SOURCES`.

Supported query keys:

- `queue`
- `queues`
- `autonomousSafe`
- `needsHumanReview`
- `blocked`
- `minPriority`
- `severity`
- `nodeIds`
- `runIds`
- `goal`
- `limit`

The existing `maintenanceInbox`, `claims`, `evidence`, `diagnostics`, `nodes`, and `runs` lens sources must keep working.

## Viewer Surface

V2.3 must add a minimal read-only `#/queues` route using the current static viewer architecture.

The route should show:

- queue summary counts.
- top `next` items.
- autonomous-safe items.
- human-review items.
- blocked items.
- evidence-needed items.
- maintenance/stale/risk/handoff follow-up groups.

It should link to node detail, run detail where available, inbox item detail where available, and relevant existing routes. It must not add writeback or browser-side mutation.

## Agent Guidance

Generated instructions should teach agents:

- Run `awg queue next --json` after `handoff`, `template status`, and task lens when selecting next work.
- Prefer autonomous-safe queue items only when the user has not directed a specific task.
- Do not treat queue priority as permission to override the human's explicit request.
- Use `queue show` before acting when an item has multiple related nodes or evidence requirements.
- Record evidence after completing queue work.
- Rebuild and rerun queue commands after substantial graph updates.
- Do not claim or reserve work in V2.3; V2.4 will handle multi-agent coordination.

## Tests Required

- Older vaults without queue data compile.
- Work queue index derives from maintenance inbox, tasks, claims, evidence, diagnostics, and runs.
- Queue item ids and ordering are deterministic.
- `queue list --json`, `queue next --json`, and `queue show --json` are parseable and read-only.
- Unknown queue/item/limit errors are clear.
- `--autonomous` filters to autonomous-safe items.
- `--human-review` filters to human-review items.
- `queue next --goal` filters deterministically without embeddings.
- Completed task without evidence appears in `evidence_needed`.
- Active blocker appears in `blocked` and `risk_review`.
- Contradicted claim appears in `risk_review` and `human_review`.
- Stale/expired claim or evidence appears in `stale_review`.
- Forced finish or unfinished run follow-up appears in `handoff_followup`.
- Task lens and handoff include compact work queue context within budget.
- Configurable lens source `workQueues` works.
- Viewer `#/queues` route handles missing queue data without crashing.
- Full verification: `npm run typecheck`, `npm test`, `awg build --json`, `awg doctor --fix-suggestions --json`, fresh temp-vault smoke, `npm pack --dry-run --json`, and `git diff --check`.

## Non-Goals

- No mutable queue records.
- No task assignment, claiming, locking, leases, or collision prevention.
- No background worker, daemon, scheduler, or reminders.
- No external task manager sync.
- No multi-user permission system.
- No cross-vault writes.
- No automatic command execution.
- No AI/LLM ranking, semantic search, or vector search.
- No repository crawling.

## Definition Of Done

AWG can deterministically say what work is next, what is autonomous-safe, what needs human review, what is blocked, what needs evidence, what maintenance should be handled, and what handoff follow-up should not be dropped. Agents can inspect and act from queues without carrying the whole graph in context, while all durable truth remains in normal AWG nodes, edges, events, evidence, runs, diagnostics, inbox, and claim/evidence indexes.
