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
