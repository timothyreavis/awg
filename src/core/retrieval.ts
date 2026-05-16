import { AWG_VERSION } from "./constants.js";
import { budgetSections, type BudgetedSection } from "./budget.js";
import { searchGraph } from "./search.js";
import { buildOperatingTemplateIndex } from "./operatingTemplates.js";
import { activeRun, buildRuns, recentRuns, type AgentRun } from "./runs.js";
import { preflightRun, qualityForRun, runSummaryFor, type HandoffQuality, type RunPreflightResult } from "./runPreflight.js";
import { topologyRelevant, type TopologyIndex } from "./topology.js";
import { filterInboxItems } from "./maintenance.js";
import { filterWorkQueueItems } from "./workQueues.js";
import type { AwgEdge, AwgNode, AwgResponse, CompiledGraph, Diagnostic, DiagnosticsSummary } from "./types.js";

export interface TaskLensOutput {
  awg: string;
  kind: "lens-output";
  id: "lens:task";
  generated_at: string;
  goal: string;
  budget?: number;
  sections: Array<BudgetedSection<unknown>>;
  runContext?: unknown;
}

export interface HandoffOutput {
  awg: string;
  kind: "handoff";
  generated_at: string;
  budget?: number;
  sections: Array<BudgetedSection<unknown>>;
  run?: AgentRun;
  preflight?: RunPreflightResult;
  quality?: HandoffQuality;
  topology?: unknown;
}

export interface RecentOutput {
  awg: string;
  kind: "recent";
  generated_at: string;
  days: number;
  run?: string;
  runs: AgentRun[];
  run_notes: Array<{ run: string; at: string; by: string; summary: string }>;
  nodes: AwgNode[];
  evidence: AwgNode[];
  responses: AwgResponse[];
  status_changes: Array<{ id: string; status: string; updated_at: string }>;
  diagnostics: Diagnostic[];
}

const actionable = new Set(["active", "blocked", "in_progress", "needs_review", "proposed", "stale"]);

