# Claude Instructions

Follow the project instructions in `AGENTS.md`.

This project uses AWG as its durable project memory. Before starting work, run `awg lens resume`. If the lens is missing or stale, run `awg build`, then rerun `awg lens resume`.

Read `.awg/AGENTS.md` for AWG-specific operating rules. Prefer `awg add node`, `awg add edge`, and `awg add response` over manual JSONL edits. Do not edit `.awg/compiled/*`.

Before stopping, run `awg build` and `awg doctor`, fix fatal validation errors, and ensure `awg lens resume` reflects the current project state.
