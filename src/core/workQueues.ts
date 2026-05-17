import { createHash } from "node:crypto";
import { AWG_VERSION } from "./constants.js";
import { hasEvidenceReference } from "./evidence.js";
import { activeRun, buildRuns, type AgentRun } from "./runs.js";
import type { AwgEdge, AwgNode, ClaimIndexRecord, CompiledGraph, Diagnostic, EvidenceIndexRecord, MaintenanceInboxItem, WorkQueueId, WorkQueueIndex, WorkQueueItem, WorkQueueSeverity, WorkQueueSourceKind } from "./types.js";

export const BUILT_IN_WORK_QUEUES: Array<{ id: WorkQueueId; title: string; description: string }> = [
  { id: "next", title: "Next", description: "Highest-value currently actionable work." },
  { id: "autonomous", title: "Autonomous", description: "Work an agent can do without human review." },
  { id: "human_review", title: "Human Review", description: "Work that should be inspected or approved by a human." },
  { id: "blocked", title: "Blocked", description: "Work blocked by blockers, dependencies, risks, or explicit blocked state." },
  { id: "evidence_needed", title: "Evidence Needed", description: "Completed, claim-bearing, or evidence-required work missing current evidence." },
  { id: "maintenance", title: "Maintenance", description: "Stale, orphan, duplicate, topology, and repair-oriented work." },
  { id: "stale_review", title: "Stale Review", description: "Stale, expired, review-after, and currentness review work." },
  { id: "risk_review", title: "Risk Review", description: "Active risks, blockers, contradictions, and high-risk unresolved items." },
  { id: "handoff_followup", title: "Handoff Follow-Up", description: "Unfinished runs, preflight warnings, and cross-run follow-up." }
];

const ACTIVE = new Set(["active", "blocked", "in_progress", "needs_review", "proposed", "stale"]);
const CLOSED = new Set(["completed", "resolved", "archived", "rejected", "superseded"]);
const SEVERITY_RANK: Record<WorkQueueSeverity, number> = { error: 3, warning: 2, info: 1 };

