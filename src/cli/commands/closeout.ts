import { createHash } from "node:crypto";
import { AWG_VERSION, CORE_STATUSES } from "../../core/constants.js";
import { buildAwg } from "../../core/compiler.js";
import { edgeId } from "../../core/ids.js";
import { attachRun, resolveWriteRunId } from "../../core/runAttribution.js";
import { activeRun, buildRuns } from "../../core/runs.js";
import { projectAttention } from "../../core/attention.js";
import type { AttentionItem, AwgEdge, AwgEvent, AwgNode, CompiledGraph } from "../../core/types.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { nowIso } from "../../util/time.js";
import { str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";
import { guardTemplateSelfApproval } from "./update.js";

const CLOSEOUT_STATUSES = new Set(["completed", "resolved", "archived", "superseded", "needs_review"]);
const TARGET_RELS = new Set(["implements", "verified_by", "supports", "resolved_by", "superseded_by"]);
const ACK_SCOPES = new Set(["focus", "risk", "question", "task", "general"]);

export async function closeoutCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  if (sub === "candidates") return closeoutCandidates(parsed);
  if (sub === "run") return closeoutRun(parsed);
  if (sub === "mark") return closeoutMark(parsed);
  return jsonError(parsed, "AWG_CLOSEOUT_USAGE", "Usage: awg closeout candidates|run|mark ...", {});
}

export async function ackCommand(parsed: ParsedArgs): Promise<void> {
  const nodeId = parsed.positionals[1];
  if (!nodeId) return jsonError(parsed, "AWG_ACK_USAGE", "Usage: awg ack <node-id> --reason <text> [--review-after <date>] [--json]", {});
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false, coordinationAsOf: nowIso() });
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return jsonError(parsed, "AWG_ACK_MISSING_TARGET", `Node not found: ${nodeId}`, { nodeId });
  const reason = str(parsed.flags, "reason");
  if (!reason?.trim()) return jsonError(parsed, "AWG_ACK_MISSING_REASON", "Missing required --reason", { nodeId });
  const reviewAfter = str(parsed.flags, "review-after") ?? defaultReviewAfter();
  if (!validDate(reviewAfter)) return jsonError(parsed, "AWG_ACK_MALFORMED_REVIEW_AFTER", `Invalid --review-after: ${reviewAfter}`, { nodeId });
  const scope = str(parsed.flags, "scope", "general") ?? "general";
  if (!ACK_SCOPES.has(scope)) return jsonError(parsed, "AWG_ACK_INVALID_SCOPE", "--scope must be focus, risk, question, task, or general", { nodeId, scope });
  const stale = staleGuard(parsed, node);
  if (!stale.ok) return jsonError(parsed, stale.code, stale.message, { nodeId, nodeUpdatedAt: node.updated_at, suggestedCommands: [`awg node show ${nodeId} --json`] });
  const run = resolveWriteRun(parsed, graph, nodeId);
  if (!run.ok) return jsonError(parsed, run.code, run.message, { nodeId });
  const runId = run.runId;
  const at = nowIso();
  const eventId = eventIdFor(nodeId, "ack", at, reason, reviewAfter);
  const event: AwgEvent = attachRun({
    awg: AWG_VERSION,
    kind: "event",
    id: eventId,
    type: "node.acknowledged",
    target: nodeId,
    by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex",
    at,
    scope,
    reason,
    review_after: reviewAfter,
    acknowledgedNodeUpdatedAt: node.updated_at,
    acknowledgedMaterialKeys: ["status", "summary", "body", "fields", "freshness", "edges"]
  }, runId);
  await storage.appendLogEntry(event);
  const warnings = str(parsed.flags, "review-after") ? [] : [{ code: "AWG_ACK_DEFAULT_REVIEW_AFTER", message: "No --review-after provided; defaulted to 30 days." }];
  const output = { ok: true, nodeId, runId, acknowledgementId: eventId, eventId, reviewAfter, acknowledgedNodeUpdatedAt: node.updated_at, acknowledgedMaterialKeys: event.acknowledgedMaterialKeys, warnings, suggestedCommands: [`awg node show ${nodeId} --json`] };
  if (parsed.flags.json) return printJson(output);
  console.log(`Acknowledged ${nodeId} until ${reviewAfter}`);
}

