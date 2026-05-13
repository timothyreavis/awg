# AWG Viewer Surface Framework

The AWG viewer is a generated static surface for humans reviewing compiled project memory. It is not canonical storage, a server app, or a plugin runtime.

## Route Roles

- `#/overview` is curated. It shows what the agent thinks matters right now: focus items, attention items, open decisions, open questions, active risks, health summary, recent completions, and a resume lens preview.
- `#/graph` is exploratory. It renders a focused neighborhood around one node with deterministic depth-limited traversal instead of a whole-graph hairball.
- `#/kanban` is operational. It groups workflow-like nodes into status columns and stays read-only in static mode.
- `#/nodes` is the searchable database-style browser for all nodes.
- `#/node/<encoded-node-id>` is the canonical human inspection surface for a single node.
- `#/health` is for trust, diagnostics, and graph hygiene.
- `#/views` lists compiled/generated views and renders supported blocks with safe fallbacks.
- `#/settings` stores local UI preferences such as theme, density, and default graph depth.

All routes use hash routing so `.awg/compiled/site/index.html` remains usable as static files.

## Viewer Primitives

The viewer is organized around reusable primitives rather than one-off pages:

- surfaces
- blocks
- cards
- badges and chips
- graph neighborhoods
- boards
- details
- actions

The internal block renderer maps known block types to render functions. Unsupported blocks render a visible fallback and raw JSON. Agents may eventually generate view manifests that reference block types, but AWG does not execute arbitrary agent-provided HTML, CSS, JavaScript, or plugin code.

There are two block scopes:

- Generated/compiled view blocks may use AWG's internal route/view primitives.
- Node-authored durable `blocks` are restricted to the V1.7 MVP block set and are rendered with a stricter allowlist.

Node-authored MVP block types are:

- `brief`
- `callout`
- `metric-row`
- `table`
- `checklist`
- `task-queue`
- `risk-list`
- `decision-list`
- `evidence-list`
- `node-list`
- `timeline`
- `run-summary`

Additional internal view block types include:

- `stats-grid`
- `attention-list`
- `node-table`
- `decision-review`
- `risk-review`
- `question-review`
- `diagnostic-list`
- `kanban-board`
- `graph-neighborhood`
- `raw-json`

CLI-authored node blocks must include `schemaVersion: 1`, `type`, and `data`. Malformed structural blocks, unsupported block types, malformed block data, and malformed `sourceNodeIds` / `targetNodeIds` references fail before append. Historical malformed blocks and unsupported compiled-view blocks must not crash the viewer; they render a visible fallback.

## Query Helpers

Viewer blocks and routes share a deterministic node query subset:

- `type`
- `types`
- `status`
- `statuses`
- `tag`
- `tags`
- `importance_gte`
- `confidence_gte`
- `confidence_lte`
- `hasDiagnostics`
- `stale`
- `needsReview`
- `limit`
- `sortBy`

This keeps overview blocks, Kanban grouping, node filtering, and future view manifests aligned.

## Theme Tokens

Styling is tokenized through CSS variables. Themes should define global, semantic, status, diagnostic, and component tokens instead of hardcoding colors inside route renderers.

Current themes:

- AWG Light
- AWG Dark

The viewer defaults to the system preference, then stores explicit user choices in `localStorage`. No remote fonts, assets, server, or network access are required.

To add or edit a theme, update the CSS token sets in the static renderer. Keep route/component markup tied to semantic classes and tokens, not direct color values.

## Static Limits

The viewer is generated under `.awg/compiled/site/` and must work without a backend API, daemon, database, hosted sync, auth, telemetry, external CDN, or live filesystem writes.

Non-mutating actions can copy local text or route deeper into the generated data. Write-back actions such as drag-and-drop Kanban updates are intentionally deferred until AWG has a safe local write model for generated surfaces.

## Plugin Plan

Plugins are planned as future block/rendering contracts, not implemented as executable extension code. V1.3 only establishes the safe registry shape and fallback behavior. It does not allow arbitrary plugin execution, arbitrary HTML execution, or arbitrary JavaScript execution.
