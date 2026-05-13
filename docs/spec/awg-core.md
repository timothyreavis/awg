# AWG Core

AWG is a local-first semantic graph format for durable agent knowledge. V1 has seven primitives: node, edge, event, view, lens, response, and policy. AWG is not a SaaS, task manager, Obsidian clone, Markdown replacement, codebase-only memory tool, or hosted service.

Every object carries `awg: "0.1"` and `kind`. Durable knowledge is stored as nodes, relationships as typed edges, historical facts as events, human/agent feedback as responses, and maintenance rules as policies. Unknown `x-*` extension fields are preserved. Unknown node types warn by default and can become fatal in strict validation.

Nodes keep `summary` as concise retrieval and scan text. V1.7 adds optional richer layers:

- `body` for narrative detail that should not bloat summaries.
- `fields` for structured operational JSON data.
- `blocks` for typed presentation data rendered by AWG.
- `freshness` for currentness metadata such as `state`, `last_verified`, `review_after`, `verified_by`, `source_of_truth`, `supersedes`, and `superseded_by`.

Older nodes without these fields remain valid. Unknown fields are preserved through validation and compilation.

Node-authored `blocks` are JSON data, not markup. The V1.7 MVP block set is `brief`, `callout`, `metric-row`, `table`, `checklist`, `task-queue`, `risk-list`, `decision-list`, `evidence-list`, `timeline`, `run-summary`, and the generic compatibility type `node-list`. AWG does not execute arbitrary HTML, CSS, JavaScript, or plugin code from durable node content.

Nodes may include optional `anchors` for generic retrieval references. Anchor kinds are `file`, `symbol`, `url`, `command`, `doc`, and `external`; fields such as `path`, `name`, `url`, and `label` are optional and used only when relevant. Anchors are not code intelligence and do not require repository-specific behavior.

Vault-local operating templates should reuse regular core node types such as `process`, `standard`, or `policy`, then mark the node with `template`, `operating-template`, or `template:operating` tags. AWG should not require a custom node type for template discovery.
