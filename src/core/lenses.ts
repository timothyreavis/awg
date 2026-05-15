import { AWG_VERSION } from "./constants.js";
import type { AwgNode, AwgResponse, DiagnosticsSummary, MaintenanceInboxItem, ResumeLensOutput } from "./types.js";

export function buildResumeLens(nodes: AwgNode[], responses: AwgResponse[], diagnostics: DiagnosticsSummary, recommended: string[], generatedAt: string, inboxItems: MaintenanceInboxItem[] = []): ResumeLensOutput {
  const active = (node: AwgNode) => !["archived", "rejected", "superseded"].includes(node.status);
  return {
    awg: AWG_VERSION,
    kind: "lens-output",
    id: "lens:resume",
    generated_at: generatedAt,
    summary: `${nodes.length} nodes, ${diagnostics.edge_count} edges, ${diagnostics.warning_count} warnings, ${diagnostics.fatal_error_count} fatal errors.`,
    important: nodes.filter((n) => active(n) && n.importance >= 0.7).slice(0, 20),
    open_decisions: nodes.filter((n) => n.type === "decision" && ["draft", "proposed", "active", "needs_review"].includes(n.status)).slice(0, 20),
    active_tasks: nodes.filter((n) => n.type === "task" && ["active", "blocked", "in_progress", "needs_review"].includes(n.status)).slice(0, 20),
    active_risks: nodes.filter((n) => n.type === "risk" && active(n)).slice(0, 20),
    unanswered_questions: nodes.filter((n) => n.type === "question" && !["resolved", "completed", "archived"].includes(n.status)).slice(0, 20),
    recent_responses: responses.slice(-10).reverse(),
    diagnostics_summary: diagnostics,
    recommended_maintenance: recommended.slice(0, 8),
    maintenance_inbox: inboxItems
  };
}
