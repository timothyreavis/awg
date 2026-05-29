import { createHash } from "node:crypto";
import { AWG_VERSION } from "./constants.js";
import { activeRun, buildRuns } from "./runs.js";
import type { AttentionAcknowledgement, AttentionIndex, AttentionItem, AttentionScoreReason, AttentionState, AwgEdge, AwgEvent, AwgNode, CompiledGraph, Diagnostic } from "./types.js";

const OPEN = new Set(["active", "blocked", "in_progress", "needs_review", "proposed", "stale"]);
const CLOSED = new Set(["completed", "resolved", "archived", "rejected", "superseded", "accepted"]);
const LONG_OPEN_DAYS = 60;
const STALE_UPDATED_DAYS = 30;
const RECENT_RUN_DAYS = 14;
const MATERIAL_KEYS = ["status", "summary", "body", "fields", "freshness", "edges"];

export function buildAttentionIndex(graph: CompiledGraph, asOf = graph.generated_at): AttentionIndex {
  const asOfTime = safeTime(asOf);
  const runs = buildRuns(graph);
  const currentRun = activeRun(runs);
  const activeRunIds = new Set(runs.filter((run) => run.status === "in_progress").map((run) => run.id));
  const recentRuns = runs.filter((run) => daysBetween(run.updated_at, asOfTime) <= RECENT_RUN_DAYS);
  const runTouched = new Map<string, string[]>();
  for (const summary of (graph.run_summaries ?? []) as Array<{ runId?: string; touchedNodeIds?: string[] }>) {
    if (!summary.runId) continue;
    for (const nodeId of summary.touchedNodeIds ?? []) pushMap(runTouched, nodeId, summary.runId);
  }
  const evidenceByTarget = evidenceTargets(graph);
  const incoming = incomingEdges(graph.edges);
  const outgoing = outgoingEdges(graph.edges);
  const acknowledgements = buildAcknowledgements(graph, asOfTime);
  const ackByNode = latestAcknowledgementsByNode(acknowledgements);
  const activeClaimsByNode = new Map<string, string[]>();
  for (const claim of graph.coordination_index?.claims ?? []) {
    if (claim.status !== "active") continue;
    for (const nodeId of claim.nodeIds) pushMap(activeClaimsByNode, nodeId, claim.id);
  }
  const items = graph.nodes.map((node) => {
    const nodeUpdatedAt = node.updated_at;
    const touchedRuns = sorted(runTouched.get(node.id) ?? []);
    const recentRunIds = touchedRuns.filter((runId) => recentRuns.some((run) => run.id === runId));
    const activeTouched = touchedRuns.some((runId) => activeRunIds.has(runId));
    const activeClaimIds = sorted(activeClaimsByNode.get(node.id) ?? []);
    const evidenceIds = sorted(evidenceByTarget.get(node.id) ?? []);
    const acknowledgement = ackByNode.get(node.id);
    const diagnosticIds = sorted([
      ...graph.diagnostics.diagnostics.filter((diag) => diag.id === node.id).map((diag) => diag.code),
      ...(acknowledgement?.stale ? ["AWG_ACK_STALE"] : [])
    ]);
    const inboxItemIds = sorted((graph.maintenance_inbox?.items ?? []).filter((item) => item.nodeIds.includes(node.id)).map((item) => item.id));
    const staleReasons = staleReasonsFor(node, asOfTime, acknowledgement, recentRunIds, activeClaimIds);
    const closeoutReasons = closeoutReasonsFor(node, graph, evidenceIds, incoming.get(node.id) ?? [], outgoing.get(node.id) ?? [], acknowledgement);
    const scoreBreakdown = scoreFor(node, {
      activeTouched,
      activeClaimIds,
      recentRunIds,
      diagnosticIds,
      staleReasons,
      closeoutReasons,
      acknowledgement
    });
    const baseFocusScore = clamp(scoreBreakdown.reduce((sum, reason) => sum + reason.value, 50));
    const baseAttentionState = attentionStateFor(node, {
      baseFocusScore,
      activeTouched,
      activeClaimIds,
      recentRunIds,
      staleReasons,
      closeoutReasons,
      acknowledgement
    });
    const item: AttentionItem = {
      id: attentionItemId(node, baseAttentionState, [...closeoutReasons, ...staleReasons, acknowledgement?.id ?? ""].filter(Boolean)),
      nodeId: node.id,
      nodeTitle: node.title,
      nodeType: node.type,
      nodeStatus: node.status,
      baseAttentionState,
      baseFocusScore,
      scoreBreakdown,
      queueWeight: queueWeightFor(baseAttentionState, baseFocusScore),
      ageDays: daysBetween(node.created_at, asOfTime),
      updatedAgeDays: daysBetween(node.updated_at, asOfTime),
      nodeUpdatedAt,
      nodeRevision: nodeUpdatedAt,
      lastTouchedRunIds: touchedRuns.slice(-5),
      recentRunIds,
      activeCoordinationClaimIds: activeClaimIds,
      evidenceIds,
      diagnosticIds,
      inboxItemIds,
      workQueueItemIds: [],
      acknowledgementId: acknowledgement?.id,
      acknowledgedUntil: acknowledgement?.reviewAfter,
      acknowledgementStale: acknowledgement?.stale ?? false,
      acknowledgedNodeUpdatedAt: acknowledgement?.acknowledgedNodeUpdatedAt,
      acknowledgedMaterialKeys: acknowledgement?.acknowledgedMaterialKeys ?? [],
      closeoutReasons,
      staleReasons,
      suggestedDisposition: dispositionFor(node, closeoutReasons),
      suggestedCommands: suggestedCommandsFor(node, nodeUpdatedAt, closeoutReasons, acknowledgement),
      needsHumanReview: needsHumanReview(node, closeoutReasons, acknowledgement),
      autonomousSafe: autonomousSafe(node, closeoutReasons, acknowledgement),
      createdAt: node.created_at,
      updatedAt: node.updated_at
    };
    return item;
  }).sort(compareAttentionItems);
  return {
    awg: AWG_VERSION,
    kind: "attention-index",
    generated_at: graph.generated_at,
    asOf,
    acknowledgements,
    items,
    summary: {
      total: items.length,
      current: items.filter((item) => item.baseAttentionState === "current").length,
      open: items.filter((item) => item.baseAttentionState === "open").length,
      staleOpen: items.filter((item) => item.baseAttentionState === "stale_open").length,
      closeoutCandidates: items.filter((item) => item.baseAttentionState === "closeout_candidate").length,
      acknowledgedOpen: items.filter((item) => item.baseAttentionState === "acknowledged_open").length,
      historical: items.filter((item) => item.baseAttentionState === "historical").length
    }
  };
}

