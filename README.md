# Agent Work Graph

Agent Work Graph, or AWG, is a local-first semantic format for durable agent knowledge.

Agents write typed graph objects to append-only JSONL logs. A deterministic compiler validates those logs and materializes a searchable current graph, diagnostics, compact agent lenses, human-readable review views, and a static HTML viewer.

AWG V1 is intentionally small:

- local files are the canonical backend
- JSONL logs are append-only
- compiled outputs are generated artifacts
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
awg init
awg add node --type concept --title "Example" --summary "Example durable knowledge."
awg build
awg lens resume
awg view current
```

`awg view current` prints the generated static viewer path:

```text
.awg/compiled/site/index.html
```

No server is required.

## CLI

```sh
awg init [--empty] [--force]
awg add node --type <type> --title <title> --summary <summary>
awg add edge --from <node-id> --rel <relation> --to <node-id>
awg add response --type <type> --target <id> --summary <summary>
awg build [--json] [--strict]
awg validate [--json] [--strict]
awg doctor [--json]
awg lens resume [--json]
awg view current [--json] [--text]
awg open
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
AGENTS.md
CLAUDE.md
.awg/config.json
.awg/AGENTS.md
.awg/schema/core/
```

`awg init` creates a root `AGENTS.md` when one does not already exist. That file tells future agents working in the project to use AWG before, during, and after work. Existing root `AGENTS.md` files are left untouched.

`awg init` also creates a root `CLAUDE.md` when one does not already exist. It points Claude-compatible agents at `AGENTS.md` and `.awg/AGENTS.md` so the same AWG workflow is applied there too. Existing `CLAUDE.md` files are left untouched.

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

## Compiler

The compiler is deterministic. It:

1. Loads config and schemas.
2. Reads canonical JSONL logs in sorted path order.
3. Parses and validates each line.
4. Materializes current graph state.
5. Builds backlinks, type, status, and tag indexes.
6. Runs graph diagnostics.
7. Generates graph JSON, diagnostics, resume lens, current view, and static viewer files.

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

## Development

```sh
npm install
npm run typecheck
npm test
npm pack --dry-run --json
```

The test suite covers initialization, JSONL appends, compiler output, resume lenses, malformed JSON, strict dangling-edge behavior, stale/completion diagnostics, extension-field preservation, and compiled-output exclusion from canonical input.

## Example

See `examples/basic` for a minimal AWG vault with compiled outputs and a static viewer.

## License

MIT