export function buildTaskLens(graph: CompiledGraph, goal: string, budget?: number): TaskLensOutput {
  const matches = searchGraph(graph, goal, { limit: 12 });
  const matchedIds = new Set(matches.map((match) => match.id));
  const relatedIds = relatedNodeIds(graph.edges, matchedIds, 2);
  const relevantIds = new Set([...matchedIds, ...relatedIds]);
  const node = (id: string) => graph.nodes.find((item) => item.id === id);
  const related = [...relatedIds].map(node).filter(Boolean) as AwgNode[];
  const relevantNodes = [...relevantIds].map(node).filter(Boolean) as AwgNode[];
  const diagnostics = graph.diagnostics.diagnostics.filter((diag) => diag.id && relevantIds.has(diag.id)).sort(bySeverity);
  const maintenanceInbox = filterInboxItems(graph.maintenance_inbox, { nodeIds: [...relevantIds], limit: 10 });
  const workQueueItems = filterWorkQueueItems(graph.work_queue_index, { goal, graph }).filter((item) => !item.nodeIds.length || item.nodeIds.some((id) => relevantIds.has(id))).slice(0, 10);
  const claimIssues = (graph.claim_index?.claims ?? []).filter((claim) => relevantIds.has(claim.id) && (claim.diagnostics.length || ["unverified", "contradicted", "stale", "expired"].includes(claim.verificationStatus))).slice(0, 10);
  const evidence = graph.nodes.filter((item) => item.type === "evidence" && graph.edges.some((edge) => edge.from === item.id && relevantIds.has(edge.to))).sort(byUpdatedDesc).slice(0, 10);
  const runs = buildRuns(graph);
  const current = activeRun(runs);
  const relatedRuns = runs.filter((run) => runMatchesGoal(run, goal) || runSummaryFor(graph, run.id)?.touchedNodeIds.some((id) => relevantIds.has(id))).slice(0, 5);
  const topologyItems = topologyRelevant(graph.topology as TopologyIndex | undefined, goal, [...relevantIds, ...(current ? runSummaryFor(graph, current.id)?.touchedNodeIds ?? [] : [])]);
  const decisions = relevantNodes.filter((item) => item.type === "decision").sort(byPriority);
  const risks = relevantNodes.filter((item) => item.type === "risk" || item.type === "blocker").sort(byPriority);
  const tasks = relevantNodes.filter((item) => item.type === "task" && actionable.has(item.status)).sort(byPriority);
  const questions = relevantNodes.filter((item) => item.type === "question" && !["resolved", "completed", "archived"].includes(item.status)).sort(byPriority);
  const sections = budgetSections<unknown>([
    { section: "templateContext", items: [templateContext(graph, goal)] },
    { section: "topology", items: compactTopologyItems(topologyItems) },
    { section: "matches", items: matches },
    { section: "relatedNodes", items: related.sort(byPriority) },
    { section: "relatedDecisions", items: decisions },
    { section: "activeTasks", items: tasks },
    { section: "risksAndBlockers", items: risks },
    { section: "openQuestions", items: questions },
    { section: "activeRun", items: current ? [runWithSummary(graph, current)] : [] },
    { section: "relatedRuns", items: relatedRuns.map((run) => runWithSummary(graph, run)) },
    { section: "relatedRunNotes", items: relatedRuns.flatMap((run) => run.notes.slice(-3).map((note) => ({ run: run.id, ...note }))) },
    { section: "maintenanceInbox", items: maintenanceInbox },
    { section: "workQueues", items: workQueueItems },
    { section: "claimTrustIssues", items: claimIssues },
    { section: "diagnostics", items: diagnostics },
    { section: "anchors", items: relatedAnchorEntries(graph, relevantIds).slice(0, 10) },
    { section: "recentEvidence", items: evidence }
  ], budget, renderItem).filter((section) => !budget || section.items.length || section.omitted);
  return { awg: AWG_VERSION, kind: "lens-output", id: "lens:task", generated_at: graph.generated_at, goal, budget, sections, runContext: { activeRunId: current?.id, relatedRunIds: relatedRuns.map((run) => run.id) } };
}