export function decorateAttentionWithQueueIds(index: AttentionIndex | undefined, graph: CompiledGraph): AttentionIndex | undefined {
  if (!index) return undefined;
  const queueIdsByNode = new Map<string, string[]>();
  for (const item of graph.work_queue_index?.items ?? []) for (const nodeId of item.nodeIds) pushMap(queueIdsByNode, nodeId, item.id);
  const inboxIdsByNode = new Map<string, string[]>();
  for (const item of graph.maintenance_inbox?.items ?? []) for (const nodeId of item.nodeIds) pushMap(inboxIdsByNode, nodeId, item.id);
  return { ...index, items: index.items.map((item) => ({ ...item, inboxItemIds: sorted(inboxIdsByNode.get(item.nodeId) ?? item.inboxItemIds), workQueueItemIds: sorted(queueIdsByNode.get(item.nodeId) ?? []) })) };
}

export function projectAttention(index: AttentionIndex | undefined, graph: CompiledGraph, options: { goal?: string; asOf?: string; nodeIds?: string[] } = {}): AttentionItem[] {
  const ids = options.nodeIds?.length ? new Set(options.nodeIds) : undefined;
  const asOfTime = safeTime(options.asOf ?? index?.asOf ?? graph.generated_at);
  let items = (index?.items ?? []).filter((item) => !ids || ids.has(item.nodeId)).map((item) => projectItemAsOf(item, asOfTime));
  if (options.goal) {
    const goal = options.goal.toLowerCase();
    items = items.map((item) => {
      const node = graph.nodes.find((candidate) => candidate.id === item.nodeId);
      const boost = goalBoost(node, goal, graph);
      const effectiveFocusScore = clamp(item.baseFocusScore + boost);
      return {
        ...item,
        effectiveAttentionState: boost > 0 && ["current", "open", "stale_open"].includes(item.baseAttentionState) ? "current" : item.baseAttentionState,
        effectiveFocusScore,
        goalMatched: boost > 0,
        goalBoost: boost,
        runtimeScoreBreakdown: boost > 0 ? [{ code: "goal_match", label: "Runtime goal match", value: boost }] : []
      };
    });
  }
  return items.sort(compareEffectiveAttentionItems);
}

