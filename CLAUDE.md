# Claude Instructions

Follow the project instructions in `AGENTS.md`.

This project uses AWG as its durable project memory. Before starting work, run `awg lens resume`. If the lens is missing or stale, run `awg build`, then rerun `awg lens resume`.

Read `.awg/AGENTS.md` for AWG-specific operating rules. Prefer `awg add node`, `awg add edge`, and `awg add response` over manual JSONL edits. Do not edit `.awg/compiled/*`.

Before stopping, run `awg build` and `awg doctor`, fix fatal validation errors, and ensure `awg lens resume` reflects the current project state.

<!-- BEGIN AWG MANAGED INSTRUCTIONS id=claude-code hash=sha256:7e1ff7dee690baff0b7ef03a695267babff4c56e6860a967fa0f2cc9a65e223a -->
# AWG Claude Code Snippet

This project uses AWG as local durable project memory. Start with `awg handoff`, run `awg release current` after install or upgrade, check `awg vault topology --json` before cross-project work, then `awg run start --goal "<goal>"`. Use `awg search`, `awg template status --goal "<goal>" --json`, and `awg lens task --goal "<goal>"` before adding context; use `awg node show <node-id> --json` when you need a surfaced node's full detail. Capture the consequence, not the conversation: persist decisions, requirements, accepted plans, reusable constraints, risks, blockers, tasks, evidence, source-of-truth boundaries, and actionable feedback once they affect future work; during brainstorming, wait or capture only as a `needs_review` note/question, using a `hypothesis` tag when useful. Use `awg quick note|task|risk|question|decision "summary"` for low-ceremony durable captures. Durable writes automatically attach to the active run; use fields, safe blocks, freshness, and anchors when helpful; add run notes and evidence for completed work. Write only to the current explicit target vault; switch cwd into a related vault or leave a cross-vault handoff task when another vault needs updates. Before finishing, update stale statuses, run `awg build` and `awg doctor --fix-suggestions --json`, then finish with `awg run finish --status completed|partial|blocked|failed --summary "..." --auto-handoff`. If forced, document why.
<!-- END AWG MANAGED INSTRUCTIONS -->
