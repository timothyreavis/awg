import { isPastDate } from "../util/time.js";
import { validateNodeBlocks } from "./blocks.js";
import { hasEvidenceReference } from "./evidence.js";
import { isTemplateNode, templateSummary } from "./operatingTemplates.js";
import { buildRuns } from "./runs.js";
import { runIdFromObject } from "./runAttribution.js";
import type { AwgEdge, AwgEvent, AwgNode, AwgResponse, AwgView, Diagnostic, DiagnosticsSummary, OperatingTemplateIndex } from "./types.js";

export function buildDiagnostics(
  nodes: AwgNode[],
  edges: AwgEdge[],
  responses: AwgResponse[],
  views: AwgView[],
  events: AwgEvent[],
  existing: Diagnostic[],
  strict: boolean,
  config?: Record<string, unknown> | null,
  operatingTemplates?: OperatingTemplateIndex
): { diagnostics: Diagnostic[]; summary: DiagnosticsSummary; recommended: string[] } {
  const diagnostics = [...existing];
  const severity = (code: string): "fatal" | "warning" => strict ? "fatal" : "warning";
  const nodeIds = new Set(nodes.map((node) => node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const linked = new Set<string>();
  const edgeKeys = new Map<string, string>();
  const incomingByTarget = new Map<string, AwgEdge[]>();

  for (const edge of edges) {
    if (countsAsGraphLink(edge)) {
      linked.add(edge.from);
      linked.add(edge.to);
    }
    const incoming = incomingByTarget.get(edge.to) ?? [];
    incoming.push(edge);
    incomingByTarget.set(edge.to, incoming);
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      diagnostics.push({
        severity: strict ? "fatal" : "warning",
        code: "dangling_edge",
        message: `Edge ${edge.id} references missing node(s): ${edge.from} -> ${edge.to}`,
        id: edge.id
      });
    }
    const key = `${edge.from}\0${edge.rel}\0${edge.to}`;
    const prior = edgeKeys.get(key);
    if (prior && prior !== edge.id) diagnostics.push({ severity: severity("duplicate_edge"), code: "duplicate_edge", message: `Duplicate edge relation ${edge.from} ${edge.rel} ${edge.to}`, id: edge.id });
    edgeKeys.set(key, edge.id);
  }

  const runConfig = ((config?.doctor && typeof config.doctor === "object" ? config.doctor : {}) as Record<string, unknown>);
  const activeRunStaleHours = numberConfig(runConfig.activeRunStaleHours, 24);
  const runNoteStaleHours = numberConfig(runConfig.runNoteStaleHours, 4);
  const recentRunWindowDays = numberConfig(runConfig.recentRunWindowDays, 7);
  const now = Date.now();
  const recentCutoff = now - recentRunWindowDays * 86_400_000;
  const runActivity = buildRunActivity(nodes, edges, responses, views, nodeById);
  const runs = buildRuns({ events });
  for (const run of runs) {
    if (run.status === "in_progress") {
      if (now - Date.parse(run.started_at) > activeRunStaleHours * 3_600_000) {
        diagnostics.push({ severity: "warning", code: "stale_active_run", message: `Active run is older than ${activeRunStaleHours} hours: ${run.id}`, id: run.id });
      }
      if (now - Date.parse(run.updated_at) > runNoteStaleHours * 3_600_000) {
        diagnostics.push({ severity: "warning", code: "unfinished_run_without_recent_note", message: `Active run has no recent note/update: ${run.id}`, id: run.id });
      }
    }
    if (run.status === "completed" && Date.parse(run.updated_at) >= recentCutoff && run.evidence.length === 0 && run.changed_nodes.length === 0 && !runActivity.get(run.id)?.hasEvidenceOrChanges) {
      diagnostics.push({ severity: "warning", code: "completed_run_without_evidence_or_changes", message: `Completed run has no linked evidence or changed nodes: ${run.id}`, id: run.id });
    }
    if (run.status !== "in_progress" && Date.parse(run.updated_at) >= recentCutoff && run.handoffs.length === 0) {
      diagnostics.push({ severity: "warning", code: "finished_run_without_handoff", message: `Finished run has no recorded handoff: ${run.id}`, id: run.id });
    }
  }

  if (operatingTemplates) {
    if (!operatingTemplates.activeTemplates.length && nodes.length > 0) {
      diagnostics.push({ severity: severity("template_no_active_template"), code: "template_no_active_template", message: "No active operating template is available for this vault." });
    }
    for (const conflict of operatingTemplates.conflicts) {
      diagnostics.push({ severity: severity("template_conflict"), code: "template_conflict", message: conflict.message, id: conflict.templateIds[0] });
    }
    for (const missing of operatingTemplates.missingSections) {
      diagnostics.push({ severity: severity("template_missing_required_section"), code: "template_missing_required_section", message: `Operating template ${missing.templateId} is missing required section ${missing.section}.`, id: missing.templateId, fixSuggestion: { templateId: missing.templateId, section: missing.section } });
    }
    for (const warning of operatingTemplates.warnings.filter((item) => item.code === "AWG_TEMPLATE_NEEDS_REVIEW")) {
      for (const id of warning.nodeIds ?? []) diagnostics.push({ severity: severity("template_needs_review"), code: "template_needs_review", message: warning.message, id });
    }
  }

  const aliases = new Map<string, string>();
  for (const node of nodes) {
    if (!linked.has(node.id)) diagnostics.push({ severity: severity("orphan_node"), code: "orphan_node", message: `Node has no graph edges: ${node.id}`, id: node.id });
    diagnostics.push(...validateNodeBlocks(node, severity("invalid_block")));
    if (node.fields !== undefined && (!node.fields || typeof node.fields !== "object" || Array.isArray(node.fields))) diagnostics.push({ severity: severity("invalid_node_fields"), code: "invalid_node_fields", message: `Node fields must be an object: ${node.id}`, id: node.id });
    const reviewAfter = typeof node.freshness?.review_after === "string" ? node.freshness.review_after : node.review_after;
    if (reviewAfter && isPastDate(reviewAfter)) diagnostics.push({ severity: severity("stale_node"), code: "stale_node", message: `Node review_after is past: ${node.id}`, id: node.id });
    if (node.freshness?.state === "current" && !node.freshness.last_verified) diagnostics.push({ severity: severity("current_node_missing_verification"), code: "current_node_missing_verification", message: `Current node has no freshness.last_verified: ${node.id}`, id: node.id });
    if (hasFreshnessStatusConflict(node)) diagnostics.push({ severity: severity("freshness_status_conflict"), code: "freshness_status_conflict", message: `Node freshness state conflicts with status: ${node.id}`, id: node.id });
    if (containsSensitiveValue(node)) diagnostics.push({ severity: severity("sensitive_value_detected"), code: "sensitive_value_detected", message: `Node appears to contain a secret-like value; replace with a redacted reference: ${node.id}`, id: node.id });
    if (node.type === "task" && node.status === "completed" && !hasEvidenceReference(node, incomingByTarget.get(node.id) ?? [], nodeById)) {
      diagnostics.push({ severity: severity("completed_task_without_evidence"), code: "completed_task_without_evidence", message: `Completed task has no evidence: ${node.id}`, id: node.id });
    }
    if (node.type === "question" && !["resolved", "completed", "archived"].includes(node.status)) {
      diagnostics.push({ severity: severity("unanswered_question"), code: "unanswered_question", message: `Question is still open: ${node.id}`, id: node.id });
    }
    if (node.status === "active" && node.confidence < 0.4) {
      diagnostics.push({ severity: severity("low_confidence_active"), code: "low_confidence_active", message: `Active node has low confidence: ${node.id}`, id: node.id });
    }
    for (const alias of [node.title, ...(node.aliases ?? [])]) {
      const normalized = alias.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const prior = aliases.get(normalized);
      if (prior && prior !== node.id) diagnostics.push({ severity: severity("duplicate_alias"), code: "duplicate_alias", message: `Duplicate-looking title/alias "${alias}" also used by ${prior}`, id: node.id });
      aliases.set(normalized, node.id);
    }
  }

  for (const diag of validateTemplateFieldRules(nodes, strict, operatingTemplates)) diagnostics.push(diag);

  for (const edge of edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (edge.rel === "blocks" && from?.type === "task" && from.status === "blocked" && to && ["completed", "resolved"].includes(to.status)) {
      diagnostics.push({ severity: severity("blocked_by_resolved"), code: "blocked_by_resolved", message: `Blocked task references completed/resolved blocker: ${from.id}`, id: from.id });
    }
    if (edge.rel === "blocks" && from?.type === "blocker" && actionableStatus(from.status) && to && ["completed", "resolved"].includes(to.status)) {
      diagnostics.push({ severity: severity("active_blocker_linked_to_resolved_work"), code: "active_blocker_linked_to_resolved_work", message: `Active blocker references completed/resolved work: ${from.id}`, id: from.id });
    }
    if (edge.rel === "implements" && from?.type === "task" && ["completed", "resolved"].includes(from.status) && to?.type === "risk" && actionableStatus(to.status)) {
      diagnostics.push({ severity: severity("active_risk_with_completed_mitigation"), code: "active_risk_with_completed_mitigation", message: `Risk has completed mitigation work but is still active: ${to.id}`, id: to.id });
    }
    if (edge.rel === "implements" && to?.type === "decision" && to.status === "proposed") {
      diagnostics.push({ severity: severity("decision_implemented_while_proposed"), code: "decision_implemented_while_proposed", message: `Decision is implemented but still proposed: ${to.id}`, id: to.id });
    }
  }

  const fatal_error_count = diagnostics.filter((d) => d.severity === "fatal").length;
  const warning_count = diagnostics.filter((d) => d.severity === "warning").length;
  const summary: DiagnosticsSummary = {
    ok: fatal_error_count === 0,
    fatal_error_count,
    warning_count,
    node_count: nodes.length,
    edge_count: edges.length,
    orphan_node_count: diagnostics.filter((d) => d.code === "orphan_node").length,
    stale_node_count: diagnostics.filter((d) => d.code === "stale_node").length,
    unverified_completion_count: diagnostics.filter((d) => d.code === "completed_task_without_evidence").length,
    dangling_edge_count: diagnostics.filter((d) => d.code === "dangling_edge").length,
    unanswered_question_count: diagnostics.filter((d) => d.code === "unanswered_question").length
  };
  if (runs.length) {
    summary.active_run_count = runs.filter((run) => run.status === "in_progress").length;
    summary.stale_run_count = diagnostics.filter((d) => d.code === "stale_active_run" || d.code === "unfinished_run_without_recent_note").length;
  }

  const recommended: string[] = [];
  if (summary.fatal_error_count) recommended.push("Fix fatal validation errors, then run awg build again.");
  if (summary.dangling_edge_count) recommended.push("Create missing nodes or remove/supersede dangling edges.");
  if (summary.stale_node_count) recommended.push("Review stale nodes and update freshness metadata.");
  if (summary.unverified_completion_count) recommended.push("Add evidence to completed task nodes.");
  if (diagnostics.some((d) => d.code.startsWith("template_"))) recommended.push("Review operating template status and resolve governance warnings.");
  if (diagnostics.some((d) => d.code === "missing_required_field")) recommended.push("Fill template-required structured fields or update the operating template.");
  if (diagnostics.some((d) => d.code === "sensitive_value_detected")) recommended.push("Redact secret-like values from durable AWG content and keep only safe references.");
  if (responses.length === 0 && nodes.length > 0) recommended.push("Capture important human feedback as AWG responses when decisions change.");
  if (summary.active_run_count) recommended.push("Finish active runs with a summary and generate a handoff before stopping.");

  return { diagnostics, summary, recommended };
}

function countsAsGraphLink(edge: AwgEdge): boolean {
  return edge.rel !== "intentionally_open";
}

function numberConfig(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function actionableStatus(status: string): boolean {
  return ["active", "blocked", "in_progress", "needs_review", "proposed", "stale"].includes(status);
}

function buildRunActivity(nodes: AwgNode[], edges: AwgEdge[], responses: AwgResponse[], views: AwgView[], nodeById: Map<string, AwgNode>): Map<string, { hasEvidenceOrChanges: boolean }> {
  const activity = new Map<string, { hasEvidenceOrChanges: boolean }>();
  const mark = (runId: string | undefined): void => {
    if (!runId) return;
    activity.set(runId, { hasEvidenceOrChanges: true });
  };
  for (const node of nodes) mark(runIdFromObject(node));
  for (const edge of edges) mark(runIdFromObject(edge));
  for (const response of responses) mark(runIdFromObject(response));
  for (const view of views) mark(runIdFromObject(view));
  for (const edge of edges) {
    const runId = runIdFromObject(edge);
    if (runId && nodeById.get(edge.from)?.type === "evidence") mark(runId);
  }
  return activity;
}

function hasFreshnessStatusConflict(node: AwgNode): boolean {
  const state = node.freshness?.state;
  if (!state) return false;
  if (["archived", "rejected", "superseded"].includes(node.status) && state === "current") return true;
  if (["completed", "resolved"].includes(node.status) && state === "proposed") return true;
  if (["stale", "needs_review"].includes(node.status) && state === "current") return true;
  return false;
}

function validateTemplateFieldRules(nodes: AwgNode[], strict: boolean, operatingTemplates?: OperatingTemplateIndex): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const templateNodes = new Map(nodes.filter((node) => isTemplateNode(node) && ["active", "accepted"].includes(node.status)).map((node) => [node.id, node]));
  const activeTemplates = operatingTemplates?.activeTemplates ?? [...templateNodes.values()].map(templateSummary);
  const severity = strict ? "fatal" : "warning";
  for (const node of nodes) {
    if (isTemplateNode(node)) continue;
    for (const template of activeTemplates.filter((item) => templateAppliesToNode(item, node))) {
      const templateNode = templateNodes.get(template.id);
      if (!templateNode) continue;
      for (const rule of templateFieldRules(templateNode)) {
      if (rule.nodeType && node.type !== rule.nodeType) continue;
      if (!rule.field) continue;
      if (hasFieldValue(node, rule.field)) continue;
      diagnostics.push({
        severity: rule.severity ?? severity,
        code: rule.required ? "missing_required_field" : "missing_recommended_field",
        message: `Node ${node.id} is missing template ${rule.required ? "required" : "recommended"} field ${rule.field} from ${template.id}.`,
        id: node.id,
        fixSuggestion: { templateId: template.id, field: rule.field, required: rule.required }
      });
    }
    }
  }
  return diagnostics;
}

interface FieldRule {
  nodeType?: string;
  field: string;
  required: boolean;
  severity?: "fatal" | "warning";
}

function templateFieldRules(node: AwgNode): FieldRule[] {
  const fields = node.fields && typeof node.fields === "object" && !Array.isArray(node.fields) ? node.fields : {};
  const raw = Array.isArray(fields.fieldRules) ? fields.fieldRules : Array.isArray(fields.field_rules) ? fields.field_rules : [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const field = typeof record.field === "string" && record.field.trim() ? record.field : undefined;
    if (!field) return [];
    const nodeType = typeof record.nodeType === "string" ? record.nodeType : typeof record.type === "string" ? record.type : undefined;
    const severity = record.severity === "fatal" ? "fatal" : record.severity === "warning" ? "warning" : undefined;
    return [{ nodeType, field, required: record.required !== false && record.recommended !== true, severity }];
  });
}