export function attentionDiagnostics(graph: CompiledGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const event of graph.events) {
    if (event.type !== "node.acknowledged") continue;
    const target = typeof event.target === "string" ? event.target : "";
    if (!target || !graph.nodes.some((node) => node.id === target)) diagnostics.push({ severity: "warning", code: "AWG_ACK_MISSING_TARGET", message: `Acknowledgement target is missing or unknown: ${target || "(missing)"}`, id: target || event.id });
    if (typeof event.reason !== "string" || !event.reason.trim()) diagnostics.push({ severity: "warning", code: "AWG_ACK_MISSING_REASON", message: `Acknowledgement lacks a reason: ${event.id ?? target}`, id: target || event.id });
    if (typeof event.review_after === "string" && !Number.isFinite(Date.parse(event.review_after))) diagnostics.push({ severity: "warning", code: "AWG_ACK_MALFORMED_REVIEW_AFTER", message: `Acknowledgement review_after is malformed: ${event.review_after}`, id: target || event.id });
    if (event.review_after !== undefined && typeof event.review_after !== "string") diagnostics.push({ severity: "warning", code: "AWG_ACK_MALFORMED_REVIEW_AFTER", message: "Acknowledgement review_after must be an ISO date string.", id: target || event.id });
  }
  for (const item of graph.attention_index?.items ?? []) {
    if (item.acknowledgementStale) diagnostics.push({ severity: "warning", code: "AWG_ACK_STALE", message: `Acknowledgement is stale: ${item.nodeTitle}`, id: item.nodeId, fixSuggestion: { commands: item.suggestedCommands } });
  }
  if (!graph.attention_index) diagnostics.push({ severity: "warning", code: "AWG_ATTENTION_INDEX_INCOMPLETE", message: "Attention index is missing from compiled graph." });
  return diagnostics;
}

