# AWG Diagnostics

Diagnostics provide operational trust. V1 reports malformed JSON, schema errors, incompatible duplicate IDs, dangling edges, orphan nodes, duplicate aliases, completed tasks without evidence, stale review dates, unanswered questions, low-confidence active nodes, and related graph-health counts.

V1.5 adds agent-loop warnings for stale active runs, active runs without recent notes, completed runs without evidence or changed nodes, finished runs without handoff records, active blockers linked to completed/resolved work, and active risks with completed mitigation work that still need review. These diagnostics are warnings unless the source graph is malformed.

V1.6 adds run-finish preflight and structured repair suggestions. Preflight is deterministic and checks the finishing run for completed touched tasks without evidence, evidence-required touched nodes without evidence, active touched blockers/risks, proposed touched decisions, orphan or duplicate-ish nodes created during the run, missing notes, missing changed objects, missing handoff, stale/needs-review touched nodes, and doctor diagnostics affecting touched nodes.

`awg doctor --fix-suggestions --json` is non-mutating. It returns conservative command-like suggestions for common diagnostics, such as adding evidence to a completed task, linking an orphan node, marking stale nodes for review, reviewing active risks, resolving blockers, or reviewing proposed decisions.