export function buildWorkQueueIndex(graph: CompiledGraph): WorkQueueIndex {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map<string, AwgEdge[]>();
  for (const edge of graph.edges) {
    const incoming = incomingByTarget.get(edge.to) ?? [];
    incoming.push(edge);
    incomingByTarget.set(edge.to, incoming);
  }
  const activeTouched = activeRunTouchedNodes(graph);
  const items: WorkQueueItem[] = [];
  const add = (queue: WorkQueueId, input: QueueInput): void => {
    const primary = firstNode(input.nodeIds, nodes);
    const reviewAfter = input.reviewAfter ?? primary?.freshness?.review_after ?? primary?.review_after;
    const sourceIds = sorted(input.sourceIds ?? [...(input.nodeIds ?? []), ...(input.runIds ?? []), ...(input.inboxItemIds ?? []), ...(input.claimIds ?? []), ...(input.evidenceIds ?? []), ...(input.vaultIds ?? []), ...(input.relationshipIds ?? [])]);
    const priority = clampPriority((input.priority ?? 50) + (primary ? Math.round((primary.importance - 0.5) * 20) : 0) + (isPast(reviewAfter, graph.generated_at) ? 8 : 0) + (touchesActiveRun(input, activeTouched) ? 5 : 0) - (queue === "autonomous" && input.sourceKind === "inbox" && input.inboxItemIds?.length ? 10 : 0));
    const timestamps = timestampsFor(graph, input, nodes);
    const item: WorkQueueItem = {
      id: workQueueItemId(queue, input.sourceKind, input.sourceCode, {
        sourceIds,
        nodeIds: input.nodeIds,
        edgeIds: input.edgeIds,
        runIds: input.runIds,
        inboxItemIds: input.inboxItemIds,
        claimIds: input.claimIds,
        evidenceIds: input.evidenceIds,
        vaultIds: input.vaultIds,
        relationshipIds: input.relationshipIds
      }),
      queue,
      title: input.title,
      summary: input.summary,
      severity: input.severity ?? "warning",
      priority,
      sourceKind: input.sourceKind,
      sourceCode: input.sourceCode,
      sourceIds,
      nodeIds: sorted(input.nodeIds ?? []),
      edgeIds: sorted(input.edgeIds ?? []),
      runIds: sorted(input.runIds ?? []),
      inboxItemIds: sorted(input.inboxItemIds ?? []),
      claimIds: sorted(input.claimIds ?? []),
      evidenceIds: sorted(input.evidenceIds ?? []),
      vaultIds: sorted(input.vaultIds ?? []),
      relationshipIds: sorted(input.relationshipIds ?? []),
      reasons: sorted(input.reasons ?? []),
      suggestedCommands: input.suggestedCommands ?? [],
      autonomousSafe: Boolean(input.autonomousSafe),
      needsHumanReview: input.needsHumanReview ?? true,
      blocked: Boolean(input.blocked),
      blockedByNodeIds: sorted(input.blockedByNodeIds ?? []),
      reviewAfter,
      createdAt: timestamps.createdAt,
      updatedAt: timestamps.updatedAt
    };
    items.push(item);
  };

  for (const item of graph.maintenance_inbox?.items ?? []) addInboxItems(add, item);
  for (const diagnostic of graph.diagnostics.diagnostics) addDiagnosticItems(add, diagnostic);

  for (const node of graph.nodes) {
    const blockers = graph.edges.filter((edge) => edge.rel === "blocks" && edge.to === node.id && ACTIVE.has(nodes.get(edge.from)?.status ?? ""));
    if (node.type === "task" && ACTIVE.has(node.status) && node.status !== "blocked" && !blockers.length) {
      add("next", nodeInput(node, "node", 70, "info", [`Task status is ${node.status}`], [`awg node show ${node.id} --json`], false, false));
    }
    if (node.type === "task" && (node.status === "blocked" || blockers.length)) {
      const input = nodeInput(node, "node", 92, "warning", [node.status === "blocked" ? "task status is blocked" : "incoming active blocks edge"], [`awg node show ${node.id} --json`], false, true);
      input.blocked = true;
      input.edgeIds = blockers.map((edge) => edge.id);
      input.blockedByNodeIds = blockers.map((edge) => edge.from);
      add("blocked", input);
    }
    if (node.type === "task" && node.status === "completed" && !hasEvidenceReference(node, incomingByTarget.get(node.id) ?? [], nodes)) {
      add("evidence_needed", nodeInput(node, "node", 88, "warning", ["completed task has no linked evidence"], [`awg add evidence --target ${node.id} --summary "..." --source terminal`], false, true));
      add("next", nodeInput(node, "node", 88, "warning", ["completed task needs evidence"], [`awg add evidence --target ${node.id} --summary "..." --source terminal`], false, true));
    }
    if (node.evidence_required && !hasEvidenceReference(node, incomingByTarget.get(node.id) ?? [], nodes)) add("evidence_needed", nodeInput(node, "node", 88, "warning", ["node has evidence_required but no linked evidence"], [`awg add evidence --target ${node.id} --summary "..." --source terminal`], false, true));
    if (["risk", "blocker"].includes(node.type) && ACTIVE.has(node.status)) {
      add("risk_review", nodeInput(node, "node", node.type === "blocker" ? 92 : 86, "warning", [`${node.type} status is ${node.status}`], [`awg node show ${node.id} --json`], false, true));
      add("human_review", nodeInput(node, "node", node.type === "blocker" ? 92 : 86, "warning", [`${node.type} requires human review`], [`awg node show ${node.id} --json`], false, true));
    }
    if (node.type === "question" && !CLOSED.has(node.status)) add("next", nodeInput(node, "node", 52, "info", [`question status is ${node.status}`], [`awg node show ${node.id} --json`], false, true));
    if (node.type === "decision" && ["draft", "proposed", "needs_review"].includes(node.status)) add("human_review", nodeInput(node, "node", 76, "warning", [`decision status is ${node.status}`], [`awg node show ${node.id} --json`], false, true));
    if (node.status === "needs_review" || node.status === "stale" || node.freshness?.state === "needs_review" || node.freshness?.state === "stale" || isPast(node.freshness?.review_after ?? node.review_after, graph.generated_at)) {
      add("stale_review", nodeInput(node, "node", node.status === "needs_review" ? 68 : 78, "warning", ["node freshness or status requires review"], [`awg node show ${node.id} --json`], false, true));
      add("maintenance", nodeInput(node, "node", 68, "warning", ["node requires maintenance review"], [`awg node show ${node.id} --json`], false, true));
    }
  }

  for (const claim of graph.claim_index?.claims ?? []) addClaimItems(add, claim);
  for (const evidence of graph.evidence_index?.evidence ?? []) addEvidenceItems(add, evidence);
  for (const run of buildRuns(graph)) addRunItems(add, run, graph);
  addCoordinationItems(add, graph);
  addTopologyItems(add, graph);

  const sortedItems = dedupeItems(items).sort(compareWorkQueueItems);
  const queues = BUILT_IN_WORK_QUEUES.map((queue) => {
    const queueItems = sortedItems.filter((item) => item.queue === queue.id);
    return {
      ...queue,
      count: queueItems.length,
      highPriority: queueItems.filter((item) => item.priority >= 80).length,
      autonomousSafe: queueItems.filter((item) => item.autonomousSafe).length,
      needsHumanReview: queueItems.filter((item) => item.needsHumanReview).length
    };
  });
  return {
    awg: AWG_VERSION,
    kind: "work-queue-index",
    generated_at: graph.generated_at,
    queues,
    items: sortedItems,
    summary: {
      total: sortedItems.length,
      byQueue: countBy(sortedItems, "queue"),
      bySeverity: countBy(sortedItems, "severity"),
      autonomousSafe: sortedItems.filter((item) => item.autonomousSafe).length,
      needsHumanReview: sortedItems.filter((item) => item.needsHumanReview).length,
      blocked: sortedItems.filter((item) => item.blocked).length,
      highPriority: sortedItems.filter((item) => item.priority >= 80).length
    }
  };
}

