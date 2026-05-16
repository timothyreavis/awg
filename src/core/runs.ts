import type { AwgEvent, AwgLens, AwgNode, AwgView, CompiledGraph, Diagnostic } from "./types.js";
import { hasEvidenceReference } from "./evidence.js";
import { runIdFromObject } from "./runAttribution.js";

export const RUN_STATUSES = ["in_progress", "completed", "partial", "blocked", "failed", "abandoned"] as const;
export type RunStatus = typeof RUN_STATUSES[number];

export interface AgentRun {
  id: string;
  goal: string;
  agent?: string;
  status: RunStatus;
  started_at: string;
  updated_at: string;
  finished_at?: string;
  summary?: string;
  notes: RunNote[];
  evidence: string[];
  changed_nodes: string[];
  handoffs: string[];
  attribution?: RunSummary;
}

export interface RunSummary {
  runId: string;
  createdNodeIds: string[];
  updatedNodeIds: string[];
  touchedNodeIds: string[];
  createdEdgeIds: string[];
  responseIds: string[];
  viewIds: string[];
  lensIds: string[];
  evidenceNodeIds: string[];
  evidenceTargetIds: string[];
  completedNodeIds: string[];
  reviewedNodeIds: string[];
  diagnostics: Diagnostic[];
  orphanNodeIds: string[];
  completedTasksMissingEvidence: string[];
  activeRiskOrBlockerIds: string[];
  proposedDecisionIds: string[];
  staleOrNeedsReviewNodeIds: string[];
  handoffGenerated: boolean;
  handoffIds: string[];
}

export interface RunNote {
  id?: string;
  at: string;
  by: string;
  summary: string;
}

