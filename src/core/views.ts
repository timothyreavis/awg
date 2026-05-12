import { AWG_VERSION } from "./constants.js";
import type { AwgNode, CurrentViewOutput, DiagnosticsSummary } from "./types.js";

export function buildCurrentView(nodes: AwgNode[], diagnostics: DiagnosticsSummary, generatedAt: string): CurrentViewOutput {
  const attention = nodes.filter((n) => ["blocked", "needs_review", "stale"].includes(n.status));
  return {
    awg: AWG_VERSION,
    kind: "view-output",
    id: "v:current",
    generated_at: generatedAt,
    title: "Current Review",
    blocks: [
      { type: "summary", title: "Graph Health", summary: diagnostics },
      { type: "attention-required", title: "Attention Required", items: attention },
      { type: "decision-review", title: "Open Decisions", items: nodes.filter((n) => n.type === "decision" && !["resolved", "archived", "rejected"].includes(n.status)) },
      { type: "task-review", title: "Active Tasks", items: nodes.filter((n) => n.type === "task" && ["active", "blocked", "in_progress", "needs_review"].includes(n.status)) },
      { type: "risk-review", title: "Active Risks", items: nodes.filter((n) => n.type === "risk" && !["resolved", "archived"].includes(n.status)) },
      { type: "question-review", title: "Open Questions", items: nodes.filter((n) => n.type === "question" && !["resolved", "completed", "archived"].includes(n.status)) },
      { type: "node-list", title: "Node Browser", items: nodes },
      { type: "diagnostics", title: "Diagnostics", summary: diagnostics }
    ]
  };
}
