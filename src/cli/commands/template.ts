import { AWG_VERSION } from "../../core/constants.js";
import { buildAwg } from "../../core/compiler.js";
import { buildOperatingTemplateIndex } from "../../core/operatingTemplates.js";
import { REQUIRED_TEMPLATE_FIELDS, RECOMMENDED_TEMPLATE_FIELDS, TEMPLATE_FIELD_CONTRACT, adaptiveAuthoringGuide, shellQuote, templateFieldHints } from "../../core/adaptiveTemplates.js";
import { attachRun, resolveWriteRunId } from "../../core/runAttribution.js";
import { nodeId } from "../../core/ids.js";
import { runEventId } from "../../core/runs.js";
import type { AwgEvent, AwgNode, OperatingTemplateIndex } from "../../core/types.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";
import { nowIso } from "../../util/time.js";

export async function templateCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  if (sub === "guide") return guideTemplate(parsed);
  if (sub === "scaffold") return scaffoldTemplate(parsed);
  if (sub !== "status") throw new Error("Usage: awg template guide [--goal <goal>] [--json] | awg template status [--goal <goal>] [--json] | awg template scaffold --title <title> [--goal <goal>] [--scope vault|project] [--json]");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const goal = str(parsed.flags, "goal");
  const index: OperatingTemplateIndex = goal ? buildOperatingTemplateIndex(graph.nodes, goal) : graph.operating_templates ?? buildOperatingTemplateIndex(graph.nodes);
  const result = {
    ...index,
    goal: goal ?? null,
    requiredFields: REQUIRED_TEMPLATE_FIELDS,
    recommendedFields: RECOMMENDED_TEMPLATE_FIELDS,
    fieldContract: TEMPLATE_FIELD_CONTRACT,
    fieldHints: templateFieldHints()
  };
  if (parsed.flags.json) return printJson(result);
  console.log("AWG template status");
  console.log(`requiredFields: ${REQUIRED_TEMPLATE_FIELDS.join(", ")}`);
  console.log(`recommendedFields: ${RECOMMENDED_TEMPLATE_FIELDS.join(", ")}`);
  console.log(`fieldHints: ${Object.entries(templateFieldHints()).map(([key, value]) => `${key}=${value}`).join("; ")}`);
  console.log("");
  console.log(`activeTemplateId: ${result.activeTemplateId ?? "none"}`);
  for (const template of result.activeTemplates) console.log(`- ${template.id} ${template.title} (${template.status}, scope:${template.scope})`);
  if (result.selectedTemplate) console.log(`selectedTemplate: ${result.selectedTemplate.id}`);
  if (result.pendingTemplates.length) {
    console.log("");
    console.log("pendingTemplates:");
    for (const template of result.pendingTemplates) {
      const placeholders = template.placeholderFields?.length ? `, placeholders:${template.placeholderFields.join(",")}` : "";
      console.log(`- ${template.id} ${template.title} (${template.status}, review:${template.reviewState ?? "none"}, humanApproved:${template.humanApproved}${placeholders})`);
    }
  }
  const allPlaceholderFields = [...new Set([...result.placeholderFields, ...result.pendingTemplates.flatMap((template) => template.placeholderFields ?? [])])].sort();
  if (allPlaceholderFields.length) {
    console.log("");
    console.log(`placeholderFields: ${allPlaceholderFields.join(", ")}`);
  }
  if (!result.pilotReadinessImpact.ready) {
    console.log("");
    console.log("pilotReadinessImpact:");
    for (const reason of result.pilotReadinessImpact.blockingReasons) console.log(`- ${reason}`);
  }
  if (result.suggestedCommands.length) {
    console.log("");
    console.log("suggestedCommands:");
    for (const command of result.suggestedCommands) console.log(`- ${command}`);
  }
  if (result.missingSections.length) {
    console.log("");
    console.log("missingSections:");
    for (const item of result.missingSections) console.log(`- ${item.templateId}: ${item.section}`);
  }
  if (result.conflicts.length) {
    console.log("");
    console.log("conflicts:");
    for (const conflict of result.conflicts) console.log(`- ${conflict.message}`);
  }
  if (result.warnings.length) {
    console.log("");
    console.log("warnings:");
    for (const warning of result.warnings) console.log(`- ${warning.message}`);
  }
}

async function guideTemplate(parsed: ParsedArgs): Promise<void> {
  const goal = str(parsed.flags, "goal");
  const result = adaptiveAuthoringGuide(goal);
  if (parsed.flags.json) return printJson(result);
  console.log("AWG template guide");
  if (result.goal) console.log(`goal: ${result.goal}`);
  console.log("Create one scenario-specific vault-local operating template. Do not look for preset domain packs.");
  console.log("");
  console.log("required:");
  for (const item of result.fieldContract.filter((field) => field.requiredForTemplate)) console.log(`- ${item.name}: ${item.description}`);
  console.log("");
  console.log("client-pilot:");
  for (const item of result.fieldContract.filter((field) => field.requiredForClientPilot && !field.requiredForTemplate)) console.log(`- ${item.name}: ${item.description}`);
  console.log("");
  console.log("next:");
  for (const command of result.suggestedCommands) console.log(`- ${command}`);
}