export function filterWorkQueueItems(index: WorkQueueIndex | undefined, options: { queue?: string; limit?: number; autonomous?: boolean; humanReview?: boolean; includeHumanReview?: boolean; includeClaimed?: boolean; mine?: boolean; goal?: string; graph?: CompiledGraph } = {}): WorkQueueItem[] {
  let items = index?.items ?? [];
  const currentRunId = options.graph ? activeRun(buildRuns(options.graph))?.id : undefined;
  if (options.queue) items = items.filter((item) => item.queue === options.queue);
  if (options.autonomous) items = items.filter((item) => item.autonomousSafe);
  if (options.humanReview) items = items.filter((item) => item.needsHumanReview);
  if (options.includeHumanReview === false) items = items.filter((item) => !item.needsHumanReview);
  if (options.mine) items = items.filter((item) => Boolean(item.coordination?.claimedByCurrentRun));
  else if (!options.includeClaimed) items = items.filter((item) => !item.coordination?.claimedByOtherActiveRun);
  if (options.goal) items = items.filter((item) => itemMatchesGoal(item, options.goal ?? "", options.graph));
  return items.slice(0, Math.max(0, options.limit ?? items.length));
}

export function compareWorkQueueItems(a: WorkQueueItem, b: WorkQueueItem): number {
  return b.priority - a.priority ||
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    (a.queue === "blocked" && b.queue === "blocked" ? 0 : Number(a.blocked) - Number(b.blocked)) ||
    compareOptionalDateAsc(a.reviewAfter, b.reviewAfter) ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    a.id.localeCompare(b.id);
}