export function buildRuns(graph: Pick<CompiledGraph, "events">): AgentRun[] {
  const runs = new Map<string, AgentRun>();
  const events = graph.events.slice().sort((a, b) => a.at.localeCompare(b.at) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
  for (const event of events) {
    if (event.type === "run_started") {
      const runId = String(event.target);
      runs.set(runId, {
        id: runId,
        goal: String(event.goal ?? ""),
        agent: typeof event.agent === "string" ? event.agent : undefined,
        status: "in_progress",
        started_at: event.at,
        updated_at: event.at,
        notes: [],
        evidence: [],
        changed_nodes: [],
        handoffs: []
      });
      continue;
    }
    const runId = runIdFromObject(event) ?? String(event.target);
    const run = runs.get(runId);
    if (!run) continue;
    run.updated_at = event.at > run.updated_at ? event.at : run.updated_at;
    if (event.type === "run_note") {
      run.notes.push({ id: event.id, at: event.at, by: event.by, summary: String(event.summary ?? "") });
    }
    if (event.type === "run_finished") {
      const status = String(event.status);
      run.status = RUN_STATUSES.includes(status as RunStatus) ? status as RunStatus : "partial";
      run.finished_at = event.at;
      run.summary = typeof event.summary === "string" ? event.summary : undefined;
    }
    if (event.type === "evidence_added" && typeof event.evidence === "string") run.evidence.push(event.evidence);
    if (event.type === "node_updated" && typeof event.target === "string") run.changed_nodes.push(event.target);
    if (event.type === "handoff_generated") run.handoffs.push(event.id ?? event.at);
  }
  return [...runs.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
}

export function buildRunSummaries(graph: Pick<CompiledGraph, "nodes" | "edges" | "events" | "responses" | "views" | "lenses" | "diagnostics">): RunSummary[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const summaries = new Map<string, MutableRunSummary>();
  const ensure = (runId: string): MutableRunSummary => {
    let summary = summaries.get(runId);
    if (!summary) {
      summary = {
        runId,
        createdNodeIds: new Set(),
        updatedNodeIds: new Set(),
        touchedNodeIds: new Set(),
        createdEdgeIds: new Set(),
        responseIds: new Set(),
        viewIds: new Set(),
        lensIds: new Set(),
        evidenceNodeIds: new Set(),
        evidenceTargetIds: new Set(),
        completedNodeIds: new Set(),
        reviewedNodeIds: new Set(),
        handoffIds: new Set()
      };
      summaries.set(runId, summary);
    }
    return summary;
  };

  for (const node of graph.nodes) {
    const runId = runIdFromObject(node);
    if (!runId) continue;
    const summary = ensure(runId);
    summary.createdNodeIds.add(node.id);
    summary.touchedNodeIds.add(node.id);
    if (node.type === "evidence") summary.evidenceNodeIds.add(node.id);
    if (["completed", "resolved"].includes(node.status)) summary.completedNodeIds.add(node.id);
    if (["needs_review", "reviewed", "resolved"].includes(node.status)) summary.reviewedNodeIds.add(node.id);
  }
  for (const edge of graph.edges) {
    const runId = runIdFromObject(edge);
    if (!runId) continue;
    const summary = ensure(runId);
    summary.createdEdgeIds.add(edge.id);
    summary.touchedNodeIds.add(edge.from);
    summary.touchedNodeIds.add(edge.to);
    if (byId.get(edge.from)?.type === "evidence") {
      summary.evidenceNodeIds.add(edge.from);
      summary.evidenceTargetIds.add(edge.to);
    }
  }
  for (const response of graph.responses) {
    const runId = runIdFromObject(response);
    if (!runId) continue;
    const summary = ensure(runId);
    summary.responseIds.add(response.id);
    if (typeof response.target === "string" && response.target.startsWith("n:")) summary.touchedNodeIds.add(response.target);
  }
  for (const view of graph.views) {
    const runId = runIdFromObject(view);
    if (!runId) continue;
    ensure(runId).viewIds.add(view.id);
  }
  for (const lens of graph.lenses) {
    const runId = runIdFromObject(lens);
    if (!runId) continue;
    ensure(runId).lensIds.add(lens.id);
  }
  for (const event of graph.events) {
    const runId = runIdFromObject(event);
    if (!runId) continue;
    const summary = ensure(runId);
    if (event.type === "node_created" && typeof event.target === "string") {
      summary.createdNodeIds.add(event.target);
      summary.touchedNodeIds.add(event.target);
    }
    if (event.type === "node_updated" && typeof event.target === "string") {
      summary.updatedNodeIds.add(event.target);
      summary.touchedNodeIds.add(event.target);
    }
    if (event.type === "edge_created" && typeof event.target === "string") {
      summary.createdEdgeIds.add(event.target);
      if (typeof event.from === "string") summary.touchedNodeIds.add(event.from);
      if (typeof event.to === "string") summary.touchedNodeIds.add(event.to);
    }
    if (event.type === "response_added" && typeof event.response === "string") summary.responseIds.add(event.response);
    if (event.type === "view_created" && typeof event.target === "string") summary.viewIds.add(event.target);
    if (event.type === "view_updated" && typeof event.target === "string") summary.viewIds.add(event.target);
    if (event.type === "lens_created" && typeof event.target === "string") summary.lensIds.add(event.target);
    if (event.type === "lens_updated" && typeof event.target === "string") summary.lensIds.add(event.target);
    if (event.type === "response_added" && typeof event.target === "string" && event.target.startsWith("n:")) summary.touchedNodeIds.add(event.target);
    if (event.type === "evidence_added") {
      if (typeof event.evidence === "string") summary.evidenceNodeIds.add(event.evidence);
      if (typeof event.target === "string") {
        summary.evidenceTargetIds.add(event.target);
        summary.touchedNodeIds.add(event.target);
      }
    }
    if (event.type === "handoff_generated") summary.handoffIds.add(event.id ?? event.at);
  }

  const linked = new Set<string>();
  for (const edge of graph.edges) {
    linked.add(edge.from);
    linked.add(edge.to);
  }

  return [...summaries.values()].map((summary) => finalizeRunSummary(summary, graph.nodes, graph.edges, graph.diagnostics.diagnostics, linked)).sort((a, b) => a.runId.localeCompare(b.runId));
}

export function activeRun(runs: AgentRun[]): AgentRun | undefined {
  return runs.find((run) => run.status === "in_progress");
}

export function recentRuns(runs: AgentRun[], limit = 8): AgentRun[] {
  return runs.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)).slice(0, limit);
}

