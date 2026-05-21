import type { AgentRun, RunSummary } from "./runs.js";
import { isBlockDiagnosticCode } from "./blocks.js";
import { hasEvidenceReference } from "./evidence.js";
import { runIdFromObject } from "./runAttribution.js";
import { filterInboxItems } from "./maintenance.js";
import { filterWorkQueueItems } from "./workQueues.js";
import type { CompiledGraph } from "./types.js";

export interface RunPreflightWarning {
  code: string;
  severity: "warning";
  message: string;
  nodeIds?: string[];
  suggestedFix?: string;
}

export interface RunPreflightResult {
  ok: boolean;
  warnings: RunPreflightWarning[];
}

export interface HandoffQuality {
  score: number;
  checks: Array<{ id: string; ok: boolean; weight: number; count?: number }>;
}

export function preflightRun(graph: CompiledGraph, run: AgentRun): RunPreflightResult {
  const summary = runSummaryFor(graph, run.id);
  const warnings: RunPreflightWarning[] = [];
  const touched = summary?.touchedNodeIds ?? run.changed_nodes;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map<string, CompiledGraph["edges"]>();
  for (const edge of graph.edges) {
    const incoming = incomingByTarget.get(edge.to) ?? [];
    incoming.push(edge);
    incomingByTarget.set(edge.to, incoming);
  }
  const hasNodeEvidence = (id: string): boolean => hasEvidenceReference(nodes.get(id), incomingByTarget.get(id) ?? [], nodes);
  const touchedClaims = (graph.claim_index?.claims ?? []).filter((claim) => touched.includes(claim.id));
  const addNodeWarning = (code: string, message: string, nodeIds: string[], suggestedFix?: string): void => {
    if (nodeIds.length) warnings.push({ code, severity: "warning", message, nodeIds, suggestedFix });
  };

  addNodeWarning("AWG_RUN_COMPLETED_TASK_WITHOUT_EVIDENCE", "Task completed in this run has no evidence.", summary?.completedTasksMissingEvidence ?? [], "Run `awg add evidence --target <node-id> --summary \"...\"`.");
  addNodeWarning("AWG_RUN_EVIDENCE_REQUIRED_WITHOUT_EVIDENCE", "Touched node requires evidence but has none.", touched.filter((id) => Boolean(nodes.get(id)?.evidence_required) && !hasNodeEvidence(id)), "Run `awg add evidence --target <node-id> --summary \"...\"`.");
  addNodeWarning("AWG_RUN_CLAIM_CONTRADICTION_UNRESOLVED", "Touched claim has unresolved contradictory evidence.", touchedClaims.filter((claim) => claim.verificationStatus === "contradicted").map((claim) => claim.id), "Run `awg claim status <node-id> --json` and resolve or supersede the contradiction.");
  addNodeWarning("AWG_RUN_CLAIM_REQUIRED_EVIDENCE_MISSING", "Touched claim is missing required supporting evidence.", touchedClaims.filter((claim) => claim.verificationStatus === "unverified").map((claim) => claim.id), "Run `awg verify <node-id> --summary \"...\"`.");
  addNodeWarning("AWG_RUN_CLAIM_STALE_OR_EXPIRED", "Touched claim is stale or expired.", touchedClaims.filter((claim) => claim.stale || claim.expired || ["stale", "expired"].includes(claim.verificationStatus)).map((claim) => claim.id), "Review and verify the claim or mark it needs_review.");
  addNodeWarning("AWG_RUN_EVIDENCE_EXPIRED", "Touched evidence is expired.", (graph.evidence_index?.evidence ?? []).filter((evidence) => touched.includes(evidence.id) && evidence.expired).map((evidence) => evidence.id), "Add newer evidence or supersede the expired evidence.");
  addNodeWarning("AWG_RUN_ACTIVE_BLOCKER_TOUCHED", "Blocker touched during this run is still active.", touched.filter((id) => nodes.get(id)?.type === "blocker" && activeStatus(nodes.get(id)?.status) && !isIntentionallyOpen(graph, id) && !isAcknowledgedOpen(graph, id)), "Resolve, review, or run `awg ack <node-id> --reason \"...\" --review-after <date>`.");
  addNodeWarning("AWG_RUN_ACTIVE_RISK_TOUCHED", "Risk touched during this run is still active.", touched.filter((id) => nodes.get(id)?.type === "risk" && activeStatus(nodes.get(id)?.status) && !isIntentionallyOpen(graph, id) && !isAcknowledgedOpen(graph, id)), "Review the risk or run `awg ack <node-id> --reason \"...\" --review-after <date>`.");
  addNodeWarning("AWG_RUN_PROPOSED_DECISION_TOUCHED", "Decision touched during this run is still proposed.", summary?.proposedDecisionIds ?? [], "Update the decision status when implementation depends on it.");
  addNodeWarning("AWG_RUN_ORPHAN_NODE_CREATED", "Node created during this run has no graph edges.", summary?.orphanNodeIds ?? [], "Run `awg add edge --from <node-id> --rel relates_to --to <node-id>`.");
  addNodeWarning("AWG_RUN_DUPLICATEISH_NODE_CREATED", "Node created during this run has a duplicate-looking title or alias.", idsForDiagnostics(summary, "duplicate_alias"), "Use `awg search` and update existing nodes instead of duplicating context.");
  addNodeWarning("AWG_RUN_DOCTOR_WARNING_TOUCHED", "Doctor warning affects a node touched during this run.", idsForDiagnostics(summary), "Run `awg doctor --fix-suggestions --json` and address relevant suggestions.");
  addNodeWarning("AWG_RUN_STALE_TOUCHED_NODE", "Touched node is stale or needs review.", summary?.staleOrNeedsReviewNodeIds ?? [], "Review and update the node status or review_after metadata.");
  addNodeWarning("AWG_RUN_INVALID_BLOCK_TOUCHED", "Touched node has invalid or unsupported presentation blocks.", idsForDiagnostics(summary, isBlockDiagnosticCode), "Replace node blocks with supported V1.7 data primitives.");
  addNodeWarning("AWG_RUN_TEMPLATE_FIELD_MISSING", "Touched node is missing a field required by the active operating template.", idsForDiagnostics(summary, "missing_required_field"), "Update the node with the required structured field.");
  addNodeWarning("AWG_RUN_SENSITIVE_VALUE_TOUCHED", "Touched node appears to contain a secret-like value.", idsForDiagnostics(summary, "sensitive_value_detected"), "Redact the value and keep only a safe reference.");
  const unresolvedCrossVault = touched.filter((id) => hasUnhandledCrossVaultImpact(nodes.get(id), run.id, graph.nodes));
  addNodeWarning("AWG_RUN_CROSS_VAULT_IMPACT_UNHANDLED", "Touched node has open cross-vault impact with no same-run handoff task.", unresolvedCrossVault, "Update the target vault explicitly, or create a task with fields.kind=cross_vault_handoff and fields.targetVaultId.");
  const runClaims = (graph.coordination_index?.claims ?? []).filter((claim) => claim.runId === run.id && (claim.status === "active" || claim.status === "stale"));
  addNodeWarning("AWG_RUN_COORDINATION_UNRELEASED_CLAIM", "Run has unreleased coordination claims.", runClaims.map((claim) => claim.id), "Run `awg coord release <coordination-id> --status completed --summary \"...\"`.");
  addNodeWarning("AWG_RUN_COORDINATION_COLLISION_UNRESOLVED", "Run has unresolved coordination collisions.", runClaims.filter((claim) => claim.collisionIds.length).map((claim) => claim.id), "Run `awg coord status --json` and release, hand off, or document the overlap.");
  addNodeWarning("AWG_RUN_COORDINATION_STALE_CLAIM", "Run has stale coordination claims.", runClaims.filter((claim) => claim.status === "stale").map((claim) => claim.id), "Run `awg coord release <coordination-id> --status abandoned --summary \"...\"`.");
  const otherRunClaims = (graph.coordination_index?.claims ?? []).filter((claim) => claim.status === "active" && claim.runId !== run.id && claim.mode === "exclusive" && claim.nodeIds.some((id) => touched.includes(id)));
  addNodeWarning("AWG_RUN_COORDINATION_OTHER_RUN_CLAIM_TOUCHED", "Touched node is claimed by another active run.", otherRunClaims.flatMap((claim) => claim.nodeIds.filter((id) => touched.includes(id))), "Run `awg coord check --target <node-id> --json`.");
  const touchedAttention = (graph.attention_index?.items ?? []).filter((item) => touched.includes(item.nodeId));
  addNodeWarning("AWG_RUN_CLOSEOUT_CANDIDATE_TOUCHED", "Touched node is a closeout candidate.", touchedAttention.filter((item) => item.baseAttentionState === "closeout_candidate").map((item) => item.nodeId), "Run `awg closeout run --json` and close or acknowledge touched lifecycle debt.");
  addNodeWarning("AWG_RUN_ACK_STALE_TOUCHED", "Touched node has a stale acknowledgement.", touchedAttention.filter((item) => item.acknowledgementStale).map((item) => item.nodeId), "Run `awg ack <node-id> --reason \"...\" --review-after <date>` after review.");
  addNodeWarning("AWG_RUN_UNACKNOWLEDGED_RISK_OR_BLOCKER", "Touched risk or blocker remains open and unacknowledged.", touchedAttention.filter((item) => ["risk", "blocker"].includes(item.nodeType) && ["current", "open", "stale_open", "closeout_candidate"].includes(item.baseAttentionState) && !item.acknowledgementId).map((item) => item.nodeId), "Resolve the item or run `awg ack <node-id> --reason \"...\" --review-after <date>`.");
  if (touched.length) {
    for (const item of filterInboxItems(graph.maintenance_inbox, { nodeIds: touched, limit: 8 }).filter((item) => item.priority >= 70)) {
      warnings.push({ code: "AWG_RUN_INBOX_ITEM_TOUCHED", severity: "warning", message: item.message, nodeIds: item.nodeIds, suggestedFix: item.suggestedCommands[0] ?? "Run `awg inbox --json`." });
    }
    for (const item of filterWorkQueueItems(graph.work_queue_index, { includeHumanReview: true }).filter((item) => item.priority >= 80 && item.nodeIds.some((id) => touched.includes(id))).slice(0, 8)) {
      warnings.push({ code: "AWG_RUN_QUEUE_ITEM_TOUCHED", severity: "warning", message: item.title, nodeIds: item.nodeIds, suggestedFix: item.suggestedCommands[0] ?? "Run `awg queue next --json`." });
    }
  }

  if (!run.notes.length) warnings.push({ code: "AWG_RUN_NO_NOTES", severity: "warning", message: "Run has no notes.", suggestedFix: "Run `awg run note \"...\"` with meaningful progress or blockers." });
  if (!touched.length && !(summary?.createdEdgeIds.length || summary?.responseIds.length || summary?.evidenceNodeIds.length || summary?.viewIds.length || summary?.lensIds.length)) warnings.push({ code: "AWG_RUN_NO_CHANGES", severity: "warning", message: "Run has no changed or touched graph objects.", suggestedFix: "Record durable work before finishing, or finish as partial/abandoned." });
  if (!summary?.handoffGenerated) warnings.push({ code: "AWG_RUN_NO_HANDOFF", severity: "warning", message: "Run has no recorded handoff yet.", suggestedFix: "Use `awg run finish --auto-handoff` or `awg handoff`." });

  return { ok: warnings.length === 0, warnings: dedupeWarnings(warnings) };
}

