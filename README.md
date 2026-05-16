# Agent Work Graph

Agent Work Graph, or AWG, is a local-first semantic format for durable agent knowledge.

Agents write typed graph objects to append-only JSONL logs. A deterministic compiler validates those logs and materializes a searchable current graph, diagnostics, compact agent lenses, human-readable review views, and a static HTML viewer.

AWG V1 is intentionally small:

- local files are the canonical backend
- JSONL logs are append-only
- compiled outputs are generated artifacts
- `~/.awg` is only a global registry/control-plane directory
- no database, server, daemon, telemetry, hosted sync, vector search, LLM calls, or external integrations

## Install

```sh
npm install
npm run build
```

The package exposes the CLI binary `awg` when installed or linked:

```sh
npm link
awg --help
```

You can also run the built CLI directly:

```sh
node dist/src/cli/index.js --help
```

## Quick Start

```sh
awg setup --yes
awg init
awg instructions install codex
awg add node --type concept --title "Example" --summary "Example durable knowledge."
awg run start --goal "Use example knowledge" --agent codex
awg search "example"
awg lens task --goal "use example knowledge"
awg build
awg doctor --fix-suggestions --json
awg run finish --status completed --summary "Created and verified example knowledge." --auto-handoff
awg open
```

`awg view current` prints the generated static viewer path:

```text
.awg/compiled/site/index.html
```

No server is required.

The generated viewer is a tokenized, hash-routed human surface:

- `#/overview` for curated current focus and attention
- `#/topology` for registered project relationships and cross-vault context
- `#/maintenance` for the derived maintenance inbox
- `#/graph` for focused relationship traversal
- `#/kanban` for read-only workflow review
- `#/nodes` for searchable node browsing
- `#/node/<id>` for node inspection
- `#/health` for diagnostics and graph hygiene
- `#/views` for compiled/generated and authored view surfaces
- `#/settings` for local UI preferences

Themes are CSS-variable based. AWG ships light and dark themes, defaults to system preference, and stores the selected theme in `localStorage`.

## Project Vaults and Global Registry

Each project keeps its canonical AWG vault at:

```text
project/.awg
```

The global directory is:

```text
~/.awg
```

`~/.awg` is not a merged knowledge base. It stores local control-plane files such as `config.json`, `registry.json`, and generated global switcher HTML. Registering a project means “this project vault exists and can be opened later.” It does not merge project knowledge, inject all registered vaults into lenses, or create cross-project context automatically.

Setup is safe to rerun:

```sh
awg setup --yes
```

Register the current project vault:

```sh
awg register
awg vault list
awg vault list --missing
awg vault prune --dry-run
awg vault info
awg vault link --to <vault> --rel depends_on --summary "Why this project matters"
awg vault topology --json
```

`awg init` registers the new project by default when `~/.awg` already exists. Use `awg init --no-register` to opt out. If `~/.awg` does not exist, `awg init` still creates the project `.awg` vault and prints normal output.

Install explicit agent instruction snippets:

```sh
awg instructions list
awg instructions install codex
awg instructions install claude-code
awg instructions install antigravity
awg instructions install all
awg instructions install codex --dry-run
awg instructions install codex --force
```

Codex instructions are patched into an existing root `AGENTS.md`/`agents.md` inside a clearly marked AWG-managed block, or into a new `AGENTS.md` when no variant exists. Existing user-authored content is preserved. Claude Code patches an existing root `CLAUDE.md`/`claude.md` when present; otherwise it writes a conservative snippet under `.awg/instructions/`. Antigravity writes a conservative snippet under `.awg/instructions/` unless a deeper native integration is added later.

AWG only updates its own managed instruction block. The begin marker records the instruction pack and a hash of the AWG-generated body, for example `<!-- BEGIN AWG MANAGED INSTRUCTIONS id=codex hash=sha256:... -->`. On the next install or upgrade, AWG verifies that hash before replacing the block. If the block was edited, belongs to a different pack, has ambiguous legacy content, has duplicate markers, or has malformed markers, AWG fails closed and leaves the file unchanged. `--force` replaces only a valid managed block with changed or legacy-unrecognized content; it does not repair malformed marker pairs and it never rewrites content outside the managed block.

