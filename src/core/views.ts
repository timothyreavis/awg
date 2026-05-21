import { AWG_VERSION } from "./constants.js";
import { validateViewBlocks } from "./blocks.js";
import type { AttentionIndex, AuthoredViewOutput, AwgNode, AwgView, CurrentViewOutput, Diagnostic, DiagnosticsSummary } from "./types.js";

export function buildCurrentView(nodes: AwgNode[], diagnostics: DiagnosticsSummary, generatedAt: string, attentionIndex?: AttentionIndex): CurrentViewOutput {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const attention = attentionIndex?.items.filter((item) => ["current", "stale_open"].includes(item.baseAttentionState)).slice(0, 30).map((item) => {
    const node = nodeById.get(item.nodeId);
    return node ? { ...node, attention: item } : undefined;
  }).filter(Boolean) ?? nodes.filter((n) => ["blocked", "needs_review", "stale"].includes(n.status));
  const attentionByNode = new Map((attentionIndex?.items ?? []).map((item) => [item.nodeId, item]));
  const visibleOpen = (node: AwgNode): boolean => {
    const state = attentionByNode.get(node.id)?.baseAttentionState;
    return !["historical", "acknowledged_open", "stale_open", "closeout_candidate"].includes(state ?? "");
  };
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
      { type: "task-review", title: "Active Tasks", items: nodes.filter((n) => n.type === "task" && ["active", "blocked", "in_progress", "needs_review"].includes(n.status) && visibleOpen(n)) },
      { type: "risk-review", title: "Active Risks", items: nodes.filter((n) => n.type === "risk" && !["resolved", "archived"].includes(n.status) && visibleOpen(n)) },
      { type: "question-review", title: "Open Questions", items: nodes.filter((n) => n.type === "question" && !["resolved", "completed", "archived"].includes(n.status) && visibleOpen(n)) },
      { type: "node-list", title: "Node Browser", items: nodes },
      { type: "diagnostics", title: "Diagnostics", summary: diagnostics }
    ]
  };
}

export function buildAuthoredViewOutputs(views: AwgView[], diagnostics: Diagnostic[], generatedAt: string): AuthoredViewOutput[] {
  const diagnosticsByView = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (!diagnostic.id) continue;
    const list = diagnosticsByView.get(diagnostic.id) ?? [];
    list.push(diagnostic);
    diagnosticsByView.set(diagnostic.id, list);
  }
  return views.map((view) => ({
    awg: AWG_VERSION,
    kind: "view-output",
    id: view.id,
    generated_at: generatedAt,
    title: view.title,
    summary: typeof view.summary === "string" ? view.summary : undefined,
    audience: view.audience ?? "human",
    tags: Array.isArray(view.tags) ? view.tags : undefined,
    blocks: Array.isArray(view.blocks) ? view.blocks : [],
    source: { kind: "view", id: view.id },
    diagnostics: diagnosticsByView.get(view.id) ?? []
  }));
}

export function validateAuthoredViews(views: AwgView[], severity: Diagnostic["severity"] = "warning"): Diagnostic[] {
  return views.flatMap((view) => validateViewBlocks(view, severity));
}
