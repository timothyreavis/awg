# AWG Core

AWG is a local-first semantic graph format for durable agent knowledge. V1 has seven primitives: node, edge, event, view, lens, response, and policy. AWG is not a SaaS, task manager, Obsidian clone, Markdown replacement, codebase-only memory tool, or hosted service.

Every object carries `awg: "0.1"` and `kind`. Durable knowledge is stored as nodes, relationships as typed edges, historical facts as events, human/agent feedback as responses, and maintenance rules as policies. Unknown `x-*` extension fields are preserved. Unknown node types warn by default and can become fatal in strict validation.

Nodes keep `summary` as concise retrieval and scan text. V1.7 adds optional richer layers:

- `body` for narrative detail that should not bloat summaries.
- `fields` for structured operational JSON data.
- `blocks` for typed presentation data rendered by AWG.
- `freshness` for currentness metadata such as `state`, `last_verified`, `review_after`, `verified_by`, `source_of_truth`, `supersedes`, and `superseded_by`.

Older nodes without these fields remain valid. Unknown fields are preserved through validation and compilation.

Node granularity is based on retrieval and maintenance boundaries:

- Keep `summary` concise and scan-oriented.
- Use `body` for deeper narrative detail, SOPs, rationale, requirements, examples, and agent-facing context that should not bloat the summary.
- Use `fields` for operational facts that agents need to update, compare, filter, or validate deterministically.
- Use `blocks` when the content has a natural human presentation shape such as a checklist, table, metric row, timeline, node list, callout, or brief.
- Use `freshness` when correctness can decay over time or when a node represents current operating truth.
- Use `anchors` when a node should stay tied to a file, symbol, URL, command, document, or external reference.

Agents should update affected nodes and related freshness metadata when behavior, policy, ownership, pricing, process, or implementation changes.

Node-authored `blocks` are JSON data, not markup. The V1.7 authored MVP block set is `brief`, `callout`, `metric-row`, `table`, `checklist`, `node-list`, and `timeline`. V2.0 authored `kind: "view"` manifests may use the wider safe view block set for multi-node human review surfaces, but durable node content remains stricter. AWG does not execute arbitrary HTML, CSS, JavaScript, or plugin code from durable content.

Nodes may include optional `anchors` for generic retrieval references. Anchor kinds are `file`, `symbol`, `url`, `command`, `doc`, and `external`; fields such as `path`, `name`, `url`, and `label` are optional and used only when relevant. Anchors are not code intelligence and do not require repository-specific behavior.

Vault-local operating templates should reuse regular core node types such as `process`, `standard`, or `policy`, then mark the node with the preferred `template:operating` tag. `template` and `operating-template` are compatibility aliases. AWG should not require a custom node type for template discovery, and `artifact`, implementation-spec, and roadmap/planning nodes must not become selected operating policy even when mis-tagged. The compiler materializes `graph.operating_templates` and `.awg/compiled/indexes/operating-templates.json` from eligible nodes, including active roots, selected template, scope conflicts, required sections, warnings, and suggested commands.

Templates should provide required governance fields through `fields` or section identifiers: `scope`, `purpose`, `taxonomy`, `freshness_rules`, `agent_rules`, `review_state`, and `human_approved`. New scaffolds start `needs_review` and `human_approved:false`; agents must not self-approve operating templates. Templates may also declare deterministic `fieldRules` such as `{ "nodeType": "task", "field": "owner", "required": true }` so doctor can surface missing structured fields without hard-coding a domain.

Anchors are materialized into `graph.anchor_index` and `.awg/compiled/indexes/anchors.json` so agents and humans can inspect which nodes mention the same file, symbol, URL, command, document, or external reference.

