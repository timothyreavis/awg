import { createHash } from "node:crypto";
import { AWG_VERSION } from "./constants.js";
import { hasEvidenceReference } from "./evidence.js";
import { buildRuns } from "./runs.js";
import type { AwgEdge, AwgNode, CompiledGraph, Diagnostic, MaintenanceInbox, MaintenanceInboxItem, MaintenanceInboxKind, MaintenanceInboxSeverity } from "./types.js";

const ACTIVE_ATTENTION = new Set(["active", "blocked", "in_progress", "proposed", "stale"]);
const CLOSED = new Set(["completed", "resolved", "archived", "rejected", "superseded"]);
const DUPLICATE_RECONCILIATION_RELS = new Set(["duplicate_of", "canonical_for"]);

export function buildMaintenanceInbox(graph: CompiledGraph): MaintenanceInbox {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map<string, AwgEdge[]>();
  const linked = new Set<string>();
  for (const edge of graph.edges) {
    if (countsAsGraphLink(edge)) {
      linked.add(edge.from);
      linked.add(edge.to);
    }
    const incoming = incomingByTarget.get(edge.to) ?? [];
    incoming.push(edge);
    incomingByTarget.set(edge.to, incoming);
  }
  const items: MaintenanceInboxItem[] = [];
  const add = (input: Omit<MaintenanceInboxItem, "id" | "nodeIds" | "edgeIds" | "runIds" | "vaultIds" | "relationshipIds" | "reasons" | "suggestedCommands" | "autonomousSafe" | "needsHumanReview"> & Partial<MaintenanceInboxItem>): void => {
    const nodeIds = sorted(input.nodeIds ?? []);
    const edgeIds = sorted(input.edgeIds ?? []);
    const runIds = sorted(input.runIds ?? []);
    const vaultIds = sorted(input.vaultIds ?? []);
    const relationshipIds = sorted(input.relationshipIds ?? []);
    const keyTargets = [...nodeIds, ...edgeIds, ...runIds, ...vaultIds, ...relationshipIds];
    items.push({
      id: inboxItemId(input.kind, input.code, keyTargets.length ? keyTargets : [input.message]),
      nodeIds,
      edgeIds,
      runIds,
      vaultIds,
      relationshipIds,
      reasons: sorted(input.reasons ?? []),
      suggestedCommands: input.suggestedCommands ?? [],
      autonomousSafe: input.autonomousSafe ?? false,
      needsHumanReview: input.needsHumanReview ?? true,
      kind: input.kind,
      code: input.code,
      severity: input.severity,
      priority: clampPriority(input.priority),
      message: input.message
    });
  };

  const duplicateReconciledNodeIds = reconciledDuplicateNodeIds(graph.edges);
  for (const diagnostic of graph.diagnostics.diagnostics) addDiagnosticItem(diagnostic, add, duplicateReconciledNodeIds);

  for (const node of graph.nodes) {
    if (node.status === "needs_review") {
      add({
        kind: "needs_review",
        code: "AWG_INBOX_NEEDS_REVIEW_NODE",
        severity: "warning",
        priority: importancePriority(node, 68),
        message: `Node needs review: ${node.title}`,
        nodeIds: [node.id],
        reasons: ["status is needs_review"],
        suggestedCommands: [`awg node show ${node.id} --json`, `awg update node ${node.id} --status active`],
        autonomousSafe: false,
        needsHumanReview: true
      });
    }
    if (node.type === "risk" && ACTIVE_ATTENTION.has(node.status) && !isIntentionallyOpen(graph, node)) {
      add({ kind: "risks", code: "AWG_INBOX_ACTIVE_RISK", severity: "warning", priority: importancePriority(node, 82), message: `Active risk requires attention: ${node.title}`, nodeIds: [node.id], reasons: [`risk status is ${node.status}`], suggestedCommands: [`awg node show ${node.id} --json`, `awg update node ${node.id} --status needs_review`], autonomousSafe: false, needsHumanReview: true });
    }
    if (node.type === "blocker" && ACTIVE_ATTENTION.has(node.status) && !isIntentionallyOpen(graph, node)) {
      add({ kind: "blockers", code: "AWG_INBOX_ACTIVE_BLOCKER", severity: "warning", priority: importancePriority(node, 86), message: `Active blocker requires attention: ${node.title}`, nodeIds: [node.id], reasons: [`blocker status is ${node.status}`], suggestedCommands: [`awg node show ${node.id} --json`, `awg update node ${node.id} --status needs_review`], autonomousSafe: false, needsHumanReview: true });
    }
    if (node.type === "question" && !CLOSED.has(node.status)) {
      add({ kind: "questions", code: "AWG_INBOX_OPEN_QUESTION", severity: "info", priority: importancePriority(node, 52), message: `Question is still open: ${node.title}`, nodeIds: [node.id], reasons: [`question status is ${node.status}`], suggestedCommands: [`awg node show ${node.id} --json`, `awg update node ${node.id} --status resolved`], autonomousSafe: false, needsHumanReview: true });
    }
    if (node.type === "decision" && ["draft", "proposed", "needs_review"].includes(node.status)) {
      const implemented = graph.edges.some((edge) => edge.rel === "implements" && edge.to === node.id);
      add({ kind: "decisions", code: implemented ? "AWG_INBOX_PROPOSED_DECISION_IMPLEMENTED" : "AWG_INBOX_OPEN_DECISION", severity: implemented ? "warning" : "info", priority: importancePriority(node, implemented ? 76 : 50), message: implemented ? `Implemented decision is still proposed: ${node.title}` : `Decision remains open: ${node.title}`, nodeIds: [node.id], edgeIds: graph.edges.filter((edge) => edge.rel === "implements" && edge.to === node.id).map((edge) => edge.id), reasons: implemented ? ["decision has incoming implements edge but status is not accepted/resolved"] : [`decision status is ${node.status}`], suggestedCommands: [`awg node show ${node.id} --json`, `awg update node ${node.id} --status accepted`], autonomousSafe: false, needsHumanReview: true });
    }
    if (node.type === "task" && node.status === "completed" && !hasEvidenceReference(node, incomingByTarget.get(node.id) ?? [], nodes)) {
      add({ kind: "evidence", code: "AWG_INBOX_COMPLETED_TASK_WITHOUT_EVIDENCE", severity: "warning", priority: importancePriority(node, 88), message: `Completed task has no evidence: ${node.title}`, nodeIds: [node.id], reasons: ["task status is completed and no evidence is linked"], suggestedCommands: [`awg add evidence --target ${node.id} --summary "..." --source terminal`], autonomousSafe: false, needsHumanReview: true });
    }
    if (!linked.has(node.id) && !isHiddenFromMaintenance(node)) {
      add({ kind: "orphans", code: "AWG_INBOX_ORPHAN_NODE", severity: "warning", priority: importancePriority(node, 58), message: `Node has no graph edges: ${node.title}`, nodeIds: [node.id], reasons: ["node has no incoming or outgoing edges"], suggestedCommands: [`awg add edge --from ${node.id} --rel relates_to --to <related-node-id>`], autonomousSafe: false, needsHumanReview: true });
    }
  }

  for (const duplicate of duplicateCandidates(graph.nodes, graph.edges)) {
    add({ kind: "duplicates", code: "AWG_INBOX_DUPLICATE_CANDIDATE", severity: "info", priority: 62, message: `Duplicate-looking nodes: ${duplicate.ids.join(", ")}`, nodeIds: duplicate.ids, reasons: [`normalized title/alias match: ${duplicate.key}`], suggestedCommands: [`awg reconcile duplicate ${duplicate.ids[0]} ${duplicate.ids[1]} --canonical ${duplicate.ids[0]} --reason "..."`], autonomousSafe: false, needsHumanReview: true });
  }

  for (const run of buildRuns(graph)) {
    if (run.status === "completed" && !run.evidence.length && !run.changed_nodes.length) {
      add({ kind: "hygiene", code: "AWG_INBOX_COMPLETED_RUN_WITHOUT_EVIDENCE_OR_CHANGES", severity: "warning", priority: 74, message: `Completed run has no evidence or changed nodes: ${run.id}`, runIds: [run.id], reasons: ["run finished completed without durable changed nodes or evidence"], suggestedCommands: [`awg run status --json`], autonomousSafe: false, needsHumanReview: true });
    }
  }

  const sortedItems = dedupeItems(items).sort(compareInboxItems);
  return {
    awg: AWG_VERSION,
    generated_at: graph.generated_at,
    items: sortedItems,
    summary: {
      total: sortedItems.length,
      byKind: countBy(sortedItems, "kind"),
      bySeverity: countBy(sortedItems, "severity"),
      highPriority: sortedItems.filter((item) => item.priority >= 80).length
    }
  };
}