function buildAcknowledgements(graph: CompiledGraph, asOfTime: number): AttentionAcknowledgement[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const events = graph.events.filter((event) => event.type === "node.acknowledged").map((event) => acknowledgementFromEvent(event, nodes, graph.edges, asOfTime)).filter(Boolean) as AttentionAcknowledgement[];
  const legacy = graph.edges.filter((edge) => edge.rel === "intentionally_open").map((edge) => acknowledgementFromLegacy(edge, nodes, graph.edges, asOfTime)).filter(Boolean) as AttentionAcknowledgement[];
  return [...events, ...legacy].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

function acknowledgementFromEvent(event: AwgEvent, nodes: Map<string, AwgNode>, edges: AwgEdge[], asOfTime: number): AttentionAcknowledgement | undefined {
  const node = nodes.get(String(event.target));
  if (!node) return undefined;
  const acknowledgedAt = typeof event.at === "string" ? event.at : typeof event.created_at === "string" ? event.created_at : node.updated_at;
  const reviewAfter = typeof event.review_after === "string" ? event.review_after : undefined;
  const acknowledgedNodeUpdatedAt = typeof event.acknowledgedNodeUpdatedAt === "string" ? event.acknowledgedNodeUpdatedAt : typeof event.acknowledged_node_updated_at === "string" ? event.acknowledged_node_updated_at : undefined;
  const watched = Array.isArray(event.acknowledgedMaterialKeys) ? event.acknowledgedMaterialKeys.map(String) : MATERIAL_KEYS;
  const staleReasons = acknowledgementStaleReasons(node, edges, watched, reviewAfter, acknowledgedNodeUpdatedAt, acknowledgedAt, asOfTime);
  return {
    id: event.id ?? attentionHash("ack", node.id, acknowledgedAt),
    source: "event",
    nodeId: node.id,
    reason: typeof event.reason === "string" ? event.reason : "",
    scope: typeof event.scope === "string" ? event.scope : "general",
    by: typeof event.by === "string" ? event.by : undefined,
    at: acknowledgedAt,
    runId: typeof event.runId === "string" ? event.runId : typeof event.run === "string" ? event.run : undefined,
    reviewAfter,
    acknowledgedNodeUpdatedAt,
    acknowledgedMaterialKeys: watched,
    stale: staleReasons.length > 0,
    staleReasons
  };
}

function acknowledgementFromLegacy(edge: AwgEdge, nodes: Map<string, AwgNode>, edges: AwgEdge[], asOfTime: number): AttentionAcknowledgement | undefined {
  const node = nodes.get(edge.from);
  if (!node) return undefined;
  const reviewAfter = typeof edge.review_after === "string" ? edge.review_after : undefined;
  const staleReasons = acknowledgementStaleReasons(node, edges, MATERIAL_KEYS, reviewAfter, edge.created_at, edge.created_at, asOfTime);
  if (!reviewAfter) staleReasons.push("legacy acknowledgement has no review date");
  return {
    id: `ack:${edge.id}`,
    source: "legacy_intentionally_open",
    nodeId: node.id,
    reason: edge.reason ?? "Legacy intentionally_open edge.",
    scope: "general",
    by: edge.created_by,
    at: edge.created_at,
    runId: typeof edge.runId === "string" ? edge.runId : typeof edge.run === "string" ? edge.run : undefined,
    reviewAfter,
    acknowledgedNodeUpdatedAt: edge.created_at,
    acknowledgedMaterialKeys: MATERIAL_KEYS,
    stale: staleReasons.length > 0,
    staleReasons
  };
}

function latestAcknowledgementsByNode(items: AttentionAcknowledgement[]): Map<string, AttentionAcknowledgement> {
  const out = new Map<string, AttentionAcknowledgement>();
  for (const item of items) {
    const prior = out.get(item.nodeId);
    if (!prior || item.at.localeCompare(prior.at) >= 0) out.set(item.nodeId, item);
  }
  return out;
}

function scoreFor(node: AwgNode, input: { activeTouched: boolean; activeClaimIds: string[]; recentRunIds: string[]; diagnosticIds: string[]; staleReasons: string[]; closeoutReasons: string[]; acknowledgement?: AttentionAcknowledgement }): AttentionScoreReason[] {
  const reasons: AttentionScoreReason[] = [];
  if (input.activeTouched) reasons.push({ code: "active_run_touched", label: "Active run touched node", value: 45, sourceIds: input.recentRunIds });
  if (input.activeClaimIds.length) reasons.push({ code: "active_coordination_claim", label: "Active coordination claim overlaps node", value: 40, sourceIds: input.activeClaimIds });
  if (["risk", "blocker"].includes(node.type) && OPEN.has(node.status)) reasons.push({ code: `active_${node.type}`, label: `Active ${node.type}`, value: node.type === "blocker" ? 30 : 20 });
  if (input.diagnosticIds.length) reasons.push({ code: "diagnostics", label: "Diagnostics affect node", value: 15, sourceIds: input.diagnosticIds });
  if (input.recentRunIds.length) reasons.push({ code: "recent_run_touched", label: "Recent run touched node", value: 15, sourceIds: input.recentRunIds });
  if (hasFocusMarker(node)) reasons.push({ code: "explicit_focus", label: "Explicit focus marker", value: 10 });
  if (input.staleReasons.length) reasons.push({ code: "stale_open", label: "Stale open item", value: -20 });
  if (input.acknowledgement && !input.acknowledgement.stale) reasons.push({ code: "acknowledged_open", label: "Acknowledged open item", value: -30, sourceIds: [input.acknowledgement.id] });
  if (CLOSED.has(node.status)) reasons.push({ code: "historical_status", label: "Historical lifecycle status", value: -40 });
  if (input.closeoutReasons.length) reasons.push({ code: "closeout_candidate", label: "Closeout candidate", value: -50 });
  return reasons;
}

function attentionStateFor(node: AwgNode, input: { baseFocusScore: number; activeTouched: boolean; activeClaimIds: string[]; recentRunIds: string[]; staleReasons: string[]; closeoutReasons: string[]; acknowledgement?: AttentionAcknowledgement }): AttentionState {
  if (CLOSED.has(node.status)) return "historical";
  if (input.activeTouched || input.activeClaimIds.length) return "current";
  if (input.acknowledgement && !input.acknowledgement.stale && OPEN.has(node.status)) return "acknowledged_open";
  if (input.closeoutReasons.length) return "closeout_candidate";
  if (input.baseFocusScore >= 75 || (["risk", "blocker"].includes(node.type) && OPEN.has(node.status))) return "current";
  if (input.staleReasons.length) return "stale_open";
  return OPEN.has(node.status) ? "open" : "historical";
}

function closeoutReasonsFor(node: AwgNode, graph: CompiledGraph, evidenceIds: string[], incoming: AwgEdge[], outgoing: AwgEdge[], acknowledgement?: AttentionAcknowledgement): string[] {
  if (!OPEN.has(node.status) || (acknowledgement && !acknowledgement.stale)) return [];
  const reasons: string[] = [];
  const longLived = isLongLived(node);
  const resolver = incoming.find((edge) => edge.rel === "resolved_by") ?? outgoing.find((edge) => ["superseded_by", "duplicate_of"].includes(edge.rel));
  if (resolver) reasons.push(`${resolver.rel} relationship exists`);
  if (node.type === "task" && evidenceIds.length && !longLived) reasons.push("linked evidence exists");
  if (node.type === "task" && runCompletedNode(graph, node.id) && !longLived) reasons.push("completed run touched node");
  if (node.type === "risk" && (evidenceIds.length || resolver)) reasons.push("risk has mitigation or resolver evidence");
  if (node.type === "blocker" && resolver) reasons.push("blocker has resolver");
  if (node.type === "question" && graph.responses.some((response) => response.target === node.id)) reasons.push("question has response");
  if (node.type === "decision" && ["draft", "proposed", "needs_review"].includes(node.status) && (incoming.some((edge) => edge.rel === "implements") || outgoing.some((edge) => edge.rel === "implements"))) reasons.push("decision has implementation relationship");
  if (staleReasonsFor(node, safeTime(graph.generated_at), acknowledgement, [], []).length && !longLived) reasons.push("old open item has no current signal");
  if (longLived && reasons.length) return ["acknowledge or schedule review for long-lived item"];
  return sorted(reasons);
}

function staleReasonsFor(node: AwgNode, asOfTime: number, acknowledgement: AttentionAcknowledgement | undefined, recentRunIds: string[], activeClaimIds: string[]): string[] {
  if (!OPEN.has(node.status) || recentRunIds.length || activeClaimIds.length) return acknowledgement?.staleReasons ?? [];
  const reasons = [...(acknowledgement?.staleReasons ?? [])];
  const reviewAfter = node.freshness?.review_after ?? node.review_after;
  if (reviewAfter && safeTime(reviewAfter) < asOfTime) reasons.push("review date passed");
  if (daysBetween(node.updated_at, asOfTime) >= STALE_UPDATED_DAYS) reasons.push("not updated recently");
  if (daysBetween(node.created_at, asOfTime) >= LONG_OPEN_DAYS) reasons.push("open for longer than threshold");
  return sorted(reasons);
}

function dispositionFor(node: AwgNode, reasons: string[]): AttentionItem["suggestedDisposition"] {
  if (!reasons.length) return undefined;
  if (reasons.some((reason) => reason.includes("long-lived"))) return "acknowledge_or_schedule_review";
  if (node.type === "risk" || node.type === "blocker" || node.type === "question") return "resolved";
  if (reasons.some((reason) => reason.includes("superseded") || reason.includes("duplicate"))) return "superseded";
  return node.type === "task" ? "completed" : "needs_review";
}

function suggestedCommandsFor(node: AwgNode, updatedAt: string, closeoutReasons: string[], acknowledgement?: AttentionAcknowledgement): string[] {
  const commands = [`awg node show ${node.id} --json`];
  if (closeoutReasons.length) {
    const status = dispositionFor(node, closeoutReasons);
    if (status && status !== "acknowledge_or_schedule_review") commands.push(`awg closeout mark ${node.id} --status ${status} --reason "..." --expect-updated-at ${updatedAt} --json`);
    commands.push(`awg ack ${node.id} --reason "..." --review-after <date> --expect-updated-at ${updatedAt} --json`);
  } else if (acknowledgement?.stale) commands.push(`awg ack ${node.id} --reason "..." --review-after <date> --expect-updated-at ${updatedAt} --json`);
  return commands;
}

function needsHumanReview(node: AwgNode, closeoutReasons: string[], acknowledgement?: AttentionAcknowledgement): boolean {
  return ["risk", "blocker", "decision"].includes(node.type) || closeoutReasons.some((reason) => reason.includes("long-lived")) || Boolean(acknowledgement?.stale);
}

function autonomousSafe(node: AwgNode, closeoutReasons: string[], acknowledgement?: AttentionAcknowledgement): boolean {
  return node.type === "task" && closeoutReasons.length > 0 && !needsHumanReview(node, closeoutReasons, acknowledgement);
}

function queueWeightFor(state: AttentionState, score: number): number {
  if (state === "current") return 20 + Math.round(score / 10);
  if (state === "open") return 0;
  if (state === "stale_open") return -20;
  if (state === "closeout_candidate") return -35;
  if (state === "acknowledged_open") return -45;
  return -60;
}

function evidenceTargets(graph: CompiledGraph): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const evidence of graph.evidence_index?.evidence ?? []) for (const target of evidence.targetIds) pushMap(out, target, evidence.id);
  for (const edge of graph.edges) if (["supports", "verified_by", "derived_from", "resolved_by"].includes(edge.rel)) pushMap(out, edge.to, edge.from);
  return out;
}

