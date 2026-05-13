# AWG Diagnostics

Diagnostics provide operational trust. V1 reports malformed JSON, schema errors, incompatible duplicate IDs, dangling edges, orphan nodes, duplicate aliases, completed tasks without evidence, stale review dates, unanswered questions, low-confidence active nodes, and related graph-health counts.

V1.5 adds agent-loop warnings for stale active runs, active runs without recent notes, completed runs without evidence or changed nodes, finished runs without handoff records, active blockers linked to completed/resolved work, and active risks with completed mitigation work that still need review. These diagnostics are warnings unless the source graph is malformed.

V1.6 adds run-finish preflight and structured repair suggestions. Preflight is deterministic and checks the finishing run for completed touched tasks without evidence, evidence-required touched nodes without evidence, active touched blockers/risks, proposed touched decisions, orphan or duplicate-ish nodes created during the run, missing notes, missing changed objects, missing handoff, stale/needs-review touched nodes, and doctor diagnostics affecting touched nodes.

V1.7 adds foundation diagnostics for structured node content. Node blocks are checked for the authored MVP schemaVersion 1 contract, unsupported block types, malformed block data, invalid references, excessive size/depth, and embedded binary-like content. Nodes marked `freshness.state: current` with no `freshness.last_verified` receive stale-pressure warnings. Freshness/status conflicts, such as archived nodes still marked current, are surfaced. Top-level `review_after` remains compatibility input, while nested `freshness.review_after` is the current canonical review date.

V1.7 also checks operating-template health. Active templates are indexed from regular AWG nodes tagged `template`, `operating-template`, or `template:operating`; conflicting active templates for the same scope/selector, missing required template sections, and templates that still need review produce diagnostics. Template `fieldRules` produce node-level diagnostics when structured fields required by the active template are missing.

Rich node content is scanned conservatively for secret-like values so agents do not accidentally preserve API keys, tokens, passwords, or private keys in durable memory. AWG reports the affected node and suggests review/redaction rather than attempting unsafe automatic repair.

`awg doctor --fix-suggestions --json` is non-mutating. It returns conservative command-like suggestions for common diagnostics, such as adding evidence to a completed task, linking an orphan node, marking stale nodes for review, reviewing active risks, resolving blockers, reviewing proposed decisions, completing operating templates, filling template-required fields, or marking secret-like content for review.
