import { existsSync } from "node:fs";
import path from "node:path";
import type { CompiledGraph, Diagnostic, OperatingTemplateSummary } from "./types.js";

export interface VaultReadinessCheck {
  id: string;
  ok: boolean;
  severity: "required" | "recommended" | "info";
  message: string;
  nodeIds: string[];
  runIds: string[];
  queueItemIds: string[];
  coordinationIds: string[];
  suggestedCommands: string[];
}

export interface VaultReadinessReport {
  ok: true;
  ready: boolean;
  status: "ready" | "not_ready";
  mode: "standard" | "client-pilot";
  goal: string | null;
  asOf: string;
  checks: VaultReadinessCheck[];
  requiredFailures: number;
  recommendedWarnings: number;
  suggestedNextActions: string[];
}

export function buildVaultReadiness(graph: CompiledGraph, root: string, options: { goal?: string | null; clientPilot?: boolean; asOf?: string } = {}): VaultReadinessReport {
  const mode = options.clientPilot ? "client-pilot" : "standard";
  const asOf = options.asOf ?? graph.generated_at;
  const asOfMs = Date.parse(asOf);
  const checks: VaultReadinessCheck[] = [];
  const add = (check: Partial<VaultReadinessCheck> & Pick<VaultReadinessCheck, "id" | "ok" | "severity" | "message">): void => {
    checks.push({ nodeIds: [], runIds: [], queueItemIds: [], coordinationIds: [], suggestedCommands: [], ...check });
  };
  const diagnostics = graph.diagnostics?.diagnostics ?? [];
  const selected = graph.operating_templates?.selectedTemplate ?? null;

  add({ id: "vault_exists", ok: existsSync(path.join(root, ".awg")), severity: "required", message: ".awg vault exists.", suggestedCommands: ["awg init"] });
  add({ id: "no_fatal_diagnostics", ok: (graph.diagnostics?.summary.fatal_error_count ?? 0) === 0, severity: "required", message: "No fatal diagnostics.", suggestedCommands: ["awg doctor --fix-suggestions --json"] });
  add({ id: "agent_instructions", ok: existsSync(path.join(root, ".awg/AGENTS.md")) || existsSync(path.join(root, "AGENTS.md")), severity: "required", message: "Agent instructions are available.", suggestedCommands: ["awg upgrade --instructions"] });
  add({ id: "release_current", ok: true, severity: "required", message: "Local release metadata is discoverable.", suggestedCommands: ["awg release current --json"] });
  add({ id: "active_operating_template", ok: Boolean(selected), severity: "required", message: selected ? "Reviewed human-approved operating template found." : "No reviewed human-approved operating template found.", nodeIds: selected ? [selected.id] : [], suggestedCommands: ["awg template guide --json", "awg template scaffold --title \"Operating template\" --scope vault --json"] });
  const conflicts = graph.operating_templates?.conflicts ?? [];
  add({ id: "template_conflicts_absent", ok: conflicts.length === 0, severity: "required", message: conflicts.length ? "Conflicting active operating templates must be resolved." : "No conflicting active operating templates.", nodeIds: conflicts.flatMap((conflict) => conflict.templateIds), suggestedCommands: ["awg template status --json"] });
  if (selected) addTemplateChecks(add, selected, Boolean(options.clientPilot));
  add({ id: "queues_available", ok: Boolean(graph.work_queue_index), severity: "recommended", message: "Work queue index is available.", suggestedCommands: ["awg queue next --json"] });
  const highPriorityItems = graph.work_queue_index?.items?.filter((item) => item.priority >= 85 || item.queue === "handoff_followup" || item.queue === "human_review") ?? [];
  add({ id: "high_priority_queue_warnings", ok: highPriorityItems.length === 0, severity: "recommended", message: highPriorityItems.length ? "High-priority queue or handoff follow-up items need review." : "No high-priority queue or handoff warnings.", nodeIds: highPriorityItems.flatMap((item) => item.nodeIds), runIds: highPriorityItems.flatMap((item) => item.runIds), queueItemIds: highPriorityItems.map((item) => item.id), suggestedCommands: ["awg queue next --include-human-review --json"] });
  const staleRuns = (graph.run_summaries as Array<{ id: string; status?: string; updated_at: string }> | undefined ?? []).filter((run) => run.status === "in_progress" && asOfMs - Date.parse(run.updated_at) > 24 * 3_600_000);
  add({ id: "no_stale_active_runs", ok: staleRuns.length === 0, severity: "recommended", message: staleRuns.length ? "Stale active runs need review." : "No stale active runs.", runIds: staleRuns.map((run) => run.id), suggestedCommands: ["awg run status --json"] });
  const secretDiagnostics = diagnostics.filter((diag) => diag.code === "sensitive_value_detected");
  add({ id: "no_secret_like_durable_content", ok: secretDiagnostics.length === 0, severity: options.clientPilot ? "required" : "recommended", message: secretDiagnostics.length ? "Secret-like durable content diagnostics are unresolved." : "No secret-like durable content diagnostics.", nodeIds: ids(secretDiagnostics), suggestedCommands: ["awg doctor --fix-suggestions --json"] });
  const coord = graph.coordination_index;
  const staleClaims = coord?.claims?.filter((claim) => claim.status === "stale") ?? [];
  const collisions = coord?.collisions ?? [];
  add({ id: "coordination_clean", ok: staleClaims.length === 0 && collisions.length === 0, severity: "recommended", message: staleClaims.length || collisions.length ? "Coordination has stale claims or collisions." : "No stale/colliding coordination claims.", coordinationIds: [...staleClaims.map((claim) => claim.id), ...collisions.map((collision) => collision.id)], suggestedCommands: ["awg coord status --json"] });

  const requiredFailures = checks.filter((check) => check.severity === "required" && !check.ok).length;
  const recommendedWarnings = checks.filter((check) => check.severity === "recommended" && !check.ok).length;
  const suggestedNextActions = [...new Set(checks.filter((check) => !check.ok).flatMap((check) => check.suggestedCommands))];
  return { ok: true, ready: requiredFailures === 0, status: requiredFailures === 0 ? "ready" : "not_ready", mode, goal: options.goal?.trim() || null, asOf, checks, requiredFailures, recommendedWarnings, suggestedNextActions };
}

