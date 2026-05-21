# AWG Lenses

A lens is compact agent-facing context extraction.

V1 generates `.awg/compiled/lenses/resume.json` with important active nodes, open decisions, active tasks and risks, unanswered questions, recent responses, diagnostics summary, and obvious maintenance actions.

V1.4 adds interactive agent retrieval commands:

- `awg lens resume --budget <n>` returns broad project state with optional deterministic character budgeting.
- `awg lens task --goal "<goal>" --budget <n>` returns task-scoped context from deterministic local search, nearby graph relationships, related decisions, risks, blockers, active tasks, open questions, diagnostics, and evidence.
- `awg handoff --budget <n>` returns a next-agent briefing focused on current or recent run state, run notes, active work, open decisions, blockers, risks, recent completions, recent evidence, recent responses, health, stale/needs-review nodes, and recommended next actions.
- `awg recent --days 7` returns recent runs, run notes, changed nodes, evidence, responses, status changes, and diagnostics relative to the current wall-clock time.

V1.5 adds event-backed agent runs:

- `awg run start --goal "<goal>" [--agent <name>]`
- `awg run note "<note>"`
- `awg run finish --status completed|partial|blocked|failed|abandoned --summary "..."`
- `awg run status`
- `awg run list`

Runs are represented in canonical AWG events. They let fresh agents see what work was started, what changed during the run, what evidence was attached, and whether a handoff was generated.

V1.6 makes runs the unit of attribution and finish quality:

- Durable write commands attach to the active run by default.
- `--run <run-id>` attaches writes to an explicit active run.
- `--no-run` writes without run attribution.
- The compiler derives `graph.run_summaries` with created nodes, updated/touched nodes, created edges, responses, evidence nodes and targets, completed nodes, touched diagnostics, created orphans, unresolved risks/blockers/decisions, stale touched nodes, and handoff status.
- `awg run finish --status completed` runs preflight; substantive unresolved warnings require `--force`, while partial/blocked/failed/abandoned runs report warnings without making the loop unusable.
- `awg run finish --auto-handoff` records a handoff after finish and includes handoff output in JSON.
- `awg handoff` includes run attribution, unresolved preflight warnings, a deterministic quality score/checklist, and recommended next actions.
- `awg lens task --goal "<goal>"` includes active/current run context, related runs, and recent notes from related runs using deterministic text and touched-node matching.

Budgets are approximate character budgets, not tokenizer budgets. They preserve section structure, emit higher-priority items first, and include omitted counts. JSON output remains valid even when sections are truncated.

All retrieval is local and deterministic. AWG does not use embeddings, AI calls, remote APIs, vector search, daemon processes, or repository file crawling for lenses.

V1.7 extends deterministic search input with bounded text extracted from node `body`, `fields`, `blocks`, and `freshness` in addition to ids, titles, summaries, tags, statuses, types, and anchors. Rich content can improve matching, but summaries remain the concise retrieval and scanning surface.

V1.7 also adds template and anchor context to retrieval:

- `awg template status --json` reads the compiler-derived operating-template index and can select the best active template for a goal.
- `awg lens task --goal "<goal>"` includes selected template context, related anchor entries, and related run context while still using deterministic text and graph matching.
- `awg handoff` includes template context, anchor impact for the active/recent run, and V1.7 quality checks for template discovery, template conflicts, invalid touched blocks, missing template-required fields, and secret-like touched values.

Node detail retrieval:

- `awg node show <node-id>` returns a read-only full-detail view for one node after `search`, `lens task`, or `handoff` surfaces an id.
- `awg node show <node-id> --json` returns the full node, incoming/outgoing edges, responses, evidence nodes and evidence edges, diagnostics affecting the node or related edges, derived run attribution roles, and node snapshot history for duplicate/upsert inspection.
- The command rebuilds from canonical logs with `write: false`; it does not append events, update compiled artifacts, or record handoffs.

Budgeted handoff and lens output may omit empty sections. Non-empty sections keep stable `omitted` counts so agents can tell when lower-priority context was truncated.

