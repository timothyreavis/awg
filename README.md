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
awg build
awg doctor
awg lens resume
awg open
```

`awg view current` prints the generated static viewer path:

```text
.awg/compiled/site/index.html
```

No server is required.

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
awg vault info
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
```

Codex instructions are patched into an existing root `AGENTS.md`/`agents.md` inside a clearly marked AWG-managed block, or into a new `AGENTS.md` when no variant exists. Existing user-authored content is preserved. Claude Code patches an existing root `CLAUDE.md`/`claude.md` when present; otherwise it writes a conservative snippet under `.awg/instructions/`. Antigravity writes a conservative snippet under `.awg/instructions/` unless a deeper native integration is added later.

`awg open` opens the current project viewer when run inside a project. Outside a project, or with `awg open --global`, it generates and opens a static global project switcher from `~/.awg/registry.json`. Projects without compiled viewers are shown with a prompt to run `awg build` in that project. Use `awg open --no-launch` or `AWG_NO_OPEN=1 awg open` when automation should print the generated path without opening a browser.

After updating the global `awg` CLI, project vault files can be upgraded explicitly:

```sh
awg upgrade
awg upgrade --dry-run
awg upgrade --all --dry-run
awg upgrade --all
awg upgrade --all --instructions all
```

`awg upgrade` updates the current project vault. `awg upgrade --all` reads `~/.awg/registry.json` and upgrades registered project vaults one at a time. It does not merge graph knowledge or inject cross-project context. It updates config defaults, creates missing packaged core schemas, preserves customized project schemas for manual review, creates missing vault instruction files, and optionally updates instruction packs. User-authored Markdown is preserved; instruction updates only touch AWG-managed blocks.

## CLI

```sh
awg setup [--yes] [--no-instructions] [--instructions <packs>] [--register-current|--no-register-current]
awg upgrade [--all] [--dry-run] [--instructions <packs|all>] [--json]
awg init [--empty] [--force] [--register] [--no-register]
awg register [--name <name>] [--scope project|org|user]
awg unregister [--path <path>]
awg vault list [--json]
awg vault info [--json]
awg instructions list
awg instructions install <codex|claude-code|antigravity|all> [--dry-run]
awg add node --type <type> --title <title> --summary <summary>
awg add edge --from <node-id> --rel <relation> --to <node-id>
awg add response --type <type> --target <id> --summary <summary>
awg build [--json] [--strict]
awg validate [--json] [--strict]
awg doctor [--json]
awg lens resume [--json]
awg view current [--json] [--text]
awg open [--global] [--no-launch]
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
