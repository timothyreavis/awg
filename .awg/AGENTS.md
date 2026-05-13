# AWG Agent Instructions

- Before starting work, run `awg handoff`, `awg lens resume`, or read `.awg/compiled/lenses/resume.json`.
- If the lens is missing or stale, run `awg build`.
- Store durable knowledge as AWG nodes/edges/responses/events.
- Use `awg search <query>` before creating duplicate nodes.
- Use `awg lens task --goal "..."` for scoped work context.
- Prefer `awg add`, `awg update node`, and `awg add evidence` commands over manually editing JSONL.
- Do not edit `.awg/compiled/*` manually.
- Do not link by file path when linking knowledge. Link by AWG node ID.
- Do not delete nodes to reorganize. Supersede, archive, merge later, or create corrective events.
- When making a durable decision, create or update a decision node.
- When identifying a risk/blocker, create a risk/task node with review metadata if possible.
- When completing work, update/add task status and add evidence.
- After writing AWG data, run `awg build`.
- Fix fatal validation errors before stopping.
- Review `awg doctor` warnings and resolve obvious stale items.
- End by running `awg handoff` and ensuring `.awg/compiled/lenses/resume.json` reflects the current state.
