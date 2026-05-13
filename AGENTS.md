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
