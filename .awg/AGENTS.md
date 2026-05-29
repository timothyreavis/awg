# AWG Agent Instructions

Start of session:
- Run `awg handoff`.
- Run `awg release current` after install or upgrade to discover current local capabilities.
- Run `awg vault topology --json` before cross-project work.
- Run `awg run start --goal "<goal>"`.
- Use `awg search <query>` before creating durable nodes.
- Run `awg inbox --limit 10` to review deterministic maintenance items.
- Run `awg template guide --goal "<goal>" --json` before creating or materially revising local operating rules.
- Run `awg template status --goal "<goal>" --json` to understand the vault operating template.
- Use `awg lens task --goal "<goal>"` for scoped context.
- Run `awg queue next --json` and `awg coord status --json` when selecting undirected next work; use `awg queue show <item-id> --json` and `awg coord check --target <id> --json` before acting on claimed or multi-node work.
- Use `awg lens list --goal "<goal>"` and `awg lens run <lens-id> --goal "<goal>"` only when a reviewed vault-local lens fits a repeated context shape.
- Use `awg node show <node-id> --json` when search, lens, or handoff surfaces a node whose full detail matters.

During work:
- Use AWG for durable project knowledge, not transcript storage. Capture the consequence, not the conversation.
- Do not search for a built-in domain pack first. Create scenario-specific vault-local operating templates when one is missing or clearly inadequate.
- Use `awg template scaffold --title "Operating template" --goal "<goal>" --scope vault --json` as a generic candidate only; fill it from explicit project context and keep it `needs_review` until human approval.
- Do not rewrite approved templates casually. Propose changes with a needs-review amendment/task or reset review metadata when materially changing policy.
- For client/high-stakes vaults, run `awg vault readiness --client-pilot --json`; treat AWG as internal agent memory unless a later phase marks a surface client-safe.
- Search first, then update the canonical node or create the smallest useful node.
- Capture decisions, requirements, accepted plans, reusable constraints, risks, blockers, tasks, claims, evidence, source-of-truth boundaries, and actionable feedback once they affect future work.
- During brainstorming, wait or capture only as a `needs_review` note/question; use a `hypothesis` tag when useful. Follow the vault template for stricter or more exploratory capture thresholds.
- Use `awg quick note|task|risk|question|decision "summary"` for low-ceremony durable captures.
- Update existing nodes instead of creating duplicates.
- Attach durable knowledge as nodes, edges, responses, and evidence.
- Write only to the current explicit target vault; switch cwd into a related vault or leave a cross-vault handoff task when another vault needs updates.
- Use `body` for narrative detail, `fields` for structured operational data, safe `blocks` for presentation primitives, configurable `lens` records for repeated agent context shapes, `freshness` for currentness, and `anchors` for references.
- Link related nodes by AWG node ID, not by file path.
- Add run notes for meaningful progress or blockers.
- Add evidence for completed work or verification claims.
- Use `awg add claim` for assertions that may guide future work, `awg verify <node-id> --summary "..."` before treating claims as proven, and `awg claim status <node-id> --json` before relying on stale, external, metric, policy, pricing, or implementation claims.
- Mark work that requires proof with `--evidence-required` and satisfy it before completion.
- Use `awg ack <node-id> --reason "..." --review-after <date> --expect-updated-at <iso>` for intentional carry-forward, and `awg closeout mark <node-id> --status completed|resolved|archived|superseded|needs_review --reason "..." --expect-updated-at <iso>` only after inspection.
- Use `awg sweep --json` only for dedicated maintenance passes. Do not bulk-close or close human-sensitive risks, blockers, decisions, policy, or process items without evidence or explicit approval.
- Record AWG friction, stale context, missing primitives, confusing workflows, or presentation gaps as durable nodes and run notes.

Before finishing:
- Update task, risk, blocker, and decision statuses.
- Add evidence for completed work.
- Keep contradictions explicit with evidence and redact sensitive evidence.
- Run `awg build`.
- Run `awg doctor --fix-suggestions --json`.
- Run `awg inbox --json` when deciding what to repair or intentionally carry forward.
- Run `awg closeout run --json` or use finish preflight to inspect touched lifecycle debt.
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