function runCompletedNode(graph: CompiledGraph, nodeId: string): boolean {
  return buildRuns(graph).some((run) => run.status === "completed" && ((graph.run_summaries ?? []) as Array<{ runId?: string; touchedNodeIds?: string[] }>).some((summary) => summary.runId === run.id && (summary.touchedNodeIds ?? []).includes(nodeId)));
}

function isLongLived(node: AwgNode): boolean {
  const tags = new Set(node.tags ?? []);
  const fields = node.fields ?? {};
  return ["roadmap", "process", "standard", "policy"].includes(node.type) || ["evergreen", "recurring", "parent", "roadmap", "manual_closeout"].some((tag) => tags.has(tag)) || fields.evergreen === true || fields.recurring === true || fields.parent === true || fields.manual_closeout === true;
}

function projectItemAsOf(item: AttentionItem, asOfTime: number): AttentionItem {
  const ageDays = daysBetween(item.createdAt, asOfTime);
  const updatedAgeDays = daysBetween(item.updatedAt, asOfTime);
  const dueAck = Boolean(item.acknowledgedUntil && !item.acknowledgementStale && safeTime(item.acknowledgedUntil) < asOfTime);
  const staleByAge = !item.recentRunIds.length && !item.activeCoordinationClaimIds.length && updatedAgeDays >= STALE_UPDATED_DAYS;
  const closeoutByAge = !item.recentRunIds.length && !item.activeCoordinationClaimIds.length && item.nodeType === "task" && ageDays >= LONG_OPEN_DAYS && !["historical", "acknowledged_open"].includes(item.baseAttentionState);
  if (!dueAck && !staleByAge && !closeoutByAge) return { ...item, ageDays, updatedAgeDays };
  const staleReasons = sorted([
    ...item.staleReasons,
    ...(dueAck ? ["acknowledgement review date passed"] : []),
    ...(staleByAge ? ["not updated recently"] : []),
    ...(closeoutByAge ? ["open for longer than threshold"] : [])
  ]);
  const effectiveAttentionState = closeoutByAge ? "closeout_candidate" : item.baseAttentionState === "acknowledged_open" || staleByAge ? "stale_open" : item.baseAttentionState;
  const runtimeScoreBreakdown = [
    ...(item.runtimeScoreBreakdown ?? []),
    ...(dueAck ? [{ code: "ack_due", label: "Acknowledgement review date passed", value: 10 }] : []),
    ...(staleByAge ? [{ code: "runtime_stale_open", label: "Runtime stale open age", value: -20 }] : [])
  ];
  return {
    ...item,
    ageDays,
    updatedAgeDays,
    acknowledgementStale: item.acknowledgementStale || dueAck,
    effectiveAttentionState,
    effectiveFocusScore: clamp(item.baseFocusScore + runtimeScoreBreakdown.reduce((sum, reason) => sum + reason.value, 0)),
    runtimeScoreBreakdown,
    staleReasons,
    diagnosticIds: dueAck ? sorted([...item.diagnosticIds, "AWG_ACK_STALE"]) : item.diagnosticIds,
    closeoutReasons: closeoutByAge ? sorted([...item.closeoutReasons, "old open item has no current signal"]) : item.closeoutReasons
  };
}