`awg open` opens the current project viewer when run inside a project. Outside a project, or with `awg open --global`, it generates and opens a static global project switcher from `~/.awg/registry.json`. Projects without compiled viewers are shown with a prompt to run `awg build` in that project. Use `awg open --no-launch` or `AWG_NO_OPEN=1 awg open` when automation should print the generated path without opening a browser.

After updating the global `awg` CLI, project vault files can be upgraded explicitly:

```sh
awg upgrade
awg upgrade --dry-run
awg upgrade --all --dry-run
awg upgrade --all
awg upgrade --all --instructions all
awg upgrade --force
```

`awg upgrade` updates the current project vault. `awg upgrade --all` reads `~/.awg/registry.json` and upgrades registered project vaults one at a time. It does not merge graph knowledge or inject cross-project context. It updates config defaults, creates missing packaged core schemas, preserves customized project schemas for manual review, creates missing vault instruction files, and optionally updates instruction packs. User-authored Markdown is preserved; instruction updates only touch AWG-managed blocks.

## CLI

```sh
awg setup [--yes] [--no-instructions] [--instructions <packs>] [--register-current|--no-register-current]
awg upgrade [--all] [--dry-run] [--force] [--instructions <packs|all>] [--json]
awg init [--empty] [--demo] [--force] [--register] [--no-register]
awg register [--name <name>] [--scope project|org|user]
awg unregister [--path <path>]
awg vault list [--missing] [--json]
awg vault info [--json]
awg vault prune [--dry-run] [--yes] [--json]
awg instructions list
awg instructions install <codex|claude-code|antigravity|all> [--dry-run] [--force]
awg template status [--goal <goal>] [--json]
awg template scaffold --title <title> [--scope vault|project] [--json]
awg release notes [--json]
awg release current [--json]
awg search <query> [--type <type>] [--status <status>] [--tag <tag>] [--limit <n>] [--json]
awg node show <node-id> [--json]
awg add node --type <type> --title <title> --summary <summary> [--evidence-required] [--body <text>] [--field <key=value>] [--field-json <json>] [--fields-json <json>] [--block-json <json>] [--blocks-json <json>] [--freshness-json <json>] [--anchor <kind:value>] [--run <run-id>|--no-run] [--json]
awg add view --id v:<slug> --title <title> --summary <summary> --audience <human|agent|reviewer> [--block-json <json>] [--blocks-json <json|@file>] [--tag <tag>] [--run <run-id>|--no-run] [--json]
awg add edge --from <node-id> --rel <relation> --to <node-id> [--run <run-id>|--no-run]
awg add response --type <type> --target <id> --summary <summary> [--run <run-id>|--no-run]
awg add evidence --target <node-id> --summary <summary> [--source <source>] [--command <command>] [--path <path>] [--status <passed|failed|unknown>] [--run <run-id>|--no-run] [--json]
awg quick note|task|risk|question|decision <summary> [--title <title>] [--body <body>] [--tag <tag>] [--target <node-id>] [--status <status>] [--run <run-id>|--no-run] [--json]
awg rels [--json]
awg update node <node-id> [--title <title>] [--summary <summary>] [--status <status>] [--type <type>] [--importance <n>] [--confidence <n>] [--tag <tag>] [--body <text>] [--field <key=value>] [--field-json <json>] [--fields-json <json>] [--unset-field <key>] [--block-json <json>] [--blocks-json <json>] [--clear-blocks] [--freshness-json <json>] [--review-after <date>] [--anchor <kind:value>] [--anchors-json <json>] [--unset-anchor <kind:value>] [--run <run-id>|--no-run] [--json]
awg update view <view-id> [--title <title>] [--summary <summary>] [--audience <human|agent|reviewer>] [--tag <tag>] [--block-json <json>] [--blocks-json <json|@file>] [--clear-blocks] [--run <run-id>|--no-run] [--json]
awg run start --goal <goal> [--agent <name>] [--force] [--json]
awg run note <note> [--run <run-id>] [--json]
awg run finish --status <completed|partial|blocked|failed|abandoned> [--run <run-id>] [--summary <summary>] [--auto-handoff] [--force] [--json]
awg run status [--json]
awg run list [--json]
awg build [--json] [--strict]
awg validate [--json] [--strict]
awg doctor [--fix-suggestions] [--json]
awg inbox [--kind <kind>] [--limit <n>] [--json]
awg inbox show <item-id> [--json]
awg reconcile duplicate <a> <b> --canonical <id> [--reason <text>] [--json]
awg reconcile supersede <old> <new> [--reason <text>] [--json]
awg reconcile contradict <a> <b> [--reason <text>] [--json]
awg reconcile resolved-by <target> <resolver> [--reason <text>] [--json]
awg reconcile intentionally-open <target> --reason <text> [--json]
awg lens resume [--budget <n>] [--json]
awg lens task --goal <goal> [--budget <n>] [--json]
awg lens list [--goal <goal>] [--json]
awg lens show <lens-id> [--json]
awg lens run <lens-id> [--goal <goal>] [--budget <n>] [--json]
awg handoff [--budget <n>] [--compact] [--json] [--no-record]
awg recent [--days <n>] [--json]
awg view current [--json] [--text]
awg view list [--json]
awg view show <view-id> [--json]
awg open [--global] [--no-launch]
```

