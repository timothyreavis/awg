export interface ReleaseNote {
  version: string;
  date: string;
  highlights: string[];
  newCommands: string[];
  agentActions: string[];
  adoption: string[];
  docs: string[];
  nonGoals: string[];
}

export const RELEASE_NOTES: ReleaseNote[] = [{
  version: "0.1.0-v2.4.3",
  date: "2026-05-29",
  highlights: [
    "Closeout attention now treats implemented implementation-plan/spec artifacts as closeout candidates when direct proof, verified_by evidence, a completed implementation run, or a completed implementation target shows the work shipped.",
    "Closeout reasons now win the derived attention state before active-run touch, so stale implemented artifacts stop appearing as current work merely because a run touched them.",
    "Run-scoped closeout and preflight use the same closeout-pressure signal, keeping finish-time lifecycle debt aligned with the attention index.",
    "Generated root and vault agent instructions now explicitly include closeout-run inspection before finish."
  ],
  newCommands: [
    "awg closeout candidates [--run <run-id|current>] [--goal <goal>] [--older-than <duration>] [--limit <n>] [--json]",
    "awg closeout run [--run <run-id|current>] [--limit <n>] [--category-limit <n>] [--json]",
    "awg closeout mark <node-id> --status <completed|resolved|archived|superseded|needs_review> --reason <text> [--expect-updated-at <iso>] [--json]"
  ],
  agentActions: [
    "Run awg closeout run --json before finishing substantive work and inspect implemented artifact/spec candidates, not only task nodes.",
    "Close implementation-plan/spec artifacts with awg closeout mark after evidence review when the code and verification are already shipped.",
    "Do not broadly close arbitrary artifacts, roadmap parents, policies, process nodes, or manual-closeout nodes from age or title matches.",
    "Use awg ack with a reason and review date when an implemented-looking item is intentionally kept active."
  ],
  adoption: [
    "Regenerate AGENTS/CLAUDE instructions with awg upgrade --instructions all when upgrading existing vaults.",
    "Use awg release current --json after upgrade so agents see the V2.4.3 closeout behavior.",
    "Expect maintenance inbox, queues, handoff, and closeout run to surface implemented planning artifacts that used to remain active."
  ],
  docs: [
    "README.md",
    "docs/spec/awg-lifecycle-closeout-attention.md"
  ],
  nonGoals: [
    "No broad automatic bulk closeout.",
    "No title-only artifact completion inference.",
    "No change to human approval requirements for risks, blockers, decisions, policies, process nodes, or operating templates."
  ]
}, {
  version: "0.1.0-v2.4.2",
  date: "2026-05-21",
  highlights: [
    "AWG now derives graph.attention_index and .awg/compiled/indexes/attention.json so current focus is separate from durable lifecycle status.",
    "Base compiled attention is deterministic at graph generated_at, while live read commands label runtime effective overlays with their own asOf and never persist them.",
    "Append-only node.acknowledged events let agents intentionally carry forward open work with reasons, review dates, run attribution, and stale material-key detection.",
    "Queues, handoff, lenses, run finish preflight, doctor, maintenance inbox, current view, and the static viewer consume attention state so stale historical work stops dominating current focus."
  ],
  newCommands: [
    "awg closeout candidates [--run <run-id|current>] [--goal <goal>] [--older-than <duration>] [--limit <n>] [--json]",
    "awg closeout run [--run <run-id|current>] [--limit <n>] [--category-limit <n>] [--json]",
    "awg closeout mark <node-id> --status <completed|resolved|archived|superseded|needs_review> --reason <text> [--expect-updated-at <iso>] [--json]",
    "awg ack <node-id> --reason <text> [--review-after <date>] [--scope <scope>] [--expect-updated-at <iso>] [--json]",
    "awg sweep [--goal <goal>] [--older-than <duration>] [--limit <n>] [--json]"
  ],
  agentActions: [
    "Use awg closeout run --json or finish preflight to inspect touched lifecycle debt before ending substantive work.",
    "Use awg ack with a reason, review date, and stale-read guard when an item is intentionally carried forward.",
    "Use awg closeout mark with --expect-updated-at after inspection; do not rely on broad automatic closeout.",
    "Use awg sweep --json only for dedicated maintenance passes, not every normal task.",
    "Do not close human-sensitive risks, blockers, client-facing decisions, or policy/process items without evidence or explicit approval."
  ],
  adoption: [
    "Regenerate AGENTS/CLAUDE instructions with awg instructions install or awg upgrade --instructions when appropriate.",
    "Use configurable lens source attention for reviewed vault-local attention recipes when the built-in task/resume lenses are not enough.",
    "Treat legacy intentionally_open edges as compatibility acknowledgements and prefer awg ack for new carry-forward state."
  ],
  docs: [
    "README.md",
    "docs/spec/awg-lifecycle-closeout-attention.md",
    "docs/spec/awg-core.md",
    "docs/spec/awg-lenses.md",
    "docs/spec/awg-viewer-surface.md"
  ],
  nonGoals: [
    "No daemon, server, hosted sync, MCP, network calls, LLM calls, vector search, or external task sync.",
    "No destructive cleanup, bulk automatic closeout, permission system, or domain-specific lifecycle model.",
    "No browser-side writeback from the static viewer."
  ]
}, {
  version: "0.1.0-v2.4.1",
  date: "2026-05-18",
  highlights: [
    "AWG now teaches adaptive vault-local operating-template authoring instead of shipping fixed domain packs.",
    "Template status separates reviewed active templates from needs-review candidates and excludes mis-tagged artifacts from operating policy.",
    "Vault readiness reports deterministic standard and client-pilot readiness without mutating logs or compiled artifacts.",
    "Client-pilot readiness checks human approval, capture/non-capture policy, evidence/freshness/sensitivity/approval rules, backup/export/retention rules, and secret-like diagnostics."
  ],
  newCommands: [
    "awg template guide [--goal <goal>] [--json]",
    "awg template scaffold --title <title> [--goal <goal>] [--scope vault|project] [--json]",
    "awg vault readiness [--goal <goal>] [--client-pilot] [--json]",
    "awg update node <id> --unset-tag <tag>"
  ],
  agentActions: [
    "Run awg template guide --json before creating or revising a vault-local operating template.",
    "Use awg template scaffold as a generic candidate only; fill it from explicit project context and keep it needs_review until human approval.",
    "Run awg vault readiness --client-pilot --json before relying on AWG as primary memory for client or high-stakes internal pilot work.",
    "Remove accidental template tags from artifact/spec/roadmap nodes with --unset-tag instead of append-only workarounds."
  ],
  adoption: [
    "Regenerate AGENTS/CLAUDE instructions with awg instructions install or awg upgrade --instructions when appropriate.",
    "Create scenario-specific local operating rules; do not look for a built-in domain pack.",
    "Treat AWG as internal agent memory unless a later phase marks a surface client-safe."
  ],
  docs: [
    "README.md",
    "docs/spec/awg-adaptive-vault-onboarding.md",
    "docs/spec/awg-core.md",
    "docs/spec/awg-diagnostics.md",
    "docs/spec/awg-lenses.md",
    "docs/spec/awg-viewer-surface.md"
  ],
  nonGoals: [
    "No fixed domain template pack library.",
    "No AI/LLM template generation, broad private file scanning, or transcript ingestion.",
    "No hosted sync, daemon, MCP, server, package self-update, plugin marketplace, permissions system, external task sync, vector search, or client-facing portal/UI."
  ]
}, {
  version: "0.1.0-v2.4",
  date: "2026-05-17",
  highlights: [
    "AWG now derives advisory local-first coordination state from append-only work claim, release, handoff, and collision events.",
    "Coordination data is compiled into graph.coordination_index and .awg/compiled/indexes/coordination.json.",
    "Queues, runs, handoff, lenses, doctor, and the static viewer surface active claims, stale claims, collisions, and handoffs.",
    "Coordination remains advisory visibility, not locking or real-time collaboration infrastructure."
  ],
  newCommands: [
    "awg coord status [--json]",
    "awg coord claim <target> [--mode exclusive|shared|watch] [--summary <text>] [--reason <text>] [--ttl-hours <n>] [--json]",
    "awg coord release <coordination-id> --status completed|released|abandoned|blocked [--summary <text>] [--json]",
    "awg coord check [--target <id>] [--queue-item <id>] [--json]",
    "awg coord handoff <coordination-id> [--to-agent <name>] [--to-role <role>] --summary <text> [--json]",
    "awg queue next [--include-claimed] [--mine]"
  ],
  agentActions: [
    "Run awg coord status --json before taking non-trivial undirected work.",
    "Run awg coord check --target <id> --json before touching claimed nodes.",
    "Use awg coord claim for non-trivial implementation work where another agent could collide.",
    "Use shared or watch mode for review, research, or monitoring lanes.",
    "Release coordination claims before finishing a run, or leave a coordination handoff when passing work on."
  ],
  adoption: [
    "Regenerate AGENTS/CLAUDE instructions with awg instructions install or awg upgrade --instructions when appropriate.",
    "Use configurable lens source coordination for repeated coordination review recipes.",
    "Treat human direction as authoritative; claims are warnings and handoff context, not permission gates."
  ],
  docs: [
    "README.md",
    "docs/spec/awg-multi-agent-coordination.md",
    "docs/spec/awg-work-queues.md",
    "docs/spec/awg-lenses.md",
    "docs/spec/awg-diagnostics.md",
    "docs/spec/awg-viewer-surface.md"
  ],
  nonGoals: [
    "No hard locks.",
    "No daemon, server, websocket, hosted sync, multi-user auth, network calls, scheduler, LLM call, external task sync, or cross-vault write.",
    "No use of V2.2 semantic claim nodes as coordination work claims."
  ]
}, {
  version: "0.1.0-v2.3",
  date: "2026-05-16",
  highlights: [
    "AWG now derives deterministic read-only agent work queues from compiled graph state.",
    "Built-in queues surface next work, autonomous-safe work, human review, blockers, evidence gaps, maintenance, stale review, risk review, and handoff follow-up.",
    "Queue data is compiled into graph.work_queue_index and .awg/compiled/indexes/work-queues.json without adding mutable queue records.",
    "Lens, handoff, run preflight, and the static viewer can surface compact queue context."
  ],
  newCommands: [
    "awg queue list [--queue <id>] [--limit <n>] [--autonomous] [--human-review] [--json]",
    "awg queue next [--goal \"...\"] [--queue <id>] [--limit <n>] [--autonomous] [--include-human-review] [--json]",
    "awg queue show <work-queue-item-id> [--json]"
  ],
  agentActions: [
    "Run awg queue next --json after handoff, template status, and task lens when selecting undirected next work.",
    "Prefer autonomous-safe queue items only when the human has not directed a specific task.",
    "Use awg queue show before acting on queue items with multiple related nodes, evidence requirements, or blockers.",
    "Record evidence after completing queue-driven work.",
    "Rebuild and rerun queue commands after substantial graph updates."
  ],
  adoption: [
    "Regenerate AGENTS/CLAUDE instructions with awg instructions install or awg upgrade --instructions when appropriate.",
    "Use configurable lens source workQueues for repeated queue-backed retrieval recipes.",
    "Keep queue commands read-only; do not claim, lock, reserve, assign, or execute work from queues in V2.3."
  ],
  docs: [
    "README.md",
    "docs/spec/awg-work-queues.md",
    "docs/spec/awg-core.md"
  ],
  nonGoals: [
    "No mutable queue records.",
    "No claiming, locks, leases, reservations, assignments, or multi-agent coordination.",
    "No daemon, scheduler, reminders, external sync, network calls, vector search, LLM dependency, plugin execution, or automatic task execution."
  ]
}, {
  version: "0.1.0-v2.2",
  date: "2026-05-16",
  highlights: [
    "Claims and evidence now compile into deterministic trust indexes.",
    "AWG distinguishes verified, supported, unverified, stale, expired, and contradicted claims.",
    "Doctor, inbox, handoff, task lenses, run preflight, and configurable lenses surface claim trust issues.",
    "Evidence metadata is richer while older evidence nodes and inline evidence remain compatible."
  ],
  newCommands: [
    "awg add claim --title \"...\" --claim \"...\" [--kind <kind>] [--json]",
    "awg verify <node-id> --summary \"...\" [--source <source>] [--status <passed|failed|unknown>] [--json]",
    "awg claim status <node-id> [--json]",
    "awg claims [--status <status>] [--kind <kind>] [--json]",
    "awg add evidence --target <node-id> --summary \"...\" [--url <url>] [--expires-at <date>] [--review-after <date>] [--reliability low|medium|high] [--redacted]"
  ],
  agentActions: [
    "Use awg add claim for assertions that may guide future work.",
    "Use awg verify or awg add evidence before treating claim-bearing work as complete.",
    "Check awg claim status before relying on old, external, pricing, policy, metric, or implementation claims.",
    "Use contradictions explicitly instead of silently replacing older claims.",
    "Keep evidence summaries concise and redact sensitive excerpts."
  ],
  adoption: [
    "Regenerate AGENTS/CLAUDE instructions with awg instructions install or awg upgrade --instructions when appropriate.",
    "Use the compiled claims and evidence indexes for review surfaces instead of crawling logs.",
    "Keep verification local and deterministic; do not add network checks or AI fact checking."
  ],
  docs: [
    "README.md",
    "docs/spec/awg-claims-evidence.md",
    "docs/spec/awg-core.md"
  ],
  nonGoals: [
    "No AI fact checking.",
    "No web/network verification.",
    "No vector search, daemon, server, hosted sync, plugin execution, external trust graph, secret storage, or destructive rewrite workflow."
  ]
}, {
  version: "0.1.0-v2.1",
  date: "2026-05-16",
  highlights: [
    "Configurable vault-local lenses let agents define deterministic retrieval recipes without hard-coded domain packs.",
    "Built-in resume, task, and handoff lenses remain stable defaults.",
    "Lens list/show/run commands provide read-only, budget-aware execution over compiled AWG graph data.",
    "Compiler diagnostics and a compiled lens index make lens configs reviewable and safe."
  ],
  newCommands: [
    "awg add lens --id lens:<slug> --title \"...\" --purpose \"...\" --sections-json ... [--json]",
    "awg update lens <lens-id> [--sections-json ...] [--section-json ...] [--json]",
    "awg lens list [--goal \"...\"] [--json]",
    "awg lens show <lens-id> [--json]",
    "awg lens run <lens-id> [--goal \"...\"] [--budget <n>] [--json]",
    "awg release notes [--json]",
    "awg release current [--json]",
    "awg quick note|task|risk|question|decision ... [--json]",
    "awg rels [--json]",
    "awg template scaffold --title \"...\" [--scope vault|project] [--json]",
    "awg handoff --compact"
  ],
  agentActions: [
    "Run awg release current after install or upgrade to learn current local capabilities.",
    "Use built-in awg lens task and awg handoff first; run a configured lens when a reviewed vault-local recipe fits the repeated context shape.",
    "Create new lenses as needs_review unless the vault operating template allows autonomous activation.",
    "Use awg quick for small durable captures; use full awg add/update when structured detail matters.",
    "Run awg rels before adding unfamiliar edge relations.",
    "Attach evidence with --source, --command, --status, --target, and --summary when making verification claims."
  ],
  adoption: [
    "Regenerate AGENTS/CLAUDE instructions with awg instructions install or awg upgrade --instructions when appropriate.",
    "Keep setup/install guidance on the stable local awg command path; defer package self-update until distribution is stable.",
    "Use template scaffold as a starting point for vault-local operating templates, then edit the generated node.",
    "Iterate existing lenses instead of creating near duplicates; keep lenses compact, query-backed, and drill-down oriented."
  ],
  docs: [
    "README.md",
    "docs/spec/awg-core.md",
    "docs/spec/awg-lenses.md",
    "n:agent-facing-release-notes-and-update-awareness-9a9dcc97",
    "n:agent-discernment-for-awg-capture-versus-chat-fe2b7769"
  ],
  nonGoals: [
    "No network update checks.",
    "No hosted sync, daemon, MCP, vector search, AI calls, repository crawling, arbitrary transforms, plugin execution, transcript ingestion, external memory sync, or package self-update command."
  ]
}];

export function currentReleaseNote(): ReleaseNote {
  return RELEASE_NOTES[0];
}