function addInboxItems(add: (queue: WorkQueueId, input: QueueInput) => void, item: MaintenanceInboxItem): void {
  const input: QueueInput = {
    title: item.message,
    summary: item.message,
    severity: item.severity,
    priority: item.priority,
    sourceKind: item.kind === "topology" ? "topology" : "inbox",
    sourceCode: item.code,
    sourceIds: [item.id],
    nodeIds: item.nodeIds,
    edgeIds: item.edgeIds,
    runIds: item.runIds,
    inboxItemIds: [item.id],
    vaultIds: item.vaultIds,
    relationshipIds: item.relationshipIds,
    reasons: item.reasons,
    suggestedCommands: item.suggestedCommands,
    autonomousSafe: item.autonomousSafe,
    needsHumanReview: item.needsHumanReview,
    blocked: item.kind === "blockers",
    blockedByNodeIds: item.kind === "blockers" ? item.nodeIds : []
  };
  for (const queue of inboxQueues(item)) {
    add(queue, { ...input, autonomousSafe: queue === "autonomous" ? item.autonomousSafe : item.autonomousSafe && !item.needsHumanReview, needsHumanReview: queue === "autonomous" ? false : item.needsHumanReview });
  }
}

function inboxQueues(item: MaintenanceInboxItem): WorkQueueId[] {
  const code = item.code.toLowerCase();
  const queues: WorkQueueId[] = [];
  if (item.kind === "claims" && code.includes("contradict")) queues.push("risk_review", "human_review", "next");
  else if (item.kind === "claims") queues.push("evidence_needed", "stale_review", "next");
  else if (item.kind === "evidence") queues.push(code.includes("expired") ? "stale_review" : "evidence_needed", "next");
  else if (item.kind === "blockers") queues.push("blocked", "risk_review", "human_review");
  else if (item.kind === "risks") queues.push("risk_review", "human_review");
  else if (item.kind === "stale") queues.push("stale_review", "maintenance");
  else if (item.kind === "needs_review") queues.push("human_review", "maintenance");
  else if (item.kind === "duplicates") queues.push("maintenance", "human_review");
  else if (item.kind === "orphans") queues.push("maintenance");
  else if (item.kind === "questions") queues.push("next", "human_review");
  else if (item.kind === "decisions") queues.push("human_review", "next");
  else if (item.kind === "topology") queues.push("maintenance", "handoff_followup");
  else queues.push("maintenance");
  if (item.autonomousSafe && !item.needsHumanReview) queues.push("autonomous");
  return unique(queues);
}

function addDiagnosticItems(add: (queue: WorkQueueId, input: QueueInput) => void, diagnostic: Diagnostic): void {
  if (diagnostic.severity !== "fatal") return;
  const ids = diagnostic.id ? [diagnostic.id] : [];
  add("maintenance", {
    title: diagnostic.message,
    summary: diagnostic.message,
    severity: "error",
    priority: 100,
    sourceKind: "diagnostic",
    sourceCode: diagnostic.code,
    sourceIds: [diagnostic.code, ...ids],
    nodeIds: ids.filter((id) => id.startsWith("n:")),
    edgeIds: ids.filter((id) => id.startsWith("e:")),
    runIds: ids.filter((id) => id.startsWith("run:")),
    reasons: [`fatal diagnostic ${diagnostic.code}`],
    suggestedCommands: ["awg doctor --fix-suggestions --json"],
    autonomousSafe: false,
    needsHumanReview: true
  });
}

function addClaimItems(add: (queue: WorkQueueId, input: QueueInput) => void, claim: ClaimIndexRecord): void {
  if (claim.verificationStatus === "contradicted") for (const queue of ["risk_review", "human_review", "next"] as WorkQueueId[]) add(queue, claimInput(claim, 96, "warning", "Claim is contradicted", [`claim status is ${claim.verificationStatus}`]));
  if (claim.verificationStatus === "unverified" && !["archived", "superseded", "rejected"].includes(claim.nodeStatus)) add("evidence_needed", claimInput(claim, 84, "warning", "Claim is unverified", ["claim has no current supporting evidence"]));
  if (claim.stale || claim.expired || ["stale", "expired"].includes(claim.verificationStatus)) add("stale_review", claimInput(claim, claim.expired ? 90 : 78, "warning", claim.expired ? "Claim is expired" : "Claim needs re-verification", ["claim freshness requires review"], claim.reviewAfter ?? claim.expiresAt));
}