export function buildHandoff(graph: CompiledGraph, budget?: number): HandoffOutput {
  const runs = buildRuns(graph);
  const current = activeRun(runs) ?? recentRuns(runs, 1)[0];
  const runSummary = current ? runSummaryFor(graph, current.id) : undefined;
  const preflight = current ? preflightRun(graph, current) : undefined;
  const quality = qualityForRun(graph, current, preflight);
  const runNotes = current ? current.notes.slice(-8).reverse().map((note) => ({ run: current.id, ...note })) : [];
  const activeTasks = graph.nodes.filter((n) => n.type === "task" && actionable.has(n.status)).sort(byPriority).slice(0, 20);
  const openDecisions = graph.nodes.filter((n) => n.type === "decision" && ["draft", "proposed", "active", "needs_review"].includes(n.status)).sort(byPriority).slice(0, 20);
  const blockers = graph.nodes.filter((n) => ["risk", "blocker"].includes(n.type) && actionable.has(n.status)).sort(byPriority).slice(0, 20);
  const recentCompleted = graph.nodes.filter((n) => ["completed", "resolved"].includes(n.status)).sort(byUpdatedDesc).slice(0, 12);
  const recentEvidence = graph.nodes.filter((n) => n.type === "evidence").sort(byUpdatedDesc).slice(0, 12);
  const stale = graph.nodes.filter((n) => ["stale", "needs_review"].includes(n.status)).sort(byPriority).slice(0, 12);
  const recommendations = recommendedNextActions(graph.diagnostics.summary);
  const topologyItems = topologyRelevant(graph.topology as TopologyIndex | undefined, current?.goal, runSummary?.touchedNodeIds ?? []);
  const topologyObject = { currentVault: (graph.topology as TopologyIndex | undefined)?.currentVault ?? null, relatedVaults: compactTopologyItems(topologyItems), crossVaultRefs: ((graph.topology as TopologyIndex | undefined)?.crossVaultRefs ?? []).filter((ref) => (runSummary?.touchedNodeIds ?? []).includes(ref.nodeId)) };
  const maintenanceInbox = filterInboxItems(graph.maintenance_inbox, { limit: 12 });
  const topQueueItems = filterWorkQueueItems(graph.work_queue_index, { limit: 12, includeHumanReview: true });
  const handoffFollowup = filterWorkQueueItems(graph.work_queue_index, { queue: "handoff_followup", limit: 8, includeHumanReview: true });
  const claimTrustIssues = (graph.claim_index?.claims ?? []).filter((claim) => ["unverified", "contradicted", "stale", "expired"].includes(claim.verificationStatus) || claim.nodeStatus === "needs_review").slice(0, 12);
  const sections = budgetSections<unknown>([
    { section: current?.status === "in_progress" ? "activeRun" : "mostRecentRun", items: current ? [current] : [] },
    { section: "graphHealth", items: [graph.diagnostics.summary] },
    { section: "templateContext", items: [templateContext(graph)] },
    { section: "topology", items: topologyObject.relatedVaults },
    { section: "runAttribution", items: runSummary ? [runSummary] : [] },
    { section: "recentRunNotes", items: runNotes },
    { section: "preflightWarnings", items: preflight?.warnings ?? [] },
    { section: "handoffQuality", items: [quality] },
    { section: "recommendedNextActions", items: recommendations },
    { section: "workQueues", items: topQueueItems },
    { section: "handoffFollowup", items: handoffFollowup },
    { section: "maintenanceInbox", items: maintenanceInbox },
    { section: "claimTrustIssues", items: claimTrustIssues },
    { section: "currentFocus", items: activeTasks.slice(0, 3) },
    { section: "activeTasks", items: activeTasks },
    { section: "openDecisions", items: openDecisions },
    { section: "blockersAndRisks", items: blockers },
    { section: "recentCompletedWork", items: recentCompleted },
    { section: "recentEvidence", items: recentEvidence },
    { section: "recentResponses", items: graph.responses.slice(-8).reverse() },
    { section: "anchorImpact", items: current ? relatedAnchorEntries(graph, new Set(runSummary?.touchedNodeIds ?? [])).slice(0, 10) : [] },
    { section: "staleOrNeedsReview", items: stale }
  ], budget, renderItem).filter((section) => !budget || section.items.length || section.omitted);
  const outputQuality = budget ? { ...quality, checks: [] } : quality;
  const output: HandoffOutput = { awg: AWG_VERSION, kind: "handoff", generated_at: graph.generated_at, budget, sections, quality: outputQuality, topology: topologyObject };
  if (!budget) {
    output.run = current;
    output.preflight = preflight;
  }
  return output;
}

function compactTopologyItems(items: ReturnType<typeof topologyRelevant>): unknown[] {
  return items.map((item) => ({ id: item.id, title: item.name, name: item.name, relationships: item.relationships, relationshipSummaries: item.relationshipSummaries, tags: item.tags, whySurfaced: item.whySurfaced, health: item.health, stale: item.stale, summary: item.summary.text, summaryDetail: item.summary }));
}

