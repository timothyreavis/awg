# AWG Lenses

A lens is compact agent-facing context extraction.

V1 generates `.awg/compiled/lenses/resume.json` with important active nodes, open decisions, active tasks and risks, unanswered questions, recent responses, diagnostics summary, and obvious maintenance actions.

V1.4 adds interactive agent retrieval commands:

- `awg lens resume --budget <n>` returns broad project state with optional deterministic character budgeting.
- `awg lens task --goal "<goal>" --budget <n>` returns task-scoped context from deterministic local search, nearby graph relationships, related decisions, risks, blockers, active tasks, open questions, diagnostics, and evidence.
- `awg handoff --budget <n>` returns a next-agent briefing focused on active work, open decisions, blockers, risks, recent completions, recent evidence, recent responses, health, stale/needs-review nodes, and recommended next actions.
- `awg recent --days 7` returns recently changed nodes, evidence, responses, status changes, and diagnostics relative to the current wall-clock time.

Budgets are approximate character budgets, not tokenizer budgets. They preserve section structure, emit higher-priority items first, and include omitted counts. JSON output remains valid even when sections are truncated.

All retrieval is local and deterministic. AWG does not use embeddings, AI calls, remote APIs, vector search, daemon processes, or repository file crawling for lenses.