export async function sweepCommand(parsed: ParsedArgs): Promise<void> {
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false, coordinationAsOf: nowIso() });
  const limit = parseNumberFlag(parsed, "limit", parsed.flags.json ? 50 : 20);
  if (!limit.ok) return jsonError(parsed, limit.code, limit.message, {});
  const olderThan = parseDurationDays(parsed, "older-than");
  if (!olderThan.ok) return jsonError(parsed, olderThan.code, olderThan.message, {});
  let items = projectAttention(graph.attention_index, graph, { goal: str(parsed.flags, "goal"), asOf: nowIso() });
  if (olderThan.value !== undefined) {
    const thresholdDays = olderThan.value;
    items = items.filter((item) => item.ageDays >= thresholdDays || item.updatedAgeDays >= thresholdDays);
  }
  const groups = {
    safe_closeout_candidate: items.filter((item) => (item.effectiveAttentionState ?? item.baseAttentionState) === "closeout_candidate" && item.autonomousSafe),
    needs_evidence: items.filter((item) => item.closeoutReasons.some((reason) => reason.includes("evidence")) && !item.evidenceIds.length),
    needs_human_review: items.filter((item) => item.needsHumanReview && ["closeout_candidate", "stale_open"].includes(item.effectiveAttentionState ?? item.baseAttentionState)),
    acknowledge_or_schedule_review: items.filter((item) => item.suggestedDisposition === "acknowledge_or_schedule_review" || item.acknowledgementStale),
    stale_but_current_goal_related: items.filter((item) => item.baseAttentionState === "stale_open" && item.goalMatched),
    historical_background: items.filter((item) => item.baseAttentionState === "historical").slice(0, limit.value)
  };
  const truncated: Record<string, number> = {};
  const limited = Object.fromEntries(Object.entries(groups).map(([key, values]) => {
    truncated[key] = Math.max(0, values.length - limit.value);
    return [key, values.slice(0, limit.value)];
  }));
  const output = { ok: true, generated_at: graph.generated_at, asOf: nowIso(), summary: graph.attention_index?.summary, groups: limited, warnings: [], truncated, suggestedCommands: ["awg closeout candidates --json", "awg closeout run --json"] };
  if (parsed.flags.json) return printJson(output);
  for (const [group, values] of Object.entries(limited)) {
    if (!(values as AttentionItem[]).length) continue;
    console.log(`\n${group}`);
    for (const item of values as AttentionItem[]) console.log(`- ${item.nodeId} ${item.nodeTitle} (${item.baseAttentionState})`);
  }
}

async function closeoutCandidates(parsed: ParsedArgs): Promise<void> {
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false, coordinationAsOf: nowIso() });
  const run = resolveReadRun(graph, str(parsed.flags, "run"));
  if (!run.ok) return jsonError(parsed, run.code, run.message, {});
  const runId = run.runId;
  const limit = parseNumberFlag(parsed, "limit", parsed.flags.json ? 50 : 20);
  if (!limit.ok) return jsonError(parsed, limit.code, limit.message, {});
  const olderThan = parseDurationDays(parsed, "older-than");
  if (!olderThan.ok) return jsonError(parsed, olderThan.code, olderThan.message, {});
  let baseItems = (graph.attention_index?.items ?? []).filter((item) => item.baseAttentionState === "closeout_candidate");
  if (runId) baseItems = baseItems.filter((item) => item.lastTouchedRunIds.includes(runId) || item.recentRunIds.includes(runId));
  if (olderThan.value !== undefined) baseItems = projectAttention({ ...graph.attention_index!, items: baseItems }, graph, { asOf: nowIso() }).filter((item) => item.ageDays >= olderThan.value! || item.updatedAgeDays >= olderThan.value!);
  const projected = projectAttention({ ...graph.attention_index!, items: baseItems }, graph, { goal: str(parsed.flags, "goal"), asOf: nowIso() });
  const candidates = projected.slice(0, limit.value).map((item) => candidateJson(item, graph));
  const output = { ok: true, generated_at: graph.generated_at, asOf: nowIso(), runId, goal: str(parsed.flags, "goal"), candidates, truncated: Math.max(0, projected.length - candidates.length), warnings: [] };
  if (parsed.flags.json) return printJson(output);
  if (!candidates.length) return console.log("No closeout candidates match this filter.");
  for (const candidate of candidates) console.log(`- ${candidate.nodeId} ${candidate.title} -> ${candidate.suggestedDisposition} (${(candidate.reasons as string[]).join("; ")})`);
}