export function buildRecent(graph: CompiledGraph, days: number, asOf = Date.now(), runId?: string): RecentOutput {
  const cutoff = asOf - Math.max(1, days) * 86_400_000;
  const recentNode = (node: AwgNode) => Date.parse(node.updated_at) >= cutoff || Date.parse(node.created_at) >= cutoff;
  const allRuns = buildRuns(graph);
  const runs = allRuns.filter((run) => (!runId || run.id === runId) && (Date.parse(run.updated_at) >= cutoff || Date.parse(run.started_at) >= cutoff));
  return {
    awg: AWG_VERSION,
    kind: "recent",
    generated_at: graph.generated_at,
    days,
    run: runId,
    runs,
    run_notes: runs.flatMap((run) => run.notes.filter((note) => Date.parse(note.at) >= cutoff).map((note) => ({ run: run.id, at: note.at, by: note.by, summary: note.summary }))),
    nodes: graph.nodes.filter(recentNode).sort(byUpdatedDesc),
    evidence: graph.nodes.filter((node) => node.type === "evidence" && recentNode(node)).sort(byUpdatedDesc),
    responses: graph.responses.filter((response) => Date.parse(response.at) >= cutoff).slice().reverse(),
    status_changes: graph.nodes.filter(recentNode).map((node) => ({ id: node.id, status: node.status, updated_at: node.updated_at })).sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)),
    diagnostics: graph.diagnostics.diagnostics.filter((diag) => diag.severity !== "info")
  };
}

function relatedNodeIds(edges: AwgEdge[], start: Set<string>, depth: number): Set<string> {
  const found = new Set<string>();
  let frontier = new Set(start);
  for (let level = 0; level < depth; level += 1) {
    const next = new Set<string>();
    for (const edge of edges) {
      if (frontier.has(edge.from) && !start.has(edge.to) && !found.has(edge.to)) next.add(edge.to);
      if (frontier.has(edge.to) && !start.has(edge.from) && !found.has(edge.from)) next.add(edge.from);
    }
    for (const id of next) found.add(id);
    frontier = next;
  }
  return found;
}

function recommendedNextActions(summary: DiagnosticsSummary): string[] {
  const out = ["Run awg search before adding duplicate durable context.", "Run awg template status --json when work feels under-specified.", "Use awg lens task --goal \"...\" before focused implementation work.", "Use awg queue next --json when selecting undirected next work."];
  if (summary.fatal_error_count) out.unshift("Fix fatal diagnostics before relying on compiled graph output.");
  if (summary.unverified_completion_count) out.push("Attach evidence to completed task nodes.");
  if (summary.stale_node_count) out.push("Review stale or needs-review nodes.");
  return out;
}

function templateContext(graph: CompiledGraph, goal?: string): unknown {
  const index = goal ? buildOperatingTemplateIndex(graph.nodes, goal) : graph.operating_templates ?? buildOperatingTemplateIndex(graph.nodes);
  return {
    activeTemplateId: index.activeTemplateId,
    selectedTemplate: index.selectedTemplate,
    activeTemplateCount: index.activeTemplates.length,
    conflicts: index.conflicts,
    warnings: index.warnings
  };
}

function relatedAnchorEntries(graph: CompiledGraph, ids: Set<string>): unknown[] {
  if (!ids.size) return [];
  return (graph.anchor_index?.entries ?? []).filter((entry) => entry.nodeIds.some((id) => ids.has(id)));
}

function runMatchesGoal(run: AgentRun, goal: string): boolean {
  const needle = goal.toLowerCase();
  return run.goal.toLowerCase().includes(needle) || run.notes.some((note) => note.summary.toLowerCase().includes(needle));
}

function runWithSummary(graph: CompiledGraph, run: AgentRun): unknown {
  return { ...run, attribution: runSummaryFor(graph, run.id) };
}

function byPriority(a: AwgNode, b: AwgNode): number {
  return Number(actionable.has(b.status)) - Number(actionable.has(a.status)) || b.importance - a.importance || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id);
}

function byUpdatedDesc(a: AwgNode, b: AwgNode): number {
  return b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id);
}

function bySeverity(a: Diagnostic, b: Diagnostic): number {
  const weight = { fatal: 3, warning: 2, info: 1 };
  return weight[b.severity] - weight[a.severity] || (a.id ?? "").localeCompare(b.id ?? "") || a.code.localeCompare(b.code);
}

function renderItem(item: unknown): string {
  const record = item as Record<string, unknown>;
  return [record.id, record.title, record.summary, record.status, record.code, record.message].filter(Boolean).join(" ");
}
