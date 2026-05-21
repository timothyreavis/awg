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

<!-- BEGIN AWG MANAGED INSTRUCTIONS id=codex hash=sha256:18b200138702b7a6b5a827c37bc23987328e825f3812ec2ab45f77351f8036f1 -->
# AWG Agent Loop

Start of session:
- Run `awg handoff`.
- Run `awg release current` after install or upgrade to discover current local capabilities.
- Run `awg vault topology --json` before cross-project work.
- Run `awg run start --goal "<goal>"`.
- Use `awg search <query>` before creating durable nodes.
- Run `awg template guide --goal "<goal>" --json` before creating or materially revising local operating rules.
- Run `awg template status --goal "<goal>" --json` to understand local operating rules.
- Use `awg lens task --goal "<goal>"` for scoped context.
- Run `awg queue next --json` and `awg coord status --json` when selecting undirected next work; use `awg queue show <item-id> --json` and `awg coord check --target <id> --json` before acting on claimed or multi-node work.
- Use `awg lens list --goal "<goal>"` and `awg lens run <lens-id> --goal "<goal>"` only when a reviewed vault-local lens fits better than built-in task/handoff context.
- Use `awg node show <node-id> --json` when a surfaced node's full body, fields, blocks, evidence, or run attribution matter.

During work:
- Use AWG for durable project knowledge, not transcript storage. Capture the consequence, not the conversation.
- Do not search for preset domain packs. Create scenario-specific vault-local operating templates when one is missing or clearly inadequate.
- Use `awg template scaffold --title "Operating template" --goal "<goal>" --scope vault --json` only as a generic needs-review candidate, then fill it from explicit project context.
- Agents must not self-approve operating templates. Human approval requires an explicitly human/user/owner-attributed update; for client/high-stakes work, run `awg vault readiness --client-pilot --json`.
- Search first, then update the canonical node or create the smallest useful node.
- Capture decisions, requirements, accepted plans, reusable constraints, risks, blockers, tasks, evidence, source-of-truth boundaries, and actionable feedback once they affect future work.
- Use `awg add claim` for assertions that may guide future work, `awg verify <node-id> --summary "..."` before treating claims as proven, and `awg claim status <node-id> --json` before relying on stale, external, metric, policy, pricing, or implementation claims.
- Prefer autonomous-safe queue items only when the human has not directed a specific task; queue priority is context, not permission to override the user's request.
- During brainstorming, wait or capture only as a `needs_review` note/question; use a `hypothesis` tag when useful. Follow the vault template for stricter or more exploratory capture thresholds.
- Use `awg quick note|task|risk|question|decision "summary"` for low-ceremony durable captures.
- Update existing nodes instead of creating duplicates.
- Attach durable knowledge as nodes, edges, responses, and evidence.
- Write only to the current explicit target vault; switch cwd into a related vault or leave a cross-vault handoff task when another vault needs updates.
- Durable writes automatically attach to the active run. Use `--run <run-id>` for an explicit active run or `--no-run` to suppress attribution.
- Use `body` for narrative detail, `fields` for structured operational data, safe node-local `blocks` for presentation, authored `view` records for recurring multi-node human review surfaces, `freshness` for currentness, and `anchors` for references.
- Create configurable `lens` records for repeated agent context shapes; start new lenses as `needs_review` unless the vault template allows activation, update near-duplicates instead of creating more, and keep lenses compact, query-backed, and read-only.
- Link related nodes by AWG node ID.
- Add run notes for meaningful progress or blockers.
- Add evidence for completed work or verification claims.
- Rebuild and rerun queue commands after substantial graph updates. Use `awg coord claim` for non-trivial advisory work intent, release claims before finishing, and never treat coordination as a hard lock or permission system.
- Use contradictions explicitly with evidence instead of silently replacing old claims, and keep sensitive evidence redacted.

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