async function closeoutRun(parsed: ParsedArgs): Promise<void> {
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false, coordinationAsOf: nowIso() });
  const run = resolveReadRun(graph, str(parsed.flags, "run") ?? "current");
  if (!run.ok) return jsonError(parsed, run.code, run.message, {});
  const runId = run.runId;
  if (!runId) return jsonError(parsed, "AWG_RUN_NOT_FOUND", "No run found for closeout.", {});
  const runSummary = ((graph.run_summaries ?? []) as Array<{ runId?: string; touchedNodeIds?: string[] }>).find((summary) => summary.runId === runId);
  const touched = new Set(runSummary?.touchedNodeIds ?? []);
  const categoryLimit = parseNumberFlag(parsed, "category-limit", 8);
  if (!categoryLimit.ok) return jsonError(parsed, categoryLimit.code, categoryLimit.message, {});
  const limit = parseNumberFlag(parsed, "limit", 30);
  if (!limit.ok) return jsonError(parsed, limit.code, limit.message, {});
  const attention = touched.size ? projectAttention(graph.attention_index, graph, { nodeIds: [...touched], asOf: nowIso() }) : [];
  const categories = {
    closeoutCandidates: attention.filter((item) => item.baseAttentionState === "closeout_candidate"),
    staleAcknowledgements: attention.filter((item) => item.acknowledgementStale),
    touchedOpen: attention.filter((item) => ["current", "open", "stale_open", "acknowledged_open"].includes(item.baseAttentionState)),
    missingEvidence: (graph.work_queue_index?.items ?? []).filter((item) => item.queue === "evidence_needed" && item.nodeIds.some((id) => touched.has(id))),
    unreleasedCoordination: (graph.coordination_index?.claims ?? []).filter((claim) => claim.runId === runId && ["active", "stale"].includes(claim.status))
  };
  const truncated: Record<string, number> = {};
  const limited = Object.fromEntries(Object.entries(categories).map(([key, values]) => {
    const cap = Math.min(categoryLimit.value, limit.value);
    truncated[key] = Math.max(0, values.length - cap);
    return [key, values.slice(0, cap)];
  }));
  const output = { ok: true, runId, generated_at: graph.generated_at, asOf: nowIso(), summary: { touched: touched.size, closeoutCandidates: categories.closeoutCandidates.length, staleAcknowledgements: categories.staleAcknowledgements.length, unreleasedCoordination: categories.unreleasedCoordination.length }, categories: limited, warnings: [], truncated, suggestedCommands: [`awg closeout candidates --run ${runId} --json`] };
  if (parsed.flags.json) return printJson(output);
  console.log(`Closeout for ${runId}: ${output.summary.closeoutCandidates} candidates, ${output.summary.staleAcknowledgements} stale acknowledgements.`);
}

