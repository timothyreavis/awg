# AWG Viewer Surface Framework

The AWG viewer is a generated static surface for humans reviewing compiled project memory. It is not canonical storage, a server app, or a plugin runtime.

## Route Roles

- `#/overview` is curated. It shows what the agent thinks matters right now: current effort/run context, selected operating template, focus items, attention items, open decisions, open questions, active risks, health summary, recent completions, and a resume lens preview.
- `#/graph` is exploratory. It renders a focused neighborhood around one node with deterministic depth-limited traversal instead of a whole-graph hairball.
- `#/kanban` is operational. It groups workflow-like nodes into status columns and stays read-only in static mode.
- `#/nodes` is the searchable database-style browser for all nodes.
- `#/node/<encoded-node-id>` is the canonical human inspection surface for a single node.
- `#/health` is for trust, diagnostics, and graph hygiene.
- `#/queues` is the V2.3 read-only work queue surface for next, autonomous-safe, human-review, blocked, evidence-needed, maintenance, stale-review, risk-review, and handoff-followup items.
- `#/coordination` is the V2.4 read-only coordination surface for active work claims, stale claims, collisions, coordination handoffs, claimed queue items, and suggested next commands.
- `#/views` lists compiled/generated views and authored view manifests. `#/views/<encoded-view-id>` renders one view with safe fallbacks.
- `#/settings` stores local UI preferences such as theme, density, and default graph depth.

V2.4.1 may add a small read-only onboarding/readiness panel to `#/overview` or `#/settings`. It should show selected operating template, review state, missing required/recommended adaptive fields, pilot readiness result, and suggested commands. It must not become a setup wizard, browser-side write surface, or client-facing UI.

V2.4.2 keeps attention and closeout viewer work small and read-only. The overview and maintenance surfaces may use `graph.attention_index` to show current focus, stale open items, acknowledged open items, and closeout candidates, and node detail may expose attention metadata. The generated viewer must not acknowledge, close, sweep, poll, sync, or execute commands in the browser.

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

The internal block renderer maps known block types to render functions. Unsupported blocks render a visible fallback and raw JSON. Agents may author `kind: "view"` manifests that reference the supported V2.0 view block set, but AWG does not execute arbitrary agent-provided HTML, CSS, JavaScript, or plugin code.

There are two block scopes:

- Generated/compiled view blocks may use AWG's internal route/view primitives.
- Node-authored durable `blocks` are restricted to the V1.7 MVP block set and are rendered with a stricter allowlist.

Node-authored MVP block types are:

- `brief`
- `callout`
- `metric-row`
- `table`
- `checklist`
- `node-list`
- `timeline`

Authored V2.0 view manifests may use the node block set plus:

- `current-effort`
- `stats-grid`
- `attention-list`
- `task-queue`
- `risk-list`
- `decision-list`
- `evidence-list`
- `run-summary`
- `node-table`
- `diagnostic-list`
- `graph-neighborhood`

Generated/internal-only view blocks may also include legacy review and fallback primitives:

- `decision-review`
- `risk-review`
- `question-review`
- `kanban-board`
- `raw-json`

CLI-authored node and view blocks must include `schemaVersion: 1`, `type`, and `data`. Node blocks use the stricter node allowlist. View manifests use the authored V2.0 allowlist above. Malformed structural blocks, unsupported block types, malformed block data, and malformed `sourceNodeIds` / `targetNodeIds` references fail before append. Historical malformed blocks and unsupported compiled-view blocks must not crash the viewer; they render a visible fallback.

Node `body` text is rendered with a safe outline renderer. It is not arbitrary Markdown or HTML. The renderer escapes HTML and only recognizes paragraphs, simple section-label headings, `#` headings, bullet lists, numbered lists, and inline code spans. Richer human presentation should use the supported typed block set instead of embedding markup in body text.

## Query Helpers

Node-backed viewer blocks and routes share a deterministic node query subset:

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

This keeps overview blocks, Kanban grouping, node filtering, and node-backed authored view manifests aligned.

`diagnostic-list` uses a separate deterministic diagnostics query subset:

- `severity`
- `code`
- `id`
- `limit`

Diagnostics queries filter only compiled diagnostics. They do not evaluate code, inspect files, or run repository scans.

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