## Agent Retrieval and Maintenance

`awg search <query>` performs deterministic local search over node id, slug, title, summary, type, status, tags, optional anchors, and bounded text extracted from optional node `body`, `fields`, `blocks`, and `freshness`. It ranks exact id/slug matches first, then title and summary matches, with small boosts for importance, recency relative to the compiled graph timestamp, and actionable statuses. It never uses embeddings, AI, remote APIs, vector databases, or repository file crawling.

`awg node show <node-id>` is a read-only detail view for a single node. It returns the full node body, fields, blocks, freshness, anchors, incoming and outgoing edges, responses, evidence, node diagnostics, run attribution, and raw node snapshot history for duplicate/upsert inspection. Use `--json` when an agent needs the complete machine-readable node after `search` or `lens task` surfaced only summaries.

Configurable vault lenses are durable `kind: "lens"` records for repeated context shapes. Use `awg add lens` and `awg update lens` to propose or refine a reviewed, vault-local retrieval recipe, then inspect and run it with `awg lens list`, `awg lens show`, and `awg lens run`. Built-in `resume`, `task`, and `handoff` stay the default path when enough. Lens execution is read-only and deterministic; supported section sources are graph data such as search results, nodes, edges, runs, evidence, maintenance inbox, diagnostics, template context, topology, anchors, authored views, and static local guidance. Lenses must stay compact and query-backed; do not use them to copy the whole graph.

`awg release notes` and `awg release current` expose local deterministic release notes for agents after install or upgrade. They include version/date, highlights, new commands, agent actions, adoption suggestions, docs/node references, and explicit non-goals. They do not perform network checks or package self-update; until distribution is stable, docs point agents at the local `awg` command path rather than a promised `awg update`.

Capture discernment: use AWG for durable project knowledge, not transcript storage. Capture the consequence, not the conversation. Persist decisions, requirements, accepted plans, reusable constraints, risks, blockers, tasks, evidence, source-of-truth boundaries, and actionable feedback once they affect future work. During brainstorming, wait or capture only as a `needs_review` note/question; use a `hypothesis` tag when useful.

`awg quick note|task|risk|question|decision "summary"` is a low-ceremony shortcut over normal node writes. It creates ordinary AWG nodes, attaches the active run by default, supports `--run` and `--no-run`, and can create a normal `relates_to` edge with `--target`. It is intended for small durable captures, not transcript-like bulk records.

`awg rels` lists allowed edge relation ids with descriptions and example usage. Invalid `--rel` errors point to this discovery command.