function acknowledgementStaleReasons(node: AwgNode, edges: AwgEdge[], watchedKeys: string[], reviewAfter: string | undefined, acknowledgedNodeUpdatedAt: string | undefined, acknowledgedAt: string, asOfTime: number): string[] {
  const reasons: string[] = [];
  if (reviewAfter && safeTime(reviewAfter) < asOfTime) reasons.push("acknowledgement review date passed");
  const watched = new Set(watchedKeys);
  if (acknowledgedNodeUpdatedAt && [...watched].some((key) => key !== "edges") && node.updated_at > acknowledgedNodeUpdatedAt) reasons.push("watched node material changed after acknowledgement");
  if (watched.has("edges") && edges.some((edge) => (edge.from === node.id || edge.to === node.id) && edge.created_at > acknowledgedAt)) reasons.push("watched edge material changed after acknowledgement");
  return reasons;
}

function hasFocusMarker(node: AwgNode): boolean {
  const fields = node.fields ?? {};
  return (node.tags ?? []).some((tag) => ["current", "focus"].includes(tag)) || fields.current === true || fields.focus === true;
}

function goalBoost(node: AwgNode | undefined, goal: string, graph: CompiledGraph): number {
  if (!node) return 0;
  const strong = [node.title, node.summary, ...(node.tags ?? []), ...(node.anchors ?? []).flatMap((anchor) => [anchor.path, anchor.name, anchor.label, anchor.url].filter(Boolean) as string[])].join(" ").toLowerCase();
  const body = [node.body, JSON.stringify(node.fields ?? {})].filter(Boolean).join(" ").toLowerCase();
  const normalizedGoal = goal.toLowerCase().trim();
  if (normalizedGoal && strong.includes(normalizedGoal)) return 35;
  const terms = distinctiveGoalTerms(normalizedGoal);
  const strongMatches = terms.filter((term) => strong.includes(term));
  if (strongMatches.length >= 2) return 35;
  if (strongMatches.length === 1 && terms.length === 1) return 25;
  if (normalizedGoal && body.includes(normalizedGoal)) return 20;
  const bodyMatches = terms.filter((term) => body.includes(term));
  if (bodyMatches.length >= 2) return 15;
  const related = graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id).map((edge) => edge.from === node.id ? edge.to : edge.from);
  if (related.some((id) => graph.nodes.some((candidate) => {
    const relatedText = [candidate.title, candidate.summary].join(" ").toLowerCase();
    return normalizedGoal && relatedText.includes(normalizedGoal) || terms.length >= 2 && terms.filter((term) => relatedText.includes(term)).length >= 2;
  }))) return 15;
  return 0;
}

