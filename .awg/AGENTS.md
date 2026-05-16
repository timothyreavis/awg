# AWG Agent Instructions

Start of session:
- Run `awg handoff`.
- Run `awg release current` after install or upgrade to discover current local capabilities.
- Run `awg vault topology --json` before cross-project work.
- Run `awg run start --goal "<goal>"`.
- Use `awg search <query>` before creating durable nodes.
- Run `awg inbox --limit 10` to review deterministic maintenance items.
- Run `awg template status --goal "<goal>" --json` to understand the vault operating template.
- Use `awg lens task --goal "<goal>"` for scoped context.
- Run `awg queue next --json` when selecting undirected next work; use `awg queue show <item-id> --json` before acting on queue items with multiple related nodes, blockers, or evidence requirements.
- Use `awg node show <node-id> --json` when search, lens, or handoff surfaces a node whose full detail matters.

During work:
- Use AWG for durable project knowledge, not transcript storage. Capture the consequence, not the conversation.
- Search first, then update the canonical node or create the smallest useful node.
- Capture decisions, requirements, accepted plans, reusable constraints, risks, blockers, tasks, evidence, source-of-truth boundaries, and actionable feedback once they affect future work.
- During brainstorming, wait or capture only as a `needs_review` note/question; use a `hypothesis` tag when useful. Follow the vault template for stricter or more exploratory capture thresholds.
- Use `awg quick note|task|risk|question|decision "summary"` for low-ceremony durable captures.
- Update existing nodes instead of creating duplicates.
- Attach durable knowledge as nodes, edges, responses, and evidence.
- Write only to the current explicit target vault; switch cwd into a related vault or leave a cross-vault handoff task when another vault needs updates.
- Use `body` for narrative detail, `fields` for structured operational data, safe `blocks` for presentation primitives, `freshness` for currentness, and `anchors` for references.
- Link related nodes by AWG node ID, not by file path.
- Add run notes for meaningful progress or blockers.
- Add evidence for completed work or verification claims.
- Rebuild and rerun queue commands after substantial graph updates, and do not claim, reserve, lock, assign, or automatically execute queue work in V2.3.
- Mark work that requires proof with `--evidence-required` and satisfy it before completion.
- Record AWG friction, stale context, missing primitives, confusing workflows, or presentation gaps as durable nodes and run notes.

Before finishing:
- Update task, risk, blocker, and decision statuses.
- Add evidence for completed work.
- Run `awg build`.
- Run `awg doctor --fix-suggestions --json`.
- Run `awg inbox --json` when deciding what to repair or intentionally carry forward.
- Fix fatal validation errors and review warnings.
- Run `awg run finish --status completed|partial|blocked|failed --summary "..." --auto-handoff`.
- If forced, document why in the run summary or a run note.

Anti-patterns:
- Do not create duplicate nodes without searching.
- Do not mark work complete without evidence.
- Do not ignore stale risks or blockers.
- Do not leave orphan durable knowledge.
- Do not write only to chat when knowledge should persist.
- Do not edit `.awg/compiled/*` as source.
