import { evidenceIdsFromNode } from "./evidence.js";
import { runIdFromObject } from "./runAttribution.js";
import type { AwgEdge, AwgNode, AwgResponse, CompiledGraph, Diagnostic } from "./types.js";
import type { RunSummary } from "./runs.js";

export interface NodeDetailRunAttribution {
  directRunId?: string;
  runs: Array<{
    runId: string;
    roles: string[];
    createdEdgeIds: string[];
    responseIds: string[];
    evidenceNodeIds: string[];
    diagnosticCodes: string[];
  }>;
}

export interface NodeDetailOutput {
  ok: true;
  generated_at: string;
  nodeId: string;
  node: AwgNode;
  edges: {
    incoming: AwgEdge[];
    outgoing: AwgEdge[];
  };
  responses: AwgResponse[];
  evidence: {
    nodes: AwgNode[];
    edges: AwgEdge[];
  };
  diagnostics: Diagnostic[];
  runAttribution: NodeDetailRunAttribution;
  history?: {
    snapshotCount: number;
    snapshots: Array<{
      file: string;
      line: number;
      node: AwgNode;
    }>;
  };
}

export function buildNodeDetail(graph: CompiledGraph, nodeId: string): NodeDetailOutput | null {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return null;

  const nodeById = new Map(graph.nodes.map((item) => [item.id, item]));
  const incoming = graph.edges.filter((edge) => edge.to === nodeId).sort(byId);
  const outgoing = graph.edges.filter((edge) => edge.from === nodeId).sort(byId);
  const relatedEdgeIds = new Set([...incoming, ...outgoing].map((edge) => edge.id));
  const responses = graph.responses.filter((response) => response.target === nodeId).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const evidence = evidenceForNode(node, incoming, nodeById);
  const diagnosticIds = new Set([nodeId, ...relatedEdgeIds]);
  const diagnostics = graph.diagnostics.diagnostics.filter((diag) => diag.id && diagnosticIds.has(diag.id)).sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "") || a.code.localeCompare(b.code));

  return {
    ok: true,
    generated_at: graph.generated_at,
    nodeId,
    node,
    edges: { incoming, outgoing },
    responses,
    evidence,
    diagnostics,
    runAttribution: buildNodeRunAttribution(graph, node, relatedEdgeIds, responses, evidence.nodes, diagnostics)
  };
}

function evidenceForNode(node: AwgNode, incoming: AwgEdge[], nodeById: Map<string, AwgNode>): { nodes: AwgNode[]; edges: AwgEdge[] } {
  const evidenceIds = evidenceIdsFromNode(node);
  const edges = incoming.filter((edge) => {
    const from = nodeById.get(edge.from);
    return from?.type === "evidence" || evidenceIds.has(edge.from);
  }).sort(byId);
  for (const edge of edges) evidenceIds.add(edge.from);
  const nodes = [...evidenceIds].map((id) => nodeById.get(id)).filter((item): item is AwgNode => Boolean(item)).sort(byId);
  return { nodes, edges };
}

function buildNodeRunAttribution(graph: CompiledGraph, node: AwgNode, relatedEdgeIds: Set<string>, responses: AwgResponse[], evidenceNodes: AwgNode[], diagnostics: Diagnostic[]): NodeDetailRunAttribution {
  const responseIds = new Set(responses.map((response) => response.id));
  const evidenceNodeIds = new Set(evidenceNodes.map((item) => item.id));
  const diagnosticKeys = new Set(diagnostics.map(diagnosticKey));
  const summaries = normalizeRunSummaries(graph.run_summaries);
  const runs = [];

  for (const summary of summaries) {
    const roles = new Set<string>();
    if (summary.createdNodeIds.includes(node.id)) roles.add("created_node");
    if (summary.updatedNodeIds.includes(node.id)) roles.add("updated_node");
    if (summary.touchedNodeIds.includes(node.id)) roles.add("touched_node");
    if (summary.completedNodeIds.includes(node.id)) roles.add("completed_node");
    if (summary.reviewedNodeIds.includes(node.id)) roles.add("reviewed_node");
    if (summary.evidenceTargetIds.includes(node.id)) roles.add("evidence_target");
    if (summary.evidenceNodeIds.includes(node.id)) roles.add("evidence_node");

    const createdEdgeIds = summary.createdEdgeIds.filter((id) => relatedEdgeIds.has(id)).sort();
    if (createdEdgeIds.length) roles.add("created_related_edge");
    const relatedResponseIds = summary.responseIds.filter((id) => responseIds.has(id)).sort();
    if (relatedResponseIds.length) roles.add("response_target");
    const relatedEvidenceNodeIds = summary.evidenceNodeIds.filter((id) => evidenceNodeIds.has(id)).sort();
    if (relatedEvidenceNodeIds.length) roles.add("added_evidence");
    const relatedDiagnosticCodes = summary.diagnostics.filter((diag) => diagnosticKeys.has(diagnosticKey(diag))).map((diag) => diag.code).sort();
    if (relatedDiagnosticCodes.length) roles.add("diagnostic_affecting_node");

    if (!roles.size) continue;
    runs.push({
      runId: summary.runId,
      roles: [...roles].sort(),
      createdEdgeIds,
      responseIds: relatedResponseIds,
      evidenceNodeIds: relatedEvidenceNodeIds,
      diagnosticCodes: relatedDiagnosticCodes
    });
  }

  return {
    directRunId: runIdFromObject(node),
    runs: runs.sort((a, b) => a.runId.localeCompare(b.runId))
  };
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}

function normalizeRunSummaries(value: unknown): RunSummary[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    runId: typeof item.runId === "string" ? item.runId : "",
    createdNodeIds: stringArray(item.createdNodeIds),
    updatedNodeIds: stringArray(item.updatedNodeIds),
    touchedNodeIds: stringArray(item.touchedNodeIds),
    createdEdgeIds: stringArray(item.createdEdgeIds),
    responseIds: stringArray(item.responseIds),
    viewIds: stringArray(item.viewIds),
    lensIds: stringArray(item.lensIds),
    evidenceNodeIds: stringArray(item.evidenceNodeIds),
    evidenceTargetIds: stringArray(item.evidenceTargetIds),
    completedNodeIds: stringArray(item.completedNodeIds),
    reviewedNodeIds: stringArray(item.reviewedNodeIds),
    diagnostics: Array.isArray(item.diagnostics) ? item.diagnostics.filter(isDiagnostic) : [],
    orphanNodeIds: stringArray(item.orphanNodeIds),
    completedTasksMissingEvidence: stringArray(item.completedTasksMissingEvidence),
    activeRiskOrBlockerIds: stringArray(item.activeRiskOrBlockerIds),
    proposedDecisionIds: stringArray(item.proposedDecisionIds),
    staleOrNeedsReviewNodeIds: stringArray(item.staleOrNeedsReviewNodeIds),
    handoffGenerated: item.handoffGenerated === true,
    handoffIds: stringArray(item.handoffIds)
  })).filter((item) => item.runId);
}

function diagnosticKey(diag: Diagnostic): string {
  return `${diag.id ?? ""}\u0000${diag.code}`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string" && typeof value.severity === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
