# Agent Instructions

This project uses AWG as its durable project memory.

Before starting work:
- Run `awg lens resume`.
- If the lens is missing or stale, run `awg build`, then rerun `awg lens resume`.
- Read `.awg/AGENTS.md`.
- Start a focused run with `awg run start --goal "<goal>"` for non-trivial work.

During work:
- Record durable facts, decisions, risks, tasks, questions, constraints, and preferences in AWG.
- Prefer `awg add node`, `awg add edge`, `awg add response`, `awg update node`, and `awg add evidence` over manual JSONL edits.
- Link knowledge by AWG node ID, not by file path.
- Do not edit `.awg/compiled/*`.
- Durable writes automatically attach to the active run. Use `--run <run-id>` only for an explicit active run and `--no-run` only when attribution should be intentionally suppressed.
- While dogfooding AWG, record any inefficiency, confusing workflow, missing primitive, presentation gap, stale-context issue, retrieval miss, or agent ergonomics problem as AWG knowledge. Prefer a task/risk/question node plus a run note so it can be reviewed case by case.

Before stopping:
- Run `awg build`.
- Run `awg doctor --fix-suggestions --json`.
- Fix fatal validation errors.
- Finish the run with `awg run finish --status completed|partial|blocked|failed --summary "..." --auto-handoff`; if forced, document why.
- Ensure `awg lens resume` reflects the current project state.