function isIntentionallyOpen(graph: CompiledGraph, nodeId: string): boolean {
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return false;
  return graph.edges.some((edge) => edge.rel === "intentionally_open" && edge.from === nodeId && edge.to === nodeId && Boolean(edge.reason) && edge.created_at >= node.updated_at);
}

function isAcknowledgedOpen(graph: CompiledGraph, nodeId: string): boolean {
  const item = graph.attention_index?.items.find((candidate) => candidate.nodeId === nodeId);
  return item?.baseAttentionState === "acknowledged_open" && !item.acknowledgementStale;
}

function hasUnhandledCrossVaultImpact(node: unknown, runId: string, nodes: Map<string, CompiledGraph["nodes"][number]> | CompiledGraph["nodes"]): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const record = node as CompiledGraph["nodes"][number];
  const refs = record.fields?.crossVaultRefs;
  if (!Array.isArray(refs)) return false;
  const open = refs.filter((ref) => {
    const item = ref && typeof ref === "object" && !Array.isArray(ref) ? ref as Record<string, unknown> : {};
    return typeof item.vaultId === "string" && !["reviewed", "resolved", "handoff_recorded"].includes(String(item.status ?? "open"));
  }) as Array<Record<string, unknown>>;
  if (!open.length) return false;
  const allNodes = nodes instanceof Map ? [...nodes.values()] : nodes;
  return !open.every((ref) => allNodes.some((candidate) => {
    const fields = candidate.fields ?? {};
    const sourceRunId = typeof fields.sourceRunId === "string" ? fields.sourceRunId : undefined;
    const sourceNodeIds = Array.isArray(fields.sourceNodeIds) ? fields.sourceNodeIds : [];
    return candidate.type === "task" && fields.kind === "cross_vault_handoff" && fields.targetVaultId === ref.vaultId && runIdFromObject(candidate) === runId && (sourceRunId === runId || sourceNodeIds.includes(record.id));
  }));
}

