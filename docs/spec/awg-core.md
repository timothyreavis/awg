# AWG Core

AWG is a local-first semantic graph format for durable agent knowledge. V1 has seven primitives: node, edge, event, view, lens, response, and policy. AWG is not a SaaS, task manager, Obsidian clone, Markdown replacement, codebase-only memory tool, or hosted service.

Every object carries `awg: "0.1"` and `kind`. Durable knowledge is stored as nodes, relationships as typed edges, historical facts as events, human/agent feedback as responses, and maintenance rules as policies. Unknown `x-*` extension fields are preserved. Unknown node types warn by default and can become fatal in strict validation.

Nodes may include optional `anchors` for generic retrieval references. Anchor kinds are `file`, `symbol`, `url`, `command`, `doc`, and `external`; fields such as `path`, `name`, `url`, and `label` are optional and used only when relevant. Anchors are not code intelligence and do not require repository-specific behavior.
