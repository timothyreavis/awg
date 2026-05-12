# Agent Instructions

This project uses AWG as its durable project memory.

Before starting work:
- Run `awg lens resume`.
- If the lens is missing or stale, run `awg build`, then rerun `awg lens resume`.
- Read `.awg/AGENTS.md`.

During work:
- Record durable facts, decisions, risks, tasks, questions, constraints, and preferences in AWG.
- Prefer `awg add node`, `awg add edge`, and `awg add response` over manual JSONL edits.
- Link knowledge by AWG node ID, not by file path.
- Do not edit `.awg/compiled/*`.

Before stopping:
- Run `awg build`.
- Run `awg doctor`.
- Fix fatal validation errors.
- Ensure `awg lens resume` reflects the current project state.
