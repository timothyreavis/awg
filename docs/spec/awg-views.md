# AWG Views

A view is semantic human-facing presentation intent. AWG V2.0 supports authored `kind: "view"` records in the append-only canonical log and still generates `.awg/compiled/views/current.json` for the built-in current review surface.

Authored views are durable manifests, not rendered HTML. Agents describe a compact surface with safe block data and deterministic queries; AWG owns validation, compilation, routing, styling, escaping, and fallback rendering.

Use a view when a human needs a recurring review surface for a workflow, queue, audit, run, risk register, evidence set, or operating dashboard. Use a node `summary` for scan text, node `body` for reusable explanation, node `fields` for structured operational facts, and node `blocks` for node-local presentation. Do not duplicate graph content into a view when a query or node link can reference the existing source nodes.

CLI:

```sh
awg add view --id v:current-work-review --title "Current Work Review" --summary "Active work, risks, and evidence." --audience human --blocks-json '[{"schemaVersion":1,"type":"node-table","title":"Active Work","data":{"query":{"types":["task"],"statuses":["active","in_progress","needs_review"],"limit":20},"columns":["status","title","updated_at"]}}]'
awg view list --json
awg view show v:current-work-review --json
awg update view v:current-work-review --summary "Updated review surface." --block-json '{"schemaVersion":1,"type":"risk-list","title":"Risks","data":{"query":{"type":"risk","limit":10}}}'
```

Supported authored view block types are `brief`, `callout`, `metric-row`, `table`, `checklist`, `timeline`, `node-list`, `node-table`, `task-queue`, `risk-list`, `decision-list`, `evidence-list`, `run-summary`, `diagnostic-list`, `graph-neighborhood`, `current-effort`, `stats-grid`, and `attention-list`.

Node-backed blocks use the safe node query subset: `type`, `types`, `status`, `statuses`, `tag`, `tags`, `importance_gte`, `confidence_gte`, `confidence_lte`, `hasDiagnostics`, `stale`, `needsReview`, `limit`, and `sortBy`.

`diagnostic-list` uses a separate safe diagnostics query subset: `severity`, `code`, `id`, and `limit`.

Queries filter only compiled AWG graph or diagnostic data. They do not crawl repositories, execute regex supplied by agents, call networks, run LLMs, or evaluate code.

The compiler materializes authored views into encoded `.awg/compiled/views/*.json` files plus `.awg/compiled/views/index.json`. The static viewer lists generated and authored views at `#/views` and renders individual views at `#/views/<encoded-view-id>`. Unsupported or malformed historical blocks render visible fallback output with escaped compact JSON.