function templateAppliesToNode(template: OperatingTemplateIndex["activeTemplates"][number], node: AwgNode): boolean {
  const appliesTo = template.appliesTo ?? {};
  if (Object.keys(appliesTo).length) return matchesAppliesTo(appliesTo, node);
  if (template.scope === "vault" || template.scope === "project") return true;
  const fields = node.fields && typeof node.fields === "object" && !Array.isArray(node.fields) ? node.fields : {};
  return fields.scope === template.scope || (node.tags ?? []).includes(template.scope) || (node.tags ?? []).includes(`scope:${template.scope}`);
}

function matchesAppliesTo(appliesTo: Record<string, unknown>, node: AwgNode): boolean {
  const handled = new Set(["type", "nodeType", "types", "nodeTypes", "status", "statuses", "tag", "tags"]);
  if (!matchStringOrArray(appliesTo.type ?? appliesTo.nodeType, node.type)) return false;
  if (!matchStringOrArray(appliesTo.types ?? appliesTo.nodeTypes, node.type, true)) return false;
  if (!matchStringOrArray(appliesTo.status, node.status)) return false;
  if (!matchStringOrArray(appliesTo.statuses, node.status, true)) return false;
  if (!matchTags(appliesTo.tag, node.tags ?? [])) return false;
  if (!matchTags(appliesTo.tags, node.tags ?? [], true)) return false;
  for (const [key, expected] of Object.entries(appliesTo)) {
    if (handled.has(key)) continue;
    if (!matchGenericSelector(key, expected, node)) return false;
  }
  return true;
}