function countsAsGraphLink(edge: AwgEdge): boolean {
  return edge.rel !== "intentionally_open";
}

export function filterInboxItems(inbox: MaintenanceInbox | undefined, options: { kind?: string; limit?: number; nodeIds?: string[]; runIds?: string[]; query?: string } = {}): MaintenanceInboxItem[] {
  let items = inbox?.items ?? [];
  if (options.kind) items = items.filter((item) => item.kind === options.kind);
  if (options.nodeIds?.length) {
    const ids = new Set(options.nodeIds);
    items = items.filter((item) => item.nodeIds.some((id) => ids.has(id)));
  }
  if (options.runIds?.length) {
    const ids = new Set(options.runIds);
    items = items.filter((item) => item.runIds.some((id) => ids.has(id)));
  }
  if (options.query) {
    const query = options.query.toLowerCase();
    items = items.filter((item) => [item.id, item.kind, item.code, item.message, ...item.nodeIds, ...item.reasons].some((value) => value.toLowerCase().includes(query)));
  }
  return items.slice(0, Math.max(0, options.limit ?? items.length));
}

function addDiagnosticItem(diagnostic: Diagnostic, add: (item: Omit<MaintenanceInboxItem, "id" | "nodeIds" | "edgeIds" | "runIds" | "vaultIds" | "relationshipIds" | "reasons" | "suggestedCommands" | "autonomousSafe" | "needsHumanReview"> & Partial<MaintenanceInboxItem>) => void, duplicateReconciledNodeIds: Set<string>): void {
  const severity = diagnostic.severity === "fatal" ? "error" : diagnostic.severity;
  const base = diagnostic.severity === "fatal" ? 100 : 64;
  const id = diagnostic.id;
  const edgeIds = id?.startsWith("e:") ? [id] : [];
  const nodeIds = id?.startsWith("n:") ? [id] : [];
  const runIds = id?.startsWith("run:") ? [id] : [];
  if (diagnostic.code === "stale_node") add({ kind: "stale", code: "AWG_INBOX_STALE_NODE", severity, priority: 78, message: diagnostic.message, nodeIds, reasons: ["doctor reported stale_node"], suggestedCommands: id ? [`awg update node ${id} --status needs_review`] : [], autonomousSafe: true, needsHumanReview: false });
  else if (diagnostic.code === "orphan_node") add({ kind: "orphans", code: "AWG_INBOX_ORPHAN_NODE", severity, priority: 58, message: diagnostic.message, nodeIds, reasons: ["doctor reported orphan_node"], suggestedCommands: id ? [`awg add edge --from ${id} --rel relates_to --to <related-node-id>`] : [] });
  else if (diagnostic.code === "completed_task_without_evidence") add({ kind: "evidence", code: "AWG_INBOX_COMPLETED_TASK_WITHOUT_EVIDENCE", severity, priority: 88, message: diagnostic.message, nodeIds, reasons: ["doctor reported completed_task_without_evidence"], suggestedCommands: id ? [`awg add evidence --target ${id} --summary "..." --source terminal`] : [] });
  else if (diagnostic.code === "unanswered_question") add({ kind: "questions", code: "AWG_INBOX_OPEN_QUESTION", severity, priority: 52, message: diagnostic.message, nodeIds, reasons: ["doctor reported unanswered_question"], suggestedCommands: id ? [`awg update node ${id} --status resolved`] : [] });
  else if (diagnostic.code === "duplicate_alias") {
    if (nodeIds.some((nodeId) => duplicateReconciledNodeIds.has(nodeId))) return;
    add({ kind: "duplicates", code: "AWG_INBOX_DUPLICATE_SIGNAL", severity, priority: 66, message: diagnostic.message, nodeIds, reasons: [`doctor reported ${diagnostic.code}`], suggestedCommands: ["Use `awg search` and `awg reconcile duplicate ...` after review."] });
  }
  else if (diagnostic.code === "duplicate_id_upsert") {
    add({
      kind: "hygiene",
      code: "AWG_INBOX_DUPLICATE_ID_UPSERT",
      severity,
      priority: nodeIds.length ? 66 : 60,
      message: diagnostic.message,
      nodeIds,
      edgeIds,
      runIds,
      reasons: ["doctor reported duplicate_id_upsert"],
      suggestedCommands: nodeIds.map((nodeId) => `awg node show ${nodeId} --json`),
      autonomousSafe: false,
      needsHumanReview: true
    });
  }
  else if (diagnostic.code.startsWith("topology_") || diagnostic.code === "invalid_cross_vault_refs") add({ kind: "topology", code: "AWG_INBOX_TOPOLOGY_WARNING", severity, priority: 72, message: diagnostic.message, nodeIds, edgeIds, reasons: [`doctor reported ${diagnostic.code}`], suggestedCommands: ["awg vault topology --json"] });
  else if (["freshness_status_conflict", "current_node_missing_verification"].includes(diagnostic.code)) add({ kind: "hygiene", code: "AWG_INBOX_FRESHNESS_REPAIR", severity, priority: 70, message: diagnostic.message, nodeIds, reasons: [`doctor reported ${diagnostic.code}`], suggestedCommands: id ? [`awg update node ${id} --status needs_review`] : [] });
  else if (diagnostic.severity === "fatal") add({ kind: "hygiene", code: "AWG_INBOX_FATAL_DIAGNOSTIC", severity: "error", priority: base, message: diagnostic.message, nodeIds, edgeIds, runIds, reasons: [`fatal diagnostic ${diagnostic.code}`], suggestedCommands: ["awg doctor --fix-suggestions --json"] });
}