export function qualityForRun(graph: CompiledGraph, run: AgentRun | undefined, preflight?: RunPreflightResult): HandoffQuality {
  const summary = run ? runSummaryFor(graph, run.id) : undefined;
  const pf = run ? preflight ?? preflightRun(graph, run) : { warnings: [] };
  const checks = [
    { id: "run_finished", ok: Boolean(run && run.status !== "in_progress"), weight: 10 },
    { id: "run_summary_present", ok: Boolean(run?.summary), weight: 10 },
    { id: "run_note_or_change_present", ok: Boolean((run?.notes.length ?? 0) > 0 || (summary?.touchedNodeIds.length ?? 0) > 0), weight: 10 },
    { id: "completed_tasks_have_evidence", ok: (summary?.completedTasksMissingEvidence.length ?? 0) === 0, weight: 20, count: summary?.completedTasksMissingEvidence.length ?? 0 },
    { id: "evidence_required_nodes_have_evidence", ok: !pf.warnings.some((w) => w.code === "AWG_RUN_EVIDENCE_REQUIRED_WITHOUT_EVIDENCE"), weight: 15 },
    { id: "claim_trust_issues_absent", ok: !pf.warnings.some((w) => w.code.startsWith("AWG_RUN_CLAIM_")), weight: 15 },
    { id: "new_orphans_reported_clean", ok: (summary?.orphanNodeIds.length ?? 0) === 0, weight: 10, count: summary?.orphanNodeIds.length ?? 0 },
    { id: "risks_blockers_reviewed_or_open", ok: !pf.warnings.some((w) => w.code === "AWG_RUN_ACTIVE_BLOCKER_TOUCHED" || w.code === "AWG_RUN_ACTIVE_RISK_TOUCHED"), weight: 10 },
    { id: "proposed_decisions_not_silent", ok: (summary?.proposedDecisionIds.length ?? 0) === 0, weight: 10, count: summary?.proposedDecisionIds.length ?? 0 },
    { id: "doctor_clean_for_touched_nodes", ok: (summary?.diagnostics.filter((d) => d.severity === "fatal" || d.severity === "warning").length ?? 0) === 0, weight: 15, count: summary?.diagnostics.filter((d) => d.severity === "fatal" || d.severity === "warning").length ?? 0 },
    { id: "handoff_generated", ok: Boolean(summary?.handoffGenerated), weight: 10 },
    { id: "stale_touched_nodes_surfaced", ok: (summary?.staleOrNeedsReviewNodeIds.length ?? 0) === 0, weight: 10, count: summary?.staleOrNeedsReviewNodeIds.length ?? 0 },
    { id: "active_template_discovered", ok: (graph.operating_templates?.activeTemplates.length ?? 0) > 0, weight: 5, count: graph.operating_templates?.activeTemplates.length ?? 0 },
    { id: "template_conflicts_absent", ok: (graph.operating_templates?.conflicts.length ?? 0) === 0, weight: 5, count: graph.operating_templates?.conflicts.length ?? 0 },
    { id: "invalid_blocks_absent_for_touched_nodes", ok: !pf.warnings.some((w) => w.code === "AWG_RUN_INVALID_BLOCK_TOUCHED"), weight: 10 },
    { id: "template_required_fields_present", ok: !pf.warnings.some((w) => w.code === "AWG_RUN_TEMPLATE_FIELD_MISSING"), weight: 10 },
    { id: "secret_like_values_absent", ok: !pf.warnings.some((w) => w.code === "AWG_RUN_SENSITIVE_VALUE_TOUCHED"), weight: 10 },
    { id: "cross_vault_impacts_handled", ok: !pf.warnings.some((w) => w.code === "AWG_RUN_CROSS_VAULT_IMPACT_UNHANDLED"), weight: 10 }
  ];
  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + (check.ok ? check.weight : 0), 0);
  return { score: Math.round((earned / total) * 100), checks };
}

export function runSummaryFor(graph: CompiledGraph, runId: string): RunSummary | undefined {
  return (graph.run_summaries as RunSummary[] | undefined)?.find((summary) => summary.runId === runId);
}

function activeStatus(status: unknown): boolean {
  return typeof status === "string" && ["active", "blocked", "in_progress", "needs_review", "proposed", "stale"].includes(status);
}

function idsForDiagnostics(summary: RunSummary | undefined, code?: string | ((code: string) => boolean)): string[] {
  return [...new Set((summary?.diagnostics ?? []).filter((diag) => {
    if (!code) return true;
    return typeof code === "string" ? diag.code === code : code(diag.code);
  }).map((diag) => diag.id).filter((id): id is string => Boolean(id)))].sort();
}

function dedupeWarnings(warnings: RunPreflightWarning[]): RunPreflightWarning[] {
  const seen = new Set<string>();
  const out: RunPreflightWarning[] = [];
  for (const warning of warnings) {
    const key = `${warning.code}\0${(warning.nodeIds ?? []).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(warning);
  }
  return out;
}
