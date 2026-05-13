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