Nodes keep `summary` as concise retrieval/scanning text. Optional `body` stores narrative detail, `fields` stores operational JSON data, `blocks` stores typed presentation blocks, and `freshness` stores currentness metadata such as `state`, `last_verified`, `review_after`, `verified_by`, `source_of_truth`, `supersedes`, and `superseded_by`. Older nodes without these fields remain valid, and unknown fields are preserved.

Node granularity should follow retrieval and maintenance boundaries, not a fixed word count. Keep `summary` to one or two scan-friendly sentences. Use `body` when a future agent needs deeper explanation, SOP detail, requirements, rationale, or examples that would make the summary too dense. Use `fields` for facts agents need to update deterministically, compare, filter, or validate. Use `blocks` only when the information has a natural node-local presentation shape such as a checklist, table, metric row, timeline, node list, callout, or brief. Use authored views when a human needs a recurring multi-node review surface for a queue, audit, run, risk register, evidence set, or operating dashboard. Use `freshness` whenever correctness can decay over time, and update linked/current nodes when behavior, policy, ownership, pricing, process, or implementation changes. Use `anchors` when a node must stay tied to a file, symbol, URL, command, document, or external reference.

Node-authored presentation blocks are data, not markup. The V1.7 write path accepts only the authored MVP block set: `brief`, `callout`, `metric-row`, `table`, `checklist`, `node-list`, and `timeline`. Malformed structural CLI block JSON, unsupported block types, malformed block data, oversized/deep block data, embedded binary-like block data, and malformed `sourceNodeIds` / `targetNodeIds` references are surfaced before or during compilation. The static viewer renders supported node blocks with centralized styling and safe fallbacks; AWG does not execute arbitrary HTML, CSS, JavaScript, or plugin code from durable content.

Node `body` is rendered by the static viewer with a safe outline renderer, not arbitrary Markdown or HTML. It preserves paragraphs and recognizes simple section labels, `#` headings, bullet lists, numbered lists, and inline code spans while escaping HTML. Use `blocks` when the content needs a stronger presentation primitive such as a table, checklist, timeline, metric row, callout, or node list.

`awg template status` is a read-only discovery surface for vault-local operating templates stored as AWG knowledge. Prefer regular core node types such as `process`, `standard`, or `policy` tagged `template`, `operating-template`, or `template:operating`; the legacy/custom `template` node type is only recognized for compatibility. The compiler derives `.awg/compiled/indexes/operating-templates.json` and exposes the same index on `graph.operating_templates`. The command reports active templates, selected template, scopes, missing required sections (`purpose`, `taxonomy`, `freshness_rules`, `agent_rules`), conflicts, warnings, suggested inspection commands, and required structured fields (`scope`, `purpose`, `taxonomy`, `freshness_rules`, `agent_rules`, `review_state`, `human_approved`).

`awg template scaffold --title "..." [--scope vault|project]` creates a normal `process` node tagged `template:operating` with the required structured fields. It starts as `needs_review` so a human or future agent can refine and approve it. It is not a template marketplace or domain pack installer.

An agent run is one focused work session. `awg run start --goal "<goal>"` appends a run-start event, `awg run note "..."` records meaningful progress or blockers, and `awg run finish --status completed|partial|blocked|failed --summary "..."` records the final outcome. Durable write commands attach to the active run by default; use `--run <run-id>` for an explicit active run and `--no-run` to suppress attribution. The compiler derives created, updated, touched, evidenced, completed, unresolved, diagnostic, and handoff state for each run from canonical log metadata. `awg run status` reports the active run and `awg run list --json` includes derived attribution summaries. Run history is canonical AWG event data, not hidden mutable state.

`awg inbox` derives a deterministic maintenance queue from compiled graph state. It is read-only and local. Item kinds include `stale`, `needs_review`, `duplicates`, `orphans`, `evidence`, `questions`, `risks`, `blockers`, `decisions`, `topology`, and `hygiene`. `awg inbox --json` returns stable item objects with ids, severity, priority, involved nodes/runs/vaults, reasons, conservative suggested commands, and autonomous/human-review flags. `--kind` filters the queue and `--limit` caps output. `awg doctor --fix-suggestions --json`, `handoff`, task lenses, resume lenses, run preflight, and the viewer reuse this inbox where safe.

