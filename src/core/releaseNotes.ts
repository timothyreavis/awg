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
  version: "0.1.0-v1.9.1",
  date: "2026-05-16",
  highlights: [
    "Local deterministic release notes for agent update awareness.",
    "Generated instructions now teach capture discernment: use AWG for durable knowledge, not transcript storage.",
    "Quick capture commands create ordinary AWG nodes and optional relates_to edges with run attribution.",
    "Relation discovery, evidence help parity, template authoring guidance, and compact handoff improve first-use ergonomics."
  ],
  newCommands: [
    "awg release notes [--json]",
    "awg release current [--json]",
    "awg quick note|task|risk|question|decision ... [--json]",
    "awg rels [--json]",
    "awg template scaffold --title \"...\" [--scope vault|project] [--json]",
    "awg handoff --compact"
  ],
  agentActions: [
    "Run awg release current after install or upgrade to learn current local capabilities.",
    "Use awg quick for small durable captures; use full awg add/update when structured detail matters.",
    "Run awg rels before adding unfamiliar edge relations.",
    "Attach evidence with --source, --command, --status, --target, and --summary when making verification claims."
  ],
  adoption: [
    "Regenerate AGENTS/CLAUDE instructions with awg instructions install or awg upgrade --instructions when appropriate.",
    "Keep setup/install guidance on the stable local awg command path; defer package self-update until distribution is stable.",
    "Use template scaffold as a starting point for vault-local operating templates, then edit the generated node."
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
    "No hosted sync, daemon, MCP, vector search, plugin execution, transcript ingestion, external memory sync, or package self-update command."
  ]
}];

export function currentReleaseNote(): ReleaseNote {
  return RELEASE_NOTES[0];
}