function addTemplateChecks(add: (check: Partial<VaultReadinessCheck> & Pick<VaultReadinessCheck, "id" | "ok" | "severity" | "message">) => void, selected: OperatingTemplateSummary, clientPilot: boolean): void {
  add({ id: "template_required_fields", ok: (selected.missingRequiredFields ?? []).length === 0, severity: "required", message: "Template required fields are present.", nodeIds: [selected.id], suggestedCommands: [`awg node show ${selected.id} --json`] });
  add({ id: "template_recommended_fields", ok: (selected.missingRecommendedFields ?? []).length === 0, severity: "recommended", message: "Template recommended adaptive fields are present or marked not applicable.", nodeIds: [selected.id], suggestedCommands: [`awg node show ${selected.id} --json`] });
  if (!clientPilot) return;
  add({ id: "template_human_approved", ok: selected.reviewState === "reviewed" && selected.humanApproved, severity: "required", message: "Template is reviewed and human-approved.", nodeIds: [selected.id], suggestedCommands: [`awg node show ${selected.id} --json`] });
  add({ id: "template_client_pilot_fields", ok: (selected.missingClientPilotFields ?? []).length === 0, severity: "required", message: "Client-pilot required fields are filled and not placeholders.", nodeIds: [selected.id], suggestedCommands: [`awg node show ${selected.id} --json`] });
  const missingSensitivity = missingSensitivityTopics(selected);
  add({ id: "template_sensitivity_policy", ok: missingSensitivity.length === 0, severity: "required", message: missingSensitivity.length ? `Sensitivity rules are missing: ${missingSensitivity.join(", ")}.` : "Sensitivity rules cover required client-pilot topics.", nodeIds: [selected.id], suggestedCommands: [`awg node show ${selected.id} --json`] });
  const backupMissing = ["backup_rules", "retention_rules", "export_rules"].filter((field) => selected.missingClientPilotFields?.includes(field));
  add({ id: "template_backup_export_retention", ok: backupMissing.length === 0, severity: "required", message: backupMissing.length ? `Missing backup/export/retention rules: ${backupMissing.join(", ")}.` : "Backup, export, and retention rules are present.", nodeIds: [selected.id], suggestedCommands: [`awg node show ${selected.id} --json`] });
}

function missingSensitivityTopics(template: OperatingTemplateSummary): string[] {
  const fields = parsePolicyFields(template.policyText);
  const text = String(fields.sensitivity_rules ?? fields.sensitivityRules ?? "").toLowerCase();
  const required = [
    ["customer PII", /customer\s+(pii|personally identifiable)|pii|personally identifiable/],
    ["private client context", /private\s+client|client\s+context|client\s+confidential|confidential\s+client/],
    ["financials", /financial|finance|revenue|profit|pricing/],
    ["contracts/billing", /contract|billing|invoice|subscription/],
    ["internal strategy", /internal\s+strategy|strategy/],
    ["approval boundaries", /approval|approve|human review/],
    ["credentials/secrets", /credential|secret|password|api key|token/],
    ["source-of-truth systems", /source.?of.?truth/],
    ["redaction expectations", /redact|summari/],
    ["never-capture categories", /never capture|do not capture|non.?capture/]
  ] as const;
  return required.filter(([, pattern]) => !pattern.test(text)).map(([label]) => label);
}

function parsePolicyFields(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function ids(diagnostics: Diagnostic[]): string[] {
  return diagnostics.flatMap((diag) => diag.id ? [diag.id] : []);
}