function inboxItemId(kind: MaintenanceInboxKind, code: string, targets: string[]): string {
  const digest = createHash("sha256").update([kind, code, ...targets].join("\0")).digest("hex").slice(0, 16);
  return `mi:${digest}`;
}

function compareInboxItems(a: MaintenanceInboxItem, b: MaintenanceInboxItem): number {
  const severityRank: Record<MaintenanceInboxSeverity, number> = { error: 3, warning: 2, info: 1 };
  return b.priority - a.priority || severityRank[b.severity] - severityRank[a.severity] || a.kind.localeCompare(b.kind) || a.code.localeCompare(b.code) || a.id.localeCompare(b.id);
}

function dedupeItems(items: MaintenanceInboxItem[]): MaintenanceInboxItem[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function countBy<T extends MaintenanceInboxItem>(items: T[], key: "kind" | "severity"): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[String(item[key])] = (out[String(item[key])] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function sorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function clampPriority(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function importancePriority(node: AwgNode, base: number): number {
  return clampPriority(base + Math.round((node.importance - 0.5) * 20));
}

function isHiddenFromMaintenance(node: AwgNode): boolean {
  const fields = node.fields ?? {};
  return fields.maintenance === "hidden" || fields.diagnosticVisibility === "hidden" || (node.tags ?? []).includes("demo") || (node.tags ?? []).includes("example:hidden");
}

function duplicateCandidates(nodes: AwgNode[], edges: AwgEdge[]): Array<{ key: string; ids: string[] }> {
  const reconciled = reconciledDuplicateNodeIds(edges);
  const byKey = new Map<string, string[]>();
  for (const node of nodes) {
    if (CLOSED.has(node.status) || reconciled.has(node.id)) continue;
    for (const label of [node.title, ...(node.aliases ?? [])]) {
      const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!key || key.length < 6) continue;
      const ids = byKey.get(key) ?? [];
      ids.push(node.id);
      byKey.set(key, ids);
    }
  }
  return [...byKey.entries()].filter(([, ids]) => new Set(ids).size > 1).map(([key, ids]) => ({ key, ids: sorted(ids).slice(0, 4) })).sort((a, b) => a.key.localeCompare(b.key));
}

function reconciledDuplicateNodeIds(edges: AwgEdge[]): Set<string> {
  const reconciled = new Set<string>();
  for (const edge of edges) if (DUPLICATE_RECONCILIATION_RELS.has(edge.rel)) {
    reconciled.add(edge.from);
    reconciled.add(edge.to);
  }
  return reconciled;
}

function isIntentionallyOpen(graph: CompiledGraph, node: AwgNode): boolean {
  return graph.edges.some((edge) => edge.rel === "intentionally_open" && edge.from === node.id && edge.to === node.id && Boolean(edge.reason) && edge.created_at >= node.updated_at);
}