function addEvidenceItems(add: (queue: WorkQueueId, input: QueueInput) => void, evidence: EvidenceIndexRecord): void {
  if (!evidence.expired) return;
  const input: QueueInput = {
    title: `Evidence is expired: ${evidence.title}`,
    summary: evidence.summary,
    severity: "warning",
    priority: 90,
    sourceKind: "evidence",
    sourceCode: "expired_evidence",
    sourceIds: [evidence.id],
    nodeIds: [evidence.id],
    evidenceIds: [evidence.id],
    reasons: ["evidence expires_at is past"],
    suggestedCommands: [`awg node show ${evidence.id} --json`],
    autonomousSafe: false,
    needsHumanReview: true,
    reviewAfter: evidence.expiresAt ?? evidence.reviewAfter
  };
  add("evidence_needed", input);
  add("stale_review", input);
}

function addRunItems(add: (queue: WorkQueueId, input: QueueInput) => void, run: AgentRun, graph: CompiledGraph): void {
  const staleActive = run.status === "in_progress" && Date.parse(graph.generated_at) - Date.parse(run.updated_at) > 24 * 60 * 60 * 1000;
  if (staleActive) add("handoff_followup", runInput(run, 74, "warning", "Active run may need handoff", ["run is still in progress and older than one day"]));
  const warnings = preflightWarnings(run.preflight);
  if (run.forced && warnings.length) {
    add("handoff_followup", {
      ...runInput(run, 82, "warning", "Forced finish left unresolved preflight warnings", warnings.map((warning) => warning.message ?? warning.code ?? "preflight warning")),
      sourceCode: "forced_preflight_warnings",
      nodeIds: sorted(warnings.flatMap((warning) => warning.nodeIds ?? []))
    });
  }
  if (run.status === "completed" && !run.evidence.length && !run.changed_nodes.length) {
    add("handoff_followup", runInput(run, 74, "warning", "Completed run has no evidence or changed nodes", ["run finished completed without durable changes"]));
    add("maintenance", runInput(run, 74, "warning", "Completed run has no evidence or changed nodes", ["run finished completed without durable changes"]));
  }
}

function addCoordinationItems(add: (queue: WorkQueueId, input: QueueInput) => void, graph: CompiledGraph): void {
  for (const claim of graph.coordination_index?.claims ?? []) {
    if (claim.status !== "stale") continue;
    const input: QueueInput = {
      title: `Stale coordination claim: ${claim.summary ?? claim.id}`,
      summary: claim.reason ?? claim.summary ?? claim.id,
      severity: "warning",
      priority: 82,
      sourceKind: "run",
      sourceCode: "coordination_stale_claim",
      sourceIds: [claim.id],
      nodeIds: claim.nodeIds,
      runIds: claim.runIds,
      claimIds: claim.claimIds,
      evidenceIds: claim.evidenceIds,
      vaultIds: claim.vaultIds,
      relationshipIds: claim.relationshipIds,
      reasons: ["coordination claim is stale or owned by a finished run"],
      suggestedCommands: [`awg coord release ${claim.id} --status abandoned --summary "..."`, "awg coord status --json"],
      autonomousSafe: false,
      needsHumanReview: true
    };
    add("handoff_followup", input);
    add("maintenance", input);
  }
  for (const collision of graph.coordination_index?.collisions ?? []) {
    const claims = (graph.coordination_index?.claims ?? []).filter((claim) => collision.claimIds.includes(claim.id));
    const input: QueueInput = {
      title: collision.message,
      summary: collision.message,
      severity: "warning",
      priority: 90,
      sourceKind: "run",
      sourceCode: "coordination_collision",
      sourceIds: [collision.id, ...collision.claimIds],
      nodeIds: sorted([...collision.nodeIds, ...claims.flatMap((claim) => claim.nodeIds)]),
      runIds: collision.runIds,
      claimIds: claims.flatMap((claim) => claim.claimIds),
      evidenceIds: claims.flatMap((claim) => claim.evidenceIds),
      vaultIds: claims.flatMap((claim) => claim.vaultIds),
      relationshipIds: claims.flatMap((claim) => claim.relationshipIds),
      reasons: ["active coordination claims overlap"],
      suggestedCommands: collision.suggestedCommands,
      autonomousSafe: false,
      needsHumanReview: true
    };
    add("human_review", input);
    add("risk_review", input);
  }
}