async function scaffoldTemplate(parsed: ParsedArgs): Promise<void> {
  const title = str(parsed.flags, "title");
  if (!title) throw new Error("Missing required --title");
  const scope = str(parsed.flags, "scope", "vault") ?? "vault";
  if (!["vault", "project"].includes(scope)) throw new Error("--scope must be one of: vault, project");
  if (parsed.flags["human-approved"] || str(parsed.flags, "review-state") === "reviewed") throw new Error("template scaffold cannot self-approve; create a needs_review scaffold and update it after human review.");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const goal = str(parsed.flags, "goal");
  const existing = buildOperatingTemplateIndex(graph.nodes, goal);
  const duplicateCandidates = [...(existing.activeTemplates ?? []), ...(existing.pendingTemplates ?? [])].filter((item) => item.title.toLowerCase() === title.toLowerCase());
  const existingApprovedTemplateIds = existing.activeTemplates.filter((item) => item.humanApproved && item.reviewState === "reviewed").map((item) => item.id);
  const warnings = [
    ...duplicateCandidates.map((item) => ({ code: "AWG_TEMPLATE_DUPLICATE_CANDIDATE", severity: "warning" as const, message: `Similar operating template already exists: ${item.id}`, nodeIds: [item.id] })),
    ...existingApprovedTemplateIds.map((id) => ({ code: "AWG_TEMPLATE_APPROVED_EXISTS", severity: "warning" as const, message: `A reviewed human-approved operating template already exists: ${id}`, nodeIds: [id] }))
  ];
  const runId = resolveWriteRunId(graph, parsed.flags);
  const at = nowIso();
  const node: AwgNode = attachRun({
    awg: AWG_VERSION,
    kind: "node",
    id: str(parsed.flags, "id") ?? nodeId(title),
    type: "process",
    title,
    summary: str(parsed.flags, "summary") ?? `${title} operating template.`,
    body: scaffoldBody(goal),
    status: "needs_review",
    importance: 0.7,
    confidence: 0.7,
    created_at: at,
    updated_at: at,
    tags: ["template:operating"],
    fields: {
      scope,
      purpose: "Describe what this vault/project is for.",
      actors: "Describe who uses this vault.",
      capture_policy: "Describe what future-affecting knowledge agents should capture.",
      non_capture_policy: "Describe what must stay out of AWG or in source-of-truth systems.",
      taxonomy: { preferredTypes: ["task", "decision", "risk", "question", "evidence", "process"] },
      evidence_rules: "Describe proof requirements before work is treated as complete or true.",
      freshness_rules: "Describe review cadence and stale-context rules.",
      sensitivity_rules: "Describe PII, private client context, financials, contracts/billing, strategy, approval boundaries, credentials/secrets, source-of-truth systems, redaction, and never-capture categories.",
      approval_rules: "Describe what needs human approval before acceptance, completion, publishing, or client visibility.",
      queue_rules: "Describe autonomous vs human-review queue rules or mark not applicable.",
      coordination_rules: "Describe claim, shared/watch, release, and handoff rules or mark not applicable.",
      lens_rules: "Describe repeated lens usage or mark not applicable.",
      view_rules: "Describe safe human surfaces or mark not applicable.",
      cross_vault_rules: "Describe related-vault handling or mark not applicable.",
      maintenance_rules: "Describe stale, duplicate, orphan, question, risk, and blocker maintenance.",
      backup_rules: "Describe .awg backup/versioning expectations before high-stakes use.",
      retention_rules: "Describe retention, archive, and never-store expectations.",
      export_rules: "Describe safe handoff/export expectations.",
      agent_rules: "Describe capture thresholds, evidence standards, and source-of-truth boundaries.",
      review_state: "needs_review",
      human_approved: false
    },
    provenance: { created_by: "agent:codex", updated_by: "agent:codex", source: "template_scaffold", human_approved: false }
  }, runId);
  if (!node.id.startsWith("n:")) throw new Error("--id for template scaffold must start with n:");
  await storage.appendLogEntry(node);
  if (runId) await storage.appendLogEntry(attachRun({ awg: AWG_VERSION, kind: "event", id: runEventId(runId, "template-scaffold", at), type: "node_created", target: node.id, by: "agent:codex", at }, runId) as AwgEvent);
  const goalArg = goal ? ` --goal ${shellQuote(goal)}` : "";
  const suggestedCommands = [`awg node show ${node.id} --json`, `awg template status${goalArg} --json`, `awg template guide${goalArg} --json`];
  if (parsed.flags.json) return printJson({ ok: true, nodeId: node.id, runId: runId ?? null, requiredFields: REQUIRED_TEMPLATE_FIELDS, recommendedFields: RECOMMENDED_TEMPLATE_FIELDS, fieldContract: TEMPLATE_FIELD_CONTRACT, warnings, suggestedCommands, duplicateCandidates, existingApprovedTemplateIds, node });
  console.log(`Added template scaffold ${node.id}`);
  console.log(`requiredFields: ${REQUIRED_TEMPLATE_FIELDS.join(", ")}`);
  for (const warning of warnings) console.log(`warning: ${warning.message}`);
}

function scaffoldBody(goal?: string): string {
  return [
    "# Operating Template Scaffold",
    "",
    goal ? `Goal context: ${goal}` : "Goal context: fill from the user's explicit current goal.",
    "",
    "Fill this candidate after inspecting approved AWG state, explicit user instructions, and named project docs. Keep it needs_review until human review.",
    "",
    "- Define purpose, scope, taxonomy, freshness, and agent rules.",
    "- Add capture and non-capture policy before relying on AWG for high-stakes work.",
    "- Add evidence, sensitivity, approval, backup, retention, and export rules before client-pilot use.",
    "- Summarize rules and source-of-truth boundaries; do not store raw private excerpts, secrets, or transcripts."
  ].join("\n");
}