`awg reconcile` records cleanup relationships as append-only edges and events. It never deletes, merges, or rewrites old history. The V1.9 CLI creates `duplicate_of`, `canonical_for`, `supersedes`, `superseded_by`, `contradicts`, `resolved_by`, and `intentionally_open` relationships; the schema also accepts existing evidence/provenance relationships such as `verified_by` and `derived_from`. Reconciliation commands validate local node targets and preserve active run attribution. `intentionally-open` is for explicit carry-forward acknowledgements; it requires a reason and only suppresses active risk/blocker preflight and inbox pressure while the acknowledgement is current for that node.

`awg run finish --status completed` runs a deterministic preflight. It warns about completed tasks without evidence, evidence-required nodes without evidence, active risks/blockers, proposed decisions, orphan or duplicate-ish nodes created during the run, high-priority inbox items affecting touched nodes, missing notes, missing changes, missing handoff, stale touched nodes, and doctor warnings affecting touched nodes. Completed runs with substantive unresolved preflight warnings require `--force`; partial, blocked, failed, and abandoned runs remain usable and report warnings. `--auto-handoff` records and prints a compact handoff after finishing, and JSON output includes finish, preflight, and handoff data. If `--force` is used, document why in the summary or a run note.

Recommended loop:

```sh
awg handoff
awg run start --goal "Implement task-scoped lens ranking"
awg search "task lens"
awg lens task --goal "Implement task-scoped lens ranking" --budget 2000
awg node show n:task-lens --json
# do work
awg update node n:task-lens --status completed
awg add evidence --target n:task-lens --summary "npm test passed" --source terminal --command "npm test"
awg build
awg doctor --fix-suggestions --json
awg run finish --status completed --summary "Implemented task lens ranking and tests." --auto-handoff
```

`awg lens task --goal "<goal>"` returns compact task-scoped context: selected template context, matched nodes, nearby related nodes, related decisions, active tasks, risks/blockers, open questions, active/current run context, related prior runs, related run notes, diagnostics, anchors, and recent evidence. `awg handoff` is a next-agent briefing with the active or most recent run, template context, run attribution, preflight warnings, deterministic handoff quality score/checklist, run notes/summary, active tasks, open decisions, blockers, risks, recent completions, evidence, responses, graph health, anchor impact, stale items, and recommended next actions. Plain `awg handoff` records a lightweight handoff event; use `--no-record` to skip that. Use `awg handoff --compact` for concise human/chat-ready text while preserving existing `--json` and budget behavior. JSON handoff output remains parseable and does not add extra console noise. `awg recent --days 7` lists recent runs, run notes, nodes, evidence, responses, status changes, and diagnostics relative to the current wall-clock time.

Handoff quality scoring is deterministic and explainable. Checks have fixed weights for finished run state, summary presence, notes or changes, evidence coverage, evidence-required coverage, new orphan count, touched risk/blocker review, proposed decisions, touched-node doctor errors, recorded handoff, stale touched nodes, active template discovery, template conflicts, invalid touched blocks, template-required fields, and secret-like touched values. The score is the rounded percentage of passing weight.

`--budget <n>` uses an approximate deterministic character budget. Section structure is preserved, high-priority items are emitted first, and omitted counts are included when lower-priority items are truncated. JSON mode always remains valid JSON.

Agent-facing commands support stable `--json` output for parsing: `release notes`, `release current`, `quick note/task/risk/question/decision`, `rels`, `add node`, `add edge`, `add response`, `add evidence`, `add lens`, `update node`, `update lens`, `node show`, `template status`, `template scaffold`, `run start`, `run note`, `run finish`, `run status`, `run list`, `search`, `lens resume`, `lens task`, `lens list`, `lens show`, `lens run`, `handoff`, `recent`, `vault list`, `vault prune`, `upgrade`, `doctor`, `build`, and `validate`.