function preflightWarnings(value: unknown): Array<{ code?: string; message?: string; nodeIds?: string[] }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const warnings = (value as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.map((warning) => warning && typeof warning === "object" && !Array.isArray(warning) ? warning as { code?: string; message?: string; nodeIds?: string[] } : {}).filter((warning) => warning.code || warning.message || warning.nodeIds?.length);
}

function addTopologyItems(add: (queue: WorkQueueId, input: QueueInput) => void, graph: CompiledGraph): void {
  const topology = graph.topology as { diagnostics?: Diagnostic[]; relationships?: Array<{ id?: string; stale?: boolean; summary?: string }> } | undefined;
  for (const diagnostic of topology?.diagnostics ?? []) {
    const input: QueueInput = {
      title: diagnostic.message,
      summary: diagnostic.message,
      severity: diagnostic.severity === "fatal" ? "error" : diagnostic.severity,
      priority: diagnostic.severity === "fatal" ? 100 : 72,
      sourceKind: "topology",
      sourceCode: diagnostic.code,
      sourceIds: [diagnostic.code],
      reasons: [`topology diagnostic ${diagnostic.code}`],
      suggestedCommands: ["awg vault topology --json"],
      autonomousSafe: false,
      needsHumanReview: true
    };
    add("maintenance", input);
    add("handoff_followup", input);
  }
}

function nodeInput(node: AwgNode, sourceKind: WorkQueueSourceKind, priority: number, severity: WorkQueueSeverity, reasons: string[], suggestedCommands: string[], autonomousSafe: boolean, needsHumanReview: boolean): QueueInput {
  return { title: node.title, summary: node.summary, severity, priority, sourceKind, sourceIds: [node.id], nodeIds: [node.id], reasons, suggestedCommands, autonomousSafe, needsHumanReview, reviewAfter: node.freshness?.review_after ?? node.review_after };
}

function claimInput(claim: ClaimIndexRecord, priority: number, severity: WorkQueueSeverity, prefix: string, reasons: string[], reviewAfter?: string): QueueInput {
  return { title: `${prefix}: ${claim.title}`, summary: claim.summary, severity, priority, sourceKind: "claim", sourceCode: claim.verificationStatus, sourceIds: [claim.id], nodeIds: [claim.id], claimIds: [claim.id], evidenceIds: [...claim.supportingEvidenceIds, ...claim.contradictingEvidenceIds, ...claim.verifiedByEvidenceIds, ...claim.expiredEvidenceIds], reasons, suggestedCommands: [`awg claim status ${claim.id} --json`], autonomousSafe: false, needsHumanReview: true, reviewAfter };
}

function runInput(run: AgentRun, priority: number, severity: WorkQueueSeverity, title: string, reasons: string[]): QueueInput {
  return { title: `${title}: ${run.id}`, summary: run.summary ?? run.goal, severity, priority, sourceKind: "run", sourceIds: [run.id], runIds: [run.id], reasons, suggestedCommands: ["awg run status --json", "awg handoff --compact --no-record"], autonomousSafe: false, needsHumanReview: true };
}

function workQueueItemId(queue: WorkQueueId, sourceKind: WorkQueueSourceKind, sourceCode: string | undefined, ids: Record<string, string[] | undefined>): string {
  const parts = [queue, sourceKind, sourceCode ?? "", ...Object.keys(ids).sort().flatMap((key) => [key, ...sorted(ids[key] ?? [])])];
  const digest = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
  return `wq:${queue}:${digest}`;
}