V1.9 adds maintenance inbox context to retrieval. Resume lens output includes the top derived inbox items. Task lenses include inbox items related to matched or nearby nodes. Handoff includes a compact high-priority inbox section so the next agent can see stale, unsupported, duplicate-looking, unresolved, risky, or topology-related work before continuing. These sections are derived from compiled graph state and remain local, deterministic, budget-aware, and read-only.

V1.9.1 adds `awg handoff --compact` for concise human/chat-ready text. It preserves existing `--json`, `--budget`, and handoff event behavior. V1.9.1 also exposes template authoring guidance in `awg template status` and a low-risk `awg template scaffold --title "..." [--scope vault|project]` command that creates a normal `process` node tagged `template:operating` with required structured fields for review.

V2.1 adds configurable vault-local lenses. Built-in `resume`, `task`, and `handoff` remain stable defaults. A configurable lens is a canonical `kind: "lens"` record with an id like `lens:ops-review`, review/status metadata, deterministic selector hints, and ordered data-only sections. Agents use them for repeated workflow, role, queue, domain, or review-pass context shapes after the built-in task lens is not enough.

Write paths:

- `awg add lens --id lens:<slug> --title "..." --purpose "..." --scope vault --audience agent --sections-json <json|@file> [--selector-json ...] [--budget-json ...] [--tag ...] [--json]`
- `awg update lens <lens-id> [--title ...] [--purpose ...] [--status active|proposed|needs_review|archived] [--sections-json ...] [--section-json ...] [--clear-sections] [--selector-json ...] [--budget-json ...] [--tag ...] [--json]`

Read and execution paths:

- `awg lens list [--goal "..."] [--json]`
- `awg lens show <lens-id> [--json]`
- `awg lens run <lens-id> [--goal "..."] [--budget <n>] [--json]`

Lens execution is read-only. Supported section sources are `search`, `nodes`, `edges`, `runs`, `evidence`, `maintenanceInbox`, `diagnostics`, `templateContext`, `topology`, `anchors`, `view`, and `static`. Sections use bounded data and a safe query subset; there is no network access, repository crawling, shell execution, AI call, vector search, arbitrary JavaScript, or transform execution. The compiler preserves `graph.lenses` and writes `.awg/compiled/lenses/index.json`.

Agents should create a vault-local lens only when a repeated context shape is emerging. New lenses should usually start as `needs_review` unless the vault operating template allows autonomous activation. Iterate existing lenses instead of creating near duplicates, keep outputs compact and drill-down oriented, and never duplicate the whole graph into a lens.

V2.3 adds `workQueues` as a configurable lens source. It queries the derived `graph.work_queue_index` with bounded filters such as queue, priority, autonomous-safe, human-review, blocked, node ids, run ids, and goal text. Existing `maintenanceInbox`, `claims`, `evidence`, `diagnostics`, `nodes`, and `runs` sources continue to work.

V2.4 adds `coordination` as a configurable lens source. It queries the derived `graph.coordination_index` with bounded filters such as status, mode, agent, run id, target id, queue item id, collision state, staleness, and limit. Built-in resume and task lenses surface compact active claims and collisions for matched nodes, queue items, and related runs without dumping the whole coordination index.

V2.4.1 makes adaptive onboarding discoverable through existing lenses. `lens resume` and `lens task` surface missing or unreviewed operating-template guidance when relevant, and configurable lenses may use existing template, queue, coordination, diagnostics, and static sources to create vault-local onboarding review lenses. AWG does not ship fixed role/domain lenses as the main adaptation strategy.

V2.4.2 adds `attention` as a configurable lens source. It queries the derived `graph.attention_index` with bounded filters such as state, states, node ids, minimum focus score, closeout-only, goal text, and limit. Built-in resume, task, and handoff lenses use attention to keep stale historical open work from overwhelming current context while still surfacing goal-matched closeout candidates and stale acknowledgements when they matter.