Use `awg update node <node-id>` to keep durable state current. It appends a new node snapshot and a node update event; it does not mutate compiled artifacts and it does not create missing nodes by default.

Use `awg add evidence --target <node-id> --summary "..."` when claiming work is complete or verified. It validates the target, creates a generic `evidence` node, links it to the target with a supporting edge, and records inline evidence on the target so current diagnostics can recognize completed task evidence.

## Roadmap Specs

Implementation-grade roadmap specs live under `docs/spec/` when a slice needs more detail than README command help. Current planning specs include:

- `docs/spec/awg-claims-evidence.md` for V2.2 claim, evidence, verification, diagnostics, inbox, preflight, handoff, lens, and agent-guidance behavior.

`awg doctor` includes agent-loop warnings for stale active runs, active runs without recent notes, completed runs without evidence or changed nodes, finished runs without handoff records, completed tasks without evidence, orphan nodes, duplicate-looking titles/aliases, invalid or unsupported blocks, oversized block data, active blockers linked to completed work, active risks with completed mitigation that still need review, freshness/status conflicts, missing current verification, operating-template conflicts or missing sections, template-required field gaps, and secret-like values in durable rich content. These are warnings unless the underlying graph state is malformed. `awg doctor --fix-suggestions --json` adds conservative structured suggestions with command-like repairs; it does not mutate canonical logs.

The `examples/realistic-agent-loop` fixture is a compact dogfood project with active and completed work, evidence, duplicate-ish nodes, orphans, stale review state, risks, blockers, decisions, questions, responses, and multiple runs. It is intended for tests, docs, demos, and manual viewer inspection.

`awg vault list --missing` reports registry entries whose paths are missing or no longer look like current AWG vaults. `awg vault prune --yes` removes only paths that no longer exist; existing but invalid/incompatible vault paths are reported as skipped so registry pointers are not dropped during migrations or repairs. V1.8 adds explicit cross-project topology in `~/.awg/registry.json` through `relationships[]`: use `awg vault link`, `awg vault unlink --relationship <id>`, and `awg vault topology --json` to manage/read direct vault relationships. AWG surfaces compact related-vault context from already-built neighbor summaries, but graph writes remain scoped to the current project vault. To update another vault, switch into that project and run AWG there, or leave a local cross-vault handoff task.

Nodes may optionally include generic `anchors` for retrieval and handoff context:

```json
{
  "kind": "file",
  "path": "src/example.ts",
  "label": "Implementation"
}
```

Valid anchor kinds are `file`, `symbol`, `url`, `command`, `doc`, and `external`. Anchors are optional and domain-agnostic; AWG does not perform code intelligence.

Rich node writes can use inline JSON or `@file` JSON input for JSON flags:

```sh
awg add node --type task --title "Launch checklist" --summary "Track launch state." \
  --field owner=codex \
  --freshness-json '{"state":"current","last_verified":"2026-05-13"}' \
  --block-json '{"schemaVersion":1,"type":"checklist","data":{"items":[{"label":"Run tests","status":"done"}]}}'
```

## Storage Layout

Canonical input:

```text
.awg/log/YYYY/MM/YYYY-MM-DD.awg.jsonl
```

Compiled output:

```text
.awg/compiled/graph.json
.awg/compiled/nodes.json
.awg/compiled/edges.json
.awg/compiled/indexes/
.awg/compiled/lenses/resume.json
.awg/compiled/views/current.json
.awg/compiled/reports/diagnostics.json
.awg/compiled/site/
```

Project config and agent instructions:

```text
AGENTS.md or existing agents.md
CLAUDE.md or existing claude.md
.awg/config.json
.awg/AGENTS.md
.awg/schema/core/
```

`awg init` creates a root `AGENTS.md` when no `AGENTS.md`/`agents.md` variant already exists. That file tells future agents working in the project to use AWG before, during, and after work. Existing root `AGENTS.md` or `agents.md` files are left untouched.