function timestampsFor(graph: CompiledGraph, input: QueueInput, nodes: Map<string, AwgNode>): { createdAt: string; updatedAt: string } {
  const created: string[] = [];
  const updated: string[] = [];
  for (const id of input.nodeIds ?? []) {
    const node = nodes.get(id);
    if (node?.created_at) created.push(node.created_at);
    if (node?.updated_at) updated.push(node.updated_at);
  }
  for (const runId of input.runIds ?? []) {
    const run = buildRuns(graph).find((candidate) => candidate.id === runId);
    if (run?.started_at) created.push(run.started_at);
    if (run?.updated_at) updated.push(run.updated_at);
    if (run?.finished_at) updated.push(run.finished_at);
  }
  return { createdAt: minDate(created) ?? graph.generated_at, updatedAt: maxDate(updated) ?? graph.generated_at };
}

function firstNode(ids: string[] | undefined, nodes: Map<string, AwgNode>): AwgNode | undefined {
  for (const id of ids ?? []) {
    const node = nodes.get(id);
    if (node) return node;
  }
  return undefined;
}

function activeRunTouchedNodes(graph: CompiledGraph): Set<string> {
  const run = buildRuns(graph).find((candidate) => candidate.status === "in_progress");
  if (!run) return new Set();
  const summary = (graph.run_summaries as Array<{ runId: string; touchedNodeIds?: string[] }> | undefined)?.find((item) => item.runId === run.id);
  return new Set(summary?.touchedNodeIds ?? run.changed_nodes);
}

function touchesActiveRun(input: QueueInput, touched: Set<string>): boolean {
  return Boolean(input.nodeIds?.some((id) => touched.has(id)));
}

function itemMatchesGoal(item: WorkQueueItem, goal: string, graph?: CompiledGraph): boolean {
  const terms = goal.toLowerCase().split(/[^a-z0-9:_-]+/).filter(Boolean);
  if (!terms.length) return true;
  const nodes = graph ? item.nodeIds.map((id) => graph.nodes.find((node) => node.id === id)).filter((node): node is AwgNode => Boolean(node)) : [];
  const haystack = [item.id, item.queue, item.title, item.summary, ...item.reasons, ...item.sourceIds, ...item.nodeIds, ...nodes.flatMap((node) => [node.title, node.summary])].join(" ").toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

function dedupeItems(items: WorkQueueItem[]): WorkQueueItem[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function countBy(items: WorkQueueItem[], key: "queue" | "severity"): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[String(item[key])] = (out[String(item[key])] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function sorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function clampPriority(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isPast(date: string | undefined, asOf: string): boolean {
  if (!date) return false;
  const time = Date.parse(date);
  const now = Date.parse(asOf);
  return Number.isFinite(time) && Number.isFinite(now) && time < now;
}

function minDate(values: string[]): string | undefined {
  return values.filter((value) => Number.isFinite(Date.parse(value))).sort()[0];
}

function maxDate(values: string[]): string | undefined {
  return values.filter((value) => Number.isFinite(Date.parse(value))).sort().at(-1);
}

function compareOptionalDateAsc(a: string | undefined, b: string | undefined): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b);
}

interface QueueInput {
  title: string;
  summary: string;
  severity?: WorkQueueSeverity;
  priority?: number;
  sourceKind: WorkQueueSourceKind;
  sourceCode?: string;
  sourceIds?: string[];
  nodeIds?: string[];
  edgeIds?: string[];
  runIds?: string[];
  inboxItemIds?: string[];
  claimIds?: string[];
  evidenceIds?: string[];
  vaultIds?: string[];
  relationshipIds?: string[];
  reasons?: string[];
  suggestedCommands?: string[];
  autonomousSafe?: boolean;
  needsHumanReview?: boolean;
  blocked?: boolean;
  blockedByNodeIds?: string[];
  reviewAfter?: string;
}
