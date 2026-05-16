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