`awg init` also creates a root `CLAUDE.md` when no `CLAUDE.md`/`claude.md` variant already exists. It points Claude-compatible agents at the active `AGENTS.md`/`agents.md` root instruction file and `.awg/AGENTS.md` so the same AWG workflow is applied there too. Existing `CLAUDE.md` or `claude.md` files are left untouched.

## Core Primitives

AWG Core V1 has seven primitive object kinds:

- `node`
- `edge`
- `event`
- `view`
- `lens`
- `response`
- `policy`

Nodes represent durable units of meaning. Edges represent typed relationships between nodes. Events and responses preserve history and feedback. Views and lenses define generated presentation and agent context. Policies preserve maintenance rules.

## Viewer Surface Model

The static viewer uses reusable UI primitives rather than one-off pages:

- surfaces
- blocks
- cards
- badges and chips
- graph neighborhoods
- boards
- details
- non-mutating actions

The overview is curated, the graph is exploratory, Kanban is operational, node detail is inspectable, and every summary item should link deeper when possible. Styling is tokenized through CSS variables for semantic, status, diagnostic, and component colors.

The internal compiled-view renderer supports safe known route and view block types such as current-effort cards, briefs, metric rows, attention lists, node lists/tables, decision/risk/question reviews, evidence and diagnostic lists, Kanban boards, graph neighborhoods, run summaries, and raw JSON. Node-authored durable `blocks` are stricter: only the V1.7 authored MVP block set is accepted by the CLI, and unsupported historical blocks render a clear fallback plus raw data. Future plugin/block rendering is planned, but AWG does not execute arbitrary plugin code, HTML, JavaScript, CSS, or agent-provided scripts.

Authored `kind: "view"` records are canonical view manifests. Use `awg add view` to create one and `awg update view` to maintain it. They compile into encoded `.awg/compiled/views/*.json` artifacts and are rendered under `#/views`; they may use deterministic graph queries over the documented safe query subset, but never arbitrary HTML/CSS/JS, repository crawling, network calls, LLM calls, or viewer writeback.

See `docs/spec/awg-viewer-surface.md` for the route model, token system, static limitations, and future plugin boundary.

## Compiler

The compiler is deterministic. It:

1. Loads config and schemas.
2. Reads canonical JSONL logs in sorted path order.
3. Parses and validates each line.
4. Materializes current graph state.
5. Builds backlinks, type, status, and tag indexes.
6. Runs graph diagnostics.
7. Generates graph JSON, diagnostics, resume lens, current view, and static viewer files.

Compiled `generated_at` metadata is derived from source object timestamps so unchanged source logs produce unchanged compiled artifacts.

Fatal errors return nonzero exit codes. Warnings keep normal builds usable; `--strict` elevates warnings to fatal diagnostics.

## Diagnostics

AWG reports operational graph health, including:

- malformed JSON
- schema errors
- incompatible duplicate IDs
- dangling edges
- orphan nodes
- duplicate-looking aliases
- stale review dates
- completed tasks without evidence
- unanswered questions
- low-confidence active nodes
- invalid or unsupported typed presentation blocks
- nodes marked `freshness.state: current` missing freshness verification
- freshness/status conflicts such as archived nodes still marked current
- active operating-template conflicts, missing template sections, and missing template-required fields
- secret-like values in rich node content

## Development

```sh
npm install
npm run typecheck
npm test
npm pack --dry-run --json
```

The test suite covers initialization, JSONL appends, compiler output, resume lenses, malformed JSON, strict dangling-edge behavior, stale/completion diagnostics, extension-field preservation, and compiled-output exclusion from canonical input.

## V1.1 Example Flow

```sh
npm install -g agent-work-graph
awg setup --yes
cd ~/dev/my-project
awg init
awg instructions install codex
awg add node --type concept --title "Project purpose" --summary "..."
awg build
awg doctor
awg open
```

## Example

See `examples/basic` for a minimal AWG vault with compiled outputs and a static viewer.

## License

MIT