function distinctiveGoalTerms(goal: string): string[] {
  const stop = new Set(["about", "after", "agent", "agents", "build", "check", "close", "current", "fix", "from", "goal", "implement", "issue", "items", "next", "node", "nodes", "open", "review", "slice", "status", "task", "tasks", "test", "tests", "this", "work", "with"]);
  return [...new Set(goal.split(/[^a-z0-9._:-]+/).filter((term) => {
    if (!term || stop.has(term)) return false;
    if (/v\d+(?:[._-]\d+)+/.test(term) || /\d/.test(term) || term.includes("-") || term.includes("_") || term.includes(":")) return term.length >= 3;
    return term.length >= 6;
  }))];
}

function incomingEdges(edges: AwgEdge[]): Map<string, AwgEdge[]> {
  const out = new Map<string, AwgEdge[]>();
  for (const edge of edges) pushMap(out, edge.to, edge);
  return out;
}

function outgoingEdges(edges: AwgEdge[]): Map<string, AwgEdge[]> {
  const out = new Map<string, AwgEdge[]>();
  for (const edge of edges) pushMap(out, edge.from, edge);
  return out;
}

function pushMap<T>(map: Map<string, T[]>, key: string, value: T): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function attentionItemId(node: AwgNode, state: AttentionState, sources: string[]): string {
  void state;
  return `att:${attentionHash(node.id, ...sorted(sources.filter((source) => source.startsWith("ev:") || source.startsWith("ack:") || source.startsWith("e:") || source.startsWith("n:") || source.startsWith("run:"))))}`;
}

function attentionHash(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16);
}

function compareAttentionItems(a: AttentionItem, b: AttentionItem): number {
  return stateRank(b.baseAttentionState) - stateRank(a.baseAttentionState) || b.baseFocusScore - a.baseFocusScore || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
}

function compareEffectiveAttentionItems(a: AttentionItem, b: AttentionItem): number {
  return (b.effectiveFocusScore ?? b.baseFocusScore) - (a.effectiveFocusScore ?? a.baseFocusScore) || stateRank(b.effectiveAttentionState ?? b.baseAttentionState) - stateRank(a.effectiveAttentionState ?? a.baseAttentionState) || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
}

function stateRank(state: AttentionState): number {
  return { current: 6, closeout_candidate: 5, stale_open: 4, open: 3, acknowledged_open: 2, historical: 1 }[state];
}

function daysBetween(value: string, asOfTime: number): number {
  const time = safeTime(value);
  return Math.max(0, Math.floor((asOfTime - time) / 86_400_000));
}

function safeTime(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}