function matchStringOrArray(value: unknown, actual: string, allowMissing = false): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return value === actual;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.includes(actual);
  return allowMissing;
}

function matchTags(value: unknown, tags: string[], allowMissing = false): boolean {
  if (value === undefined) return true;
  if (typeof value === "string") return tags.includes(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.some((tag) => tags.includes(tag));
  return allowMissing;
}

function matchGenericSelector(key: string, expected: unknown, node: AwgNode): boolean {
  const fields = node.fields && typeof node.fields === "object" && !Array.isArray(node.fields) ? node.fields : {};
  const path = key.split(".").filter(Boolean);
  const actual = path.length ? readPath(fields, path) ?? readPath(node as unknown as Record<string, unknown>, path) : undefined;
  if (selectorValueMatches(expected, actual)) return true;
  if (typeof expected === "string") return (node.tags ?? []).includes(`${key}:${expected}`) || (node.tags ?? []).includes(expected);
  if (Array.isArray(expected) && expected.every((item) => typeof item === "string")) {
    return expected.some((item) => (node.tags ?? []).includes(`${key}:${item}`) || (node.tags ?? []).includes(item));
  }
  return false;
}

function selectorValueMatches(expected: unknown, actual: unknown): boolean {
  if (expected === undefined) return true;
  if (Array.isArray(expected)) {
    if (Array.isArray(actual)) return expected.some((item) => actual.includes(item));
    return expected.includes(actual);
  }
  if (Array.isArray(actual)) return actual.includes(expected);
  return actual === expected;
}

function hasFieldValue(node: AwgNode, path: string): boolean {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return false;
  const value = readPath(node.fields, parts) ?? readPath(node as unknown as Record<string, unknown>, parts);
  return value !== undefined && value !== null && value !== "";
}

function readPath(value: unknown, parts: string[]): unknown {
  let current = value;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function containsSensitiveValue(node: AwgNode): boolean {
  return scanForSecret(node.fields, 0) || scanForSecret(node.body, 0) || scanForSecret(node.blocks, 0);
}

function scanForSecret(value: unknown, depth: number): boolean {
  if (depth > 6 || value === undefined || value === null) return false;
  if (typeof value === "string") return looksSecretLike(value);
  if (Array.isArray(value)) return value.slice(0, 100).some((item) => scanForSecret(item, depth + 1));
  if (typeof value !== "object") return false;
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    if (/redacted|example|placeholder/i.test(key)) continue;
    if (/password|secret|token|api[_-]?key|private[_-]?key/i.test(key) && typeof item === "string" && item && !/redacted|example|placeholder|\.\.\./i.test(item)) return true;
    if (scanForSecret(item, depth + 1)) return true;
  }
  return false;
}

function looksSecretLike(value: string): boolean {
  if (/redacted|placeholder|example|\.\.\./i.test(value)) return false;
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)
    || /\bAKIA[0-9A-Z]{16}\b/.test(value)
    || /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{24,}\b/.test(value)
    || /\bsk-[A-Za-z0-9]{20,}\b/.test(value)
    || /\b[a-z0-9_]*(?:token|secret|api[_-]?key|password)[a-z0-9_]*\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/i.test(value);
}
