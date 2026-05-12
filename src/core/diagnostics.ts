import { isPastDate } from "../util/time.js";
import type { AwgEdge, AwgNode, AwgResponse, Diagnostic, DiagnosticsSummary } from "./types.js";

export function buildDiagnostics(
  nodes: AwgNode[],
  edges: AwgEdge[],
  responses: AwgResponse[],
  existing: Diagnostic[],
  strict: boolean
): { diagnostics: Diagnostic[]; summary: DiagnosticsSummary; recommended: string[] } {
  const diagnostics = [...existing];
  const severity = (code: string): "fatal" | "warning" => strict ? "fatal" : "warning";
  const nodeIds = new Set(nodes.map((node) => node.id));
  const linked = new Set<string>();
  const edgeKeys = new Map<string, string>();

  for (const edge of edges) {
    linked.add(edge.from);
    linked.add(edge.to);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      diagnostics.push({
        severity: strict ? "fatal" : "warning",
        code: "dangling_edge",
        message: `Edge ${edge.id} references missing node(s): ${edge.from} -> ${edge.to}`,
        id: edge.id
      });
    }
    const key = `${edge.from}\0${edge.rel}\0${edge.to}`;
    const prior = edgeKeys.get(key);
    if (prior && prior !== edge.id) diagnostics.push({ severity: severity("duplicate_edge"), code: "duplicate_edge", message: `Duplicate edge relation ${edge.from} ${edge.rel} ${edge.to}`, id: edge.id });
    edgeKeys.set(key, edge.id);
  }

  const aliases = new Map<string, string>();
  for (const node of nodes) {
    if (!linked.has(node.id)) diagnostics.push({ severity: severity("orphan_node"), code: "orphan_node", message: `Node has no graph edges: ${node.id}`, id: node.id });
    if (node.review_after && isPastDate(node.review_after)) diagnostics.push({ severity: severity("stale_node"), code: "stale_node", message: `Node review_after is past: ${node.id}`, id: node.id });
    if (node.type === "task" && node.status === "completed" && (!Array.isArray(node.evidence) || node.evidence.length === 0)) {
      diagnostics.push({ severity: severity("completed_task_without_evidence"), code: "completed_task_without_evidence", message: `Completed task has no evidence: ${node.id}`, id: node.id });
    }
    if (node.type === "question" && !["resolved", "completed", "archived"].includes(node.status)) {
      diagnostics.push({ severity: severity("unanswered_question"), code: "unanswered_question", message: `Question is still open: ${node.id}`, id: node.id });
    }
    if (node.status === "active" && node.confidence < 0.4) {
      diagnostics.push({ severity: severity("low_confidence_active"), code: "low_confidence_active", message: `Active node has low confidence: ${node.id}`, id: node.id });
    }
    for (const alias of [node.title, ...(node.aliases ?? [])]) {
      const normalized = alias.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const prior = aliases.get(normalized);
      if (prior && prior !== node.id) diagnostics.push({ severity: severity("duplicate_alias"), code: "duplicate_alias", message: `Duplicate-looking title/alias "${alias}" also used by ${prior}`, id: node.id });
      aliases.set(normalized, node.id);
    }
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (edge.rel === "blocks" && from?.type === "task" && from.status === "blocked" && to && ["completed", "resolved"].includes(to.status)) {
      diagnostics.push({ severity: severity("blocked_by_resolved"), code: "blocked_by_resolved", message: `Blocked task references completed/resolved blocker: ${from.id}`, id: from.id });
    }
    if (edge.rel === "implements" && to?.type === "decision" && to.status === "proposed") {
      diagnostics.push({ severity: severity("decision_implemented_while_proposed"), code: "decision_implemented_while_proposed", message: `Decision is implemented but still proposed: ${to.id}`, id: to.id });
    }
  }

  const fatal_error_count = diagnostics.filter((d) => d.severity === "fatal").length;
  const warning_count = diagnostics.filter((d) => d.severity === "warning").length;
  const summary: DiagnosticsSummary = {
    ok: fatal_error_count === 0,
    fatal_error_count,
    warning_count,
    node_count: nodes.length,
    edge_count: edges.length,
    orphan_node_count: diagnostics.filter((d) => d.code === "orphan_node").length,
    stale_node_count: diagnostics.filter((d) => d.code === "stale_node").length,
    unverified_completion_count: diagnostics.filter((d) => d.code === "completed_task_without_evidence").length,
    dangling_edge_count: diagnostics.filter((d) => d.code === "dangling_edge").length,
    unanswered_question_count: diagnostics.filter((d) => d.code === "unanswered_question").length
  };

  const recommended: string[] = [];
  if (summary.fatal_error_count) recommended.push("Fix fatal validation errors, then run awg build again.");
  if (summary.dangling_edge_count) recommended.push("Create missing nodes or remove/supersede dangling edges.");
  if (summary.stale_node_count) recommended.push("Review stale nodes and update freshness metadata.");
  if (summary.unverified_completion_count) recommended.push("Add evidence to completed task nodes.");
  if (responses.length === 0 && nodes.length > 0) recommended.push("Capture important human feedback as AWG responses when decisions change.");

  return { diagnostics, summary, recommended };
}