V1.9 adds append-only reconciliation relationships. Agents should use edges and events to mark cleanup state instead of deleting or rewriting old graph history. The `awg reconcile` CLI creates `duplicate_of`, `canonical_for`, `supersedes`, `superseded_by`, `contradicts`, `resolved_by`, and `intentionally_open`; the core schema also accepts existing evidence/provenance relations such as `verified_by` and `derived_from`. `intentionally_open` is a scoped acknowledgement for active risks or blockers that are deliberately carried forward; it must have a reason and should be refreshed when the node changes.

V1.9.1 adds adoption and CLI ergonomics without changing the graph model. `awg release notes` and `awg release current` read built-in local release notes with no network checks. `awg quick note|task|risk|question|decision` creates normal nodes, optional `relates_to` edges, and normal run attribution. `awg rels` lists allowed edge relations with descriptions and examples, and invalid relation errors point agents to that command. Generated instructions should teach capture discernment: capture the consequence, not the conversation; use AWG for durable decisions, requirements, accepted plans, reusable constraints, risks, blockers, tasks, evidence, source-of-truth boundaries, and actionable feedback; leave brainstorming in chat or capture it only as a `needs_review` note/question with a `hypothesis` tag when useful.

V2.2 strengthens claim and verification semantics without adding a parallel storage model. Claim-bearing knowledge remains normal AWG nodes, usually `type: "claim"` or existing node types with structured claim fields. Evidence remains normal `type: "evidence"` nodes linked with proof relations. The compiler derives `graph.claim_index`, `graph.evidence_index`, `.awg/compiled/indexes/claims.json`, and `.awg/compiled/indexes/evidence.json`; doctor, inbox, handoff, task lenses, configurable lenses, and run preflight surface unverified, contradicted, stale, expired, supported, and verified claim state. See `docs/spec/awg-claims-evidence.md` for the claim, evidence, verification, diagnostics, and agent guidance contract.

V2.3 adds derived agent work queues without making queues canonical storage. Queue items are read-only projections from normal nodes, maintenance inbox items, run summaries, diagnostics, topology, and claim/evidence indexes. See `docs/spec/awg-work-queues.md` for `graph.work_queue_index`, `.awg/compiled/indexes/work-queues.json`, queue CLI, ranking, lens/handoff/preflight integration, viewer route, and non-goals.

V2.4 adds local-first multi-agent coordination without turning AWG into real-time collaboration infrastructure. Coordination source records are append-only `kind: "event"` entries that express advisory work claims, releases, handoffs, and collision acknowledgements. The compiler derives `graph.coordination_index` and `.awg/compiled/indexes/coordination.json`; queues, runs, handoff, lenses, doctor, and the viewer surface coordination state. See `docs/spec/awg-multi-agent-coordination.md`.

V2.4.1 improves adaptive vault onboarding and pilot readiness. AWG teaches agents how to create scenario-specific vault-local operating templates rather than shipping many fixed domain packs. `awg template guide`, `awg template scaffold`, `awg template status`, and `awg vault readiness` verify reviewed operating rules, capture/non-capture policy, evidence/freshness/sensitivity/approval guidance, explicit handling for customer PII, financials, contracts/billing, private client context, and never-capture categories, backup/export/retention rules, agent instructions, queues, coordination, and no fatal diagnostics before AWG is relied on for real client or high-stakes internal project work. See `docs/spec/awg-adaptive-vault-onboarding.md`.

V2.4.2 adds lifecycle closeout and attention hygiene so old open statuses do not permanently pollute current focus, queues, handoff, lenses, and the viewer. Lifecycle status remains canonical, while the compiler derives `graph.attention_index` and `.awg/compiled/indexes/attention.json` before work queues. Append-only `node.acknowledged` events carry intentionally open items forward with reasons, review dates, run attribution, and material-key staleness checks. `awg closeout candidates`, `awg closeout run`, `awg closeout mark`, `awg ack`, and `awg sweep` provide bounded inspection and explicit mutation surfaces instead of broad automatic cleanup. See `docs/spec/awg-lifecycle-closeout-attention.md`.