export function runEventId(runId: string, type: string, at: string): string {
  return `ev:${runId.replace(/^run:/, "")}:${type}:${at.replace(/[^0-9]/g, "")}`;
}

interface MutableRunSummary {
  runId: string;
  createdNodeIds: Set<string>;
  updatedNodeIds: Set<string>;
  touchedNodeIds: Set<string>;
  createdEdgeIds: Set<string>;
  responseIds: Set<string>;
  viewIds: Set<string>;
  lensIds: Set<string>;
  evidenceNodeIds: Set<string>;
  evidenceTargetIds: Set<string>;
  completedNodeIds: Set<string>;
  reviewedNodeIds: Set<string>;
  handoffIds: Set<string>;
}

function finalizeRunSummary(summary: MutableRunSummary, nodes: AwgNode[], edges: CompiledGraph["edges"], diagnostics: Diagnostic[], linked: Set<string>): RunSummary {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map<string, CompiledGraph["edges"]>();
  for (const edge of edges) {
    const incoming = incomingByTarget.get(edge.to) ?? [];
    incoming.push(edge);
    incomingByTarget.set(edge.to, incoming);
  }
  const touched = [...summary.touchedNodeIds].filter((id) => nodeById.has(id)).sort();
  const touchedDiagnostics = new Set([...summary.touchedNodeIds, ...summary.lensIds, ...summary.viewIds]);
  const diag = diagnostics.filter((item) => item.id && touchedDiagnostics.has(item.id)).sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "") || a.code.localeCompare(b.code));
  const nodeHasEvidence = (node: AwgNode | undefined) => Boolean(node && hasEvidenceReference(node, incomingByTarget.get(node.id) ?? [], nodeById));
  const active = (node: AwgNode | undefined) => Boolean(node && ["active", "blocked", "in_progress", "needs_review", "proposed", "stale"].includes(node.status));
  return {
    runId: summary.runId,
    createdNodeIds: [...summary.createdNodeIds].filter((id) => nodeById.has(id)).sort(),
    updatedNodeIds: [...summary.updatedNodeIds].filter((id) => nodeById.has(id)).sort(),
    touchedNodeIds: touched,
    createdEdgeIds: [...summary.createdEdgeIds].sort(),
    responseIds: [...summary.responseIds].sort(),
    viewIds: [...summary.viewIds].sort(),
    lensIds: [...summary.lensIds].sort(),
    evidenceNodeIds: [...summary.evidenceNodeIds].filter((id) => nodeById.has(id)).sort(),
    evidenceTargetIds: [...summary.evidenceTargetIds].filter((id) => nodeById.has(id)).sort(),
    completedNodeIds: touched.filter((id) => ["completed", "resolved"].includes(nodeById.get(id)?.status ?? "")),
    reviewedNodeIds: touched.filter((id) => ["needs_review", "reviewed", "resolved"].includes(nodeById.get(id)?.status ?? "")),
    diagnostics: diag,
    orphanNodeIds: [...summary.createdNodeIds].filter((id) => nodeById.has(id) && !linked.has(id)).sort(),
    completedTasksMissingEvidence: touched.filter((id) => nodeById.get(id)?.type === "task" && nodeById.get(id)?.status === "completed" && !nodeHasEvidence(nodeById.get(id))),
    activeRiskOrBlockerIds: touched.filter((id) => ["risk", "blocker"].includes(nodeById.get(id)?.type ?? "") && active(nodeById.get(id))),
    proposedDecisionIds: touched.filter((id) => nodeById.get(id)?.type === "decision" && nodeById.get(id)?.status === "proposed"),
    staleOrNeedsReviewNodeIds: touched.filter((id) => ["stale", "needs_review"].includes(nodeById.get(id)?.status ?? "")),
    handoffGenerated: summary.handoffIds.size > 0,
    handoffIds: [...summary.handoffIds].sort()
  };
}
