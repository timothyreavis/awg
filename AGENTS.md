# Agent Instructions

This project uses AWG as its durable project memory.

Before starting work:
- Run `awg lens resume`.
- If the lens is missing or stale, run `awg build`, then rerun `awg lens resume`.
- Read `.awg/AGENTS.md`.
- Start a focused run with `awg run start --goal "<goal>"` for non-trivial work.
- Run `awg template status --goal "<goal>" --json` and `awg lens task --goal "<goal>"` before adding durable context.
- Use `awg node show <node-id> --json` when search, lens, or handoff surfaces a node whose full body, fields, blocks, evidence, or run attribution matter.

During work:
- Record durable facts, decisions, risks, tasks, questions, constraints, and preferences in AWG.
- Prefer `awg add node`, `awg add edge`, `awg add response`, `awg update node`, and `awg add evidence` over manual JSONL edits.
- Use concise summaries for scanning. Use `body` for deeper agent-facing detail, `fields` for structured operational data, safe `blocks` for human presentation, `freshness` for currentness, and `anchors` for file/symbol/url/command references.
- Link knowledge by AWG node ID, not by file path.
- Do not edit `.awg/compiled/*`.
- Durable writes automatically attach to the active run. Use `--run <run-id>` only for an explicit active run and `--no-run` only when attribution should be intentionally suppressed.
- When behavior, policy, implementation, ownership, pricing, or process changes, update affected nodes and freshness metadata instead of leaving stale context behind.
- While dogfooding AWG, record any inefficiency, confusing workflow, missing primitive, presentation gap, stale-context issue, retrieval miss, or agent ergonomics problem as AWG knowledge. Prefer a task/risk/question node plus a run note so it can be reviewed case by case.

Before stopping:
- Run `awg build`.
- Run `awg doctor --fix-suggestions --json`.
- Fix fatal validation errors.
- Finish the run with `awg run finish --status completed|partial|blocked|failed --summary "..." --auto-handoff`; if forced, document why.
- Ensure `awg lens resume` reflects the current project state.

<!-- BEGIN AWG MANAGED INSTRUCTIONS id=codex hash=sha256:407df5ffd5696aa80f14789b6d9bc40e51edf77501dcc92896c041ea88a2b6a5 -->
# AWG Agent Loop

Start of session:
- Run `awg handoff`.
- Run `awg vault topology --json` before cross-project work.
- Run `awg run start --goal "<goal>"`.
- Use `awg search <query>` before creating durable nodes.
- Run `awg template status --goal "<goal>" --json` to understand local operating rules.
- Use `awg lens task --goal "<goal>"` for scoped context.
- Use `awg node show <node-id> --json` when a surfaced node's full body, fields, blocks, evidence, or run attribution matter.

During work:
- Update existing nodes instead of creating duplicates.
- Attach durable knowledge as nodes, edges, responses, and evidence.
- Write only to the current explicit target vault; switch cwd into a related vault or leave a cross-vault handoff task when another vault needs updates.
- Durable writes automatically attach to the active run. Use `--run <run-id>` for an explicit active run or `--no-run` to suppress attribution.
- Use `body` for narrative detail, `fields` for structured operational data, safe `blocks` for presentation, `freshness` for currentness, and `anchors` for references.
- Link related nodes by AWG node ID.
- Add run notes for meaningful progress or blockers.
- Add evidence for completed work or verification claims.

Before finishing:
- Update task, risk, blocker, and decision statuses.
- Run `awg build`.
- Run `awg doctor --fix-suggestions --json`.
- Fix fatal validation errors and relevant warnings.
- Run `awg run finish --status completed|partial|blocked|failed --summary "..." --auto-handoff`.
- If finishing with `--force`, document why in the summary or a run note.

Anti-patterns:
- Do not create duplicate nodes without searching.
- Do not mark work complete without evidence.
- Do not ignore stale risks or blockers.
- Do not leave orphan durable knowledge.
- Do not write only to chat when knowledge should persist.
- Do not edit `.awg/compiled/*` as source.
<!-- END AWG MANAGED INSTRUCTIONS -->
