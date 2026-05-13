import type { AgentRun, RunSummary } from "./runs.js";
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
  const addNodeWarning = (code: string, message: string, nodeIds: string[], suggestedFix?: string): void => {
    if (nodeIds.length) warnings.push({ code, severity: "warning", message, nodeIds, suggestedFix });
  };

  addNodeWarning("AWG_RUN_COMPLETED_TASK_WITHOUT_EVIDENCE", "Task completed in this run has no evidence.", summary?.completedTasksMissingEvidence ?? [], "Run `awg add evidence --target <node-id> --summary \"...\"`.");
  addNodeWarning("AWG_RUN_EVIDENCE_REQUIRED_WITHOUT_EVIDENCE", "Touched node requires evidence but has none.", touched.filter((id) => Boolean(nodes.get(id)?.evidence_required) && !hasEvidence(nodes.get(id))), "Run `awg add evidence --target <node-id> --summary \"...\"`.");
  addNodeWarning("AWG_RUN_ACTIVE_BLOCKER_TOUCHED", "Blocker touched during this run is still active.", touched.filter((id) => nodes.get(id)?.type === "blocker" && activeStatus(nodes.get(id)?.status)), "Resolve, review, or leave an explicit run note.");
  addNodeWarning("AWG_RUN_ACTIVE_RISK_TOUCHED", "Risk touched during this run is still active.", touched.filter((id) => nodes.get(id)?.type === "risk" && activeStatus(nodes.get(id)?.status)), "Review the risk or leave an explicit run note.");
  addNodeWarning("AWG_RUN_PROPOSED_DECISION_TOUCHED", "Decision touched during this run is still proposed.", summary?.proposedDecisionIds ?? [], "Update the decision status when implementation depends on it.");
  addNodeWarning("AWG_RUN_ORPHAN_NODE_CREATED", "Node created during this run has no graph edges.", summary?.orphanNodeIds ?? [], "Run `awg add edge --from <node-id> --rel relates_to --to <node-id>`.");
  addNodeWarning("AWG_RUN_DUPLICATEISH_NODE_CREATED", "Node created during this run has a duplicate-looking title or alias.", idsForDiagnostics(summary, "duplicate_alias"), "Use `awg search` and update existing nodes instead of duplicating context.");
  addNodeWarning("AWG_RUN_DOCTOR_WARNING_TOUCHED", "Doctor warning affects a node touched during this run.", idsForDiagnostics(summary), "Run `awg doctor --fix-suggestions --json` and address relevant suggestions.");
  addNodeWarning("AWG_RUN_STALE_TOUCHED_NODE", "Touched node is stale or needs review.", summary?.staleOrNeedsReviewNodeIds ?? [], "Review and update the node status or review_after metadata.");

  if (!run.notes.length) warnings.push({ code: "AWG_RUN_NO_NOTES", severity: "warning", message: "Run has no notes.", suggestedFix: "Run `awg run note \"...\"` with meaningful progress or blockers." });
  if (!touched.length && !(summary?.createdEdgeIds.length || summary?.responseIds.length || summary?.evidenceNodeIds.length)) warnings.push({ code: "AWG_RUN_NO_CHANGES", severity: "warning", message: "Run has no changed or touched graph objects.", suggestedFix: "Record durable work before finishing, or finish as partial/abandoned." });
  if (!summary?.handoffGenerated) warnings.push({ code: "AWG_RUN_NO_HANDOFF", severity: "warning", message: "Run has no recorded handoff yet.", suggestedFix: "Use `awg run finish --auto-handoff` or `awg handoff`." });

  return { ok: warnings.length === 0, warnings: dedupeWarnings(warnings) };
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
    { id: "new_orphans_reported_clean", ok: (summary?.orphanNodeIds.length ?? 0) === 0, weight: 10, count: summary?.orphanNodeIds.length ?? 0 },
    { id: "risks_blockers_reviewed_or_open", ok: !pf.warnings.some((w) => w.code === "AWG_RUN_ACTIVE_BLOCKER_TOUCHED" || w.code === "AWG_RUN_ACTIVE_RISK_TOUCHED"), weight: 10 },
    { id: "proposed_decisions_not_silent", ok: (summary?.proposedDecisionIds.length ?? 0) === 0, weight: 10, count: summary?.proposedDecisionIds.length ?? 0 },
    { id: "doctor_clean_for_touched_nodes", ok: (summary?.diagnostics.filter((d) => d.severity === "fatal" || d.severity === "warning").length ?? 0) === 0, weight: 15, count: summary?.diagnostics.filter((d) => d.severity === "fatal" || d.severity === "warning").length ?? 0 },
    { id: "handoff_generated", ok: Boolean(summary?.handoffGenerated), weight: 10 },
    { id: "stale_touched_nodes_surfaced", ok: (summary?.staleOrNeedsReviewNodeIds.length ?? 0) === 0, weight: 10, count: summary?.staleOrNeedsReviewNodeIds.length ?? 0 }
  ];
  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  const earned = checks.reduce((sum, check) => sum + (check.ok ? check.weight : 0), 0);
  return { score: Math.round((earned / total) * 100), checks };
}

export function runSummaryFor(graph: CompiledGraph, runId: string): RunSummary | undefined {
  return (graph.run_summaries as RunSummary[] | undefined)?.find((summary) => summary.runId === runId);
}

function hasEvidence(node: unknown): boolean {
  return Boolean(node && typeof node === "object" && Array.isArray((node as { evidence?: unknown[] }).evidence) && (node as { evidence?: unknown[] }).evidence!.length);
}

function activeStatus(status: unknown): boolean {
  return typeof status === "string" && ["active", "blocked", "in_progress", "needs_review", "proposed", "stale"].includes(status);
}

function idsForDiagnostics(summary: RunSummary | undefined, code?: string): string[] {
  return [...new Set((summary?.diagnostics ?? []).filter((diag) => !code || diag.code === code).map((diag) => diag.id).filter((id): id is string => Boolean(id)))].sort();
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
