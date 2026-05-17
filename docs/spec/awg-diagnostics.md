# AWG Diagnostics

Diagnostics provide operational trust. V1 reports malformed JSON, schema errors, incompatible duplicate IDs, dangling edges, orphan nodes, duplicate aliases, completed tasks without evidence, stale review dates, unanswered questions, low-confidence active nodes, and related graph-health counts.

V1.5 adds agent-loop warnings for stale active runs, active runs without recent notes, completed runs without evidence or changed nodes, finished runs without handoff records, active blockers linked to completed/resolved work, and active risks with completed mitigation work that still need review. These diagnostics are warnings unless the source graph is malformed.

V1.6 adds run-finish preflight and structured repair suggestions. Preflight is deterministic and checks the finishing run for completed touched tasks without evidence, evidence-required touched nodes without evidence, active touched blockers/risks, proposed touched decisions, orphan or duplicate-ish nodes created during the run, missing notes, missing changed objects, missing handoff, stale/needs-review touched nodes, and doctor diagnostics affecting touched nodes.

V1.7 adds foundation diagnostics for structured node content. Node blocks are checked for the authored MVP schemaVersion 1 contract, unsupported block types, malformed block data, invalid references, excessive size/depth, and embedded binary-like content. Nodes marked `freshness.state: current` with no `freshness.last_verified` receive stale-pressure warnings. Freshness/status conflicts, such as archived nodes still marked current, are surfaced. Top-level `review_after` remains compatibility input, while nested `freshness.review_after` is the current canonical review date.

V1.7 also checks operating-template health. Active templates are indexed from regular AWG nodes tagged `template`, `operating-template`, or `template:operating`; conflicting active templates for the same scope/selector, missing required template sections, and templates that still need review produce diagnostics. Template `fieldRules` produce node-level diagnostics when structured fields required by the active template are missing.

Rich node content is scanned conservatively for secret-like values so agents do not accidentally preserve API keys, tokens, passwords, or private keys in durable memory. AWG reports the affected node and suggests review/redaction rather than attempting unsafe automatic repair.

`awg doctor --fix-suggestions --json` is non-mutating. It returns conservative command-like suggestions for common diagnostics, such as adding evidence to a completed task, linking an orphan node, marking stale nodes for review, reviewing active risks, resolving blockers, reviewing proposed decisions, completing operating templates, filling template-required fields, or marking secret-like content for review.

V1.9 adds a derived maintenance inbox. `awg inbox --json` is non-mutating and emits stable items with `id`, `kind`, `code`, `severity`, `priority`, involved node/edge/run/vault IDs, reasons, conservative suggested commands, and autonomous/human-review flags. Inbox kinds are `stale`, `needs_review`, `duplicates`, `orphans`, `evidence`, `questions`, `risks`, `blockers`, `decisions`, `topology`, and `hygiene`. Item IDs are deterministic from kind, code, and target IDs.

The inbox is conservative. Duplicate items are candidates for review, not merge instructions. Suggested commands prefer inspection, status review, evidence attachment, links, or append-only reconciliation. They must not delete nodes, rewrite logs, or perform destructive merges. Doctor fix suggestions may include inbox suggestions so agents see one repair vocabulary.

Run preflight includes high-priority inbox items affecting touched nodes. Handoff, task lenses, resume lenses, and the static viewer surface compact unresolved inbox context. `awg reconcile intentionally-open <target> --reason "..."` can acknowledge an intentionally active risk or blocker; the acknowledgement is current only while the marker edge has a reason and is newer than the node.

V2.2 diagnostics extend this trust model to claims and evidence. AWG warns when important active claims are unverified, contradicted, stale, or expired; when evidence is expired or missing useful source/status fields; and when verification metadata conflicts with node status or freshness. These findings feed doctor fix suggestions, maintenance inbox items, run preflight, handoff, and task lenses without making exploratory or partial runs unusable. See `docs/spec/awg-claims-evidence.md`.

V2.3 derives work queues from diagnostics, maintenance inbox items, tasks, claims, evidence, and runs. Queue items remain read-only projections with conservative suggestions, stable ids, and explicit `autonomousSafe` / `needsHumanReview` flags. See `docs/spec/awg-work-queues.md`.

V2.4 should derive coordination diagnostics from advisory work claims, releases, handoffs, and collision acknowledgements. Diagnostics should warn about active collisions, stale claims, finished runs with unreleased claims, missing targets, malformed coordination events, and ambiguous coordination handoffs. Doctor fix suggestions must remain conservative: inspect, release, abandon, or hand off; never delete, rewrite logs, or automatically resolve conflicts.