async function closeoutMark(parsed: ParsedArgs): Promise<void> {
  const nodeId = parsed.positionals[2];
  if (!nodeId) return jsonError(parsed, "AWG_CLOSEOUT_MARK_USAGE", "Usage: awg closeout mark <node-id> --status <status> --reason <text>", {});
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false, coordinationAsOf: nowIso() });
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return jsonError(parsed, "AWG_CLOSEOUT_MISSING_TARGET", `Node not found: ${nodeId}`, { nodeId });
  const status = str(parsed.flags, "status");
  if (!status || !CLOSEOUT_STATUSES.has(status) || !CORE_STATUSES.includes(status as never)) return jsonError(parsed, "AWG_CLOSEOUT_INVALID_STATUS", "--status must be completed, resolved, archived, superseded, or needs_review", { nodeId });
  const reason = str(parsed.flags, "reason");
  if (!reason?.trim()) return jsonError(parsed, "AWG_CLOSEOUT_MISSING_REASON", "Missing required --reason", { nodeId });
  const stale = staleGuard(parsed, node);
  if (!stale.ok) return jsonError(parsed, stale.code, stale.message, { nodeId, nodeUpdatedAt: node.updated_at, suggestedCommands: [`awg node show ${nodeId} --json`] });
  const target = str(parsed.flags, "target");
  const rel = str(parsed.flags, "rel");
  if (target && !graph.nodes.some((candidate) => candidate.id === target)) return jsonError(parsed, "AWG_CLOSEOUT_TARGET_NOT_FOUND", `Target node not found: ${target}`, { nodeId, target, suggestedCommands: [`awg node show ${target} --json`] });
  if (target === nodeId) return jsonError(parsed, "AWG_CLOSEOUT_SELF_TARGET", "--target must be a different node", { nodeId, target });
  if (target && (!rel || !TARGET_RELS.has(rel))) return jsonError(parsed, "AWG_CLOSEOUT_INVALID_REL", "--target requires --rel implements|verified_by|supports|resolved_by|superseded_by", { nodeId, target });
  if (status === "superseded" && target && rel !== "superseded_by") return jsonError(parsed, "AWG_CLOSEOUT_INVALID_REL", "--status superseded with --target requires --rel superseded_by", { nodeId, target });
  if (status === "resolved" && target && rel !== "resolved_by") return jsonError(parsed, "AWG_CLOSEOUT_INVALID_REL", "--status resolved with --target requires --rel resolved_by", { nodeId, target });
  const run = resolveWriteRun(parsed, graph, nodeId);
  if (!run.ok) return jsonError(parsed, run.code, run.message, { nodeId });
  const runId = run.runId;
  const at = nowIso();
  const by = str(parsed.flags, "by", "agent:codex") ?? "agent:codex";
  try {
    guardTemplateSelfApproval(node, { status }, by);
  } catch (error) {
    return jsonError(parsed, "AWG_CLOSEOUT_TEMPLATE_APPROVAL_REQUIRED", error instanceof Error ? error.message : String(error), { nodeId });
  }
  const next: AwgNode = attachRun({ ...node, status, updated_at: at }, runId);
  await storage.appendLogEntry(next);
  const updateEventId = eventIdFor(nodeId, "update", at, status);
  const updateEvent: AwgEvent = attachRun({ awg: AWG_VERSION, kind: "event", id: updateEventId, type: "node_updated", target: nodeId, by, at, fields: ["status"] }, runId);
  await storage.appendLogEntry(updateEvent);
  const closeoutEventId = eventIdFor(nodeId, "closeout", at, status, reason, target ?? "", rel ?? "");
  const closeoutEvent: AwgEvent = attachRun({ awg: AWG_VERSION, kind: "event", id: closeoutEventId, type: "node.closeout_marked", target: nodeId, by: updateEvent.by, at, status, previousStatus: node.status, reason, expectedUpdatedAt: str(parsed.flags, "expect-updated-at") }, runId);
  await storage.appendLogEntry(closeoutEvent);
  const edgeIds: string[] = [];
  if (target && rel) {
    const edge: AwgEdge = attachRun({ awg: AWG_VERSION, kind: "edge", id: edgeId(nodeId, rel, target), from: nodeId, rel, to: target, created_at: at, reason }, runId);
    await storage.appendLogEntry(edge);
    edgeIds.push(edge.id);
  }
  const output = { ok: true, nodeId, runId, updatedNodeId: nodeId, eventIds: [updateEventId, closeoutEventId], edgeIds, previousStatus: node.status, status, reason, warnings: [], staleRead: { expectedUpdatedAt: str(parsed.flags, "expect-updated-at"), actualUpdatedAt: node.updated_at } };
  if (parsed.flags.json) return printJson(output);
  console.log(`Marked ${nodeId} ${status}`);
}

function candidateJson(item: AttentionItem, graph: CompiledGraph): Record<string, unknown> {
  const node = graph.nodes.find((candidate) => candidate.id === item.nodeId);
  return {
    id: item.id,
    nodeId: item.nodeId,
    title: item.nodeTitle,
    nodeType: item.nodeType,
    nodeStatus: item.nodeStatus,
    baseAttentionState: item.baseAttentionState,
    baseFocusScore: item.baseFocusScore,
    effectiveFocusScore: item.effectiveFocusScore ?? item.baseFocusScore,
    goalMatched: item.goalMatched ?? false,
    nodeUpdatedAt: item.nodeUpdatedAt,
    suggestedDisposition: item.suggestedDisposition ?? "needs_review",
    confidence: confidenceFor(item),
    reasons: item.closeoutReasons,
    suggestedCommands: item.suggestedCommands,
    needsHumanReview: item.needsHumanReview,
    summary: node?.summary
  };
}

function confidenceFor(item: AttentionItem): "low" | "medium" | "high" {
  if (item.closeoutReasons.length >= 2 && item.autonomousSafe) return "high";
  if (item.closeoutReasons.length) return "medium";
  return "low";
}

function resolveReadRun(graph: CompiledGraph, value?: string): { ok: true; runId?: string } | { ok: false; code: string; message: string } {
  if (!value) return { ok: true };
  const runs = buildRuns(graph);
  if (value === "current") {
    const run = activeRun(runs);
    return run ? { ok: true, runId: run.id } : { ok: false, code: "AWG_RUN_NOT_FOUND", message: "No active run found." };
  }
  return runs.some((run) => run.id === value) ? { ok: true, runId: value } : { ok: false, code: "AWG_RUN_NOT_FOUND", message: `Run not found: ${value}` };
}

function staleGuard(parsed: ParsedArgs, node: AwgNode): { ok: true } | { ok: false; code: string; message: string } {
  const expected = str(parsed.flags, "expect-updated-at");
  if (!expected && !parsed.flags.force) return { ok: false, code: "AWG_CLOSEOUT_EXPECTED_REVISION_REQUIRED", message: "Missing required --expect-updated-at. Use --force to override after inspection." };
  if (expected && !validDate(expected)) return { ok: false, code: "AWG_CLOSEOUT_MALFORMED_EXPECTED_UPDATED_AT", message: `Invalid --expect-updated-at: ${expected}` };
  if (expected && expected !== node.updated_at && !parsed.flags.force) return { ok: false, code: "AWG_CLOSEOUT_STALE_TARGET", message: "The node changed since this candidate was generated." };
  return { ok: true };
}

function resolveWriteRun(parsed: ParsedArgs, graph: CompiledGraph, nodeId: string): { ok: true; runId?: string } | { ok: false; code: string; message: string } {
  try {
    return { ok: true, runId: resolveWriteRunId(graph, parsed.flags) };
  } catch (error) {
    return { ok: false, code: "AWG_RUN_NOT_FOUND", message: error instanceof Error ? error.message : `Run not found for ${nodeId}` };
  }
}

function defaultReviewAfter(): string {
  return new Date(Date.now() + 30 * 86_400_000).toISOString();
}

function validDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function parseDurationDays(parsed: ParsedArgs, key: string): { ok: true; value?: number } | { ok: false; code: string; message: string } {
  const value = str(parsed.flags, key);
  if (!value) return { ok: true };
  const match = /^(\d+)(d|day|days)?$/.exec(value);
  if (!match) return { ok: false, code: "AWG_INVALID_DURATION", message: `--${key} must be a duration like 30d` };
  return { ok: true, value: Number(match[1]) };
}

function parseNumberFlag(parsed: ParsedArgs, key: string, fallback: number): { ok: true; value: number } | { ok: false; code: string; message: string } {
  const value = str(parsed.flags, key);
  if (value === undefined) return { ok: true, value: fallback };
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return { ok: false, code: "AWG_INVALID_LIMIT", message: `--${key} must be a non-negative integer` };
  return { ok: true, value: number };
}

function eventIdFor(nodeId: string, type: string, at: string, ...parts: string[]): string {
  const digest = createHash("sha256").update([nodeId, type, at, ...parts].join("\0")).digest("hex").slice(0, 8);
  return `ev:${nodeId.replace(/^n:/, "")}:${type}:${at.replace(/[^0-9]/g, "")}:${digest}`;
}

function jsonError(parsed: ParsedArgs, code: string, message: string, extra: Record<string, unknown>): void {
  if (parsed.flags.json) {
    printJson({ ok: false, code, message, ...extra });
    process.exitCode = 1;
    return;
  }
  throw new Error(message);
}
