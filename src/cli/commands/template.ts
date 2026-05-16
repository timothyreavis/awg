import { AWG_VERSION } from "../../core/constants.js";
import { buildAwg } from "../../core/compiler.js";
import { buildOperatingTemplateIndex } from "../../core/operatingTemplates.js";
import { attachRun, resolveWriteRunId } from "../../core/runAttribution.js";
import { nodeId } from "../../core/ids.js";
import { runEventId } from "../../core/runs.js";
import type { AwgEvent, AwgNode } from "../../core/types.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";
import { nowIso } from "../../util/time.js";

const REQUIRED_TEMPLATE_FIELDS = ["scope", "purpose", "taxonomy", "freshness_rules", "agent_rules", "review_state", "human_approved"];
const TEMPLATE_FIELD_HINTS = {
  purpose: "Short text describing what this vault or project is for.",
  taxonomy: "Object describing preferred node types, statuses, tags, and relation conventions.",
  freshness_rules: "Text or object describing review cadence and stale-context rules.",
  agent_rules: "Text or object describing capture thresholds, evidence standards, and source-of-truth boundaries.",
  review_state: "Use reviewed after human/owner approval; use needs_review while unsettled.",
  human_approved: "Boolean approval marker for settled operating templates."
} as const;

export async function templateCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  if (sub === "scaffold") return scaffoldTemplate(parsed);
  if (sub !== "status") throw new Error("Usage: awg template status [--goal <goal>] [--json] | awg template scaffold --title <title> [--scope vault|project] [--json]");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const goal = str(parsed.flags, "goal");
  const result = {
    ...(goal ? buildOperatingTemplateIndex(graph.nodes, goal) : graph.operating_templates ?? buildOperatingTemplateIndex(graph.nodes)),
    goal: goal ?? null,
    requiredFields: REQUIRED_TEMPLATE_FIELDS,
    fieldHints: TEMPLATE_FIELD_HINTS
  };
  if (parsed.flags.json) return printJson(result);
  console.log("AWG template status");
  console.log(`requiredFields: ${REQUIRED_TEMPLATE_FIELDS.join(", ")}`);
  console.log(`fieldHints: ${Object.entries(TEMPLATE_FIELD_HINTS).map(([key, value]) => `${key}=${value}`).join("; ")}`);
  console.log("");
  console.log(`activeTemplateId: ${result.activeTemplateId ?? "none"}`);
  for (const template of result.activeTemplates) console.log(`- ${template.id} ${template.title} (${template.status}, scope:${template.scope})`);
  if (result.selectedTemplate) console.log(`selectedTemplate: ${result.selectedTemplate.id}`);
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

async function scaffoldTemplate(parsed: ParsedArgs): Promise<void> {
  const title = str(parsed.flags, "title");
  if (!title) throw new Error("Missing required --title");
  const scope = str(parsed.flags, "scope", "vault") ?? "vault";
  if (!["vault", "project"].includes(scope)) throw new Error("--scope must be one of: vault, project");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const runId = resolveWriteRunId(graph, parsed.flags);
  const at = nowIso();
  const node: AwgNode = attachRun({
    awg: AWG_VERSION,
    kind: "node",
    id: str(parsed.flags, "id") ?? nodeId(title),
    type: "process",
    title,
    summary: str(parsed.flags, "summary") ?? `${title} operating template.`,
    status: "needs_review",
    importance: 0.7,
    confidence: 0.7,
    created_at: at,
    updated_at: at,
    tags: ["template:operating"],
    fields: {
      scope,
      purpose: "Describe what this vault/project is for.",
      taxonomy: { preferredTypes: ["task", "decision", "risk", "question", "evidence", "process"] },
      freshness_rules: "Describe review cadence and stale-context rules.",
      agent_rules: "Describe capture thresholds, evidence standards, and source-of-truth boundaries.",
      review_state: "needs_review",
      human_approved: false
    },
    provenance: { created_by: "agent:codex", updated_by: "agent:codex", source: "template_scaffold", human_approved: false }
  }, runId);
  if (!node.id.startsWith("n:")) throw new Error("--id for template scaffold must start with n:");
  await storage.appendLogEntry(node);
  if (runId) await storage.appendLogEntry(attachRun({ awg: AWG_VERSION, kind: "event", id: runEventId(runId, "template-scaffold", at), type: "node_created", target: node.id, by: "agent:codex", at }, runId) as AwgEvent);
  if (parsed.flags.json) return printJson({ ok: true, nodeId: node.id, runId: runId ?? null, requiredFields: REQUIRED_TEMPLATE_FIELDS, node });
  console.log(`Added template scaffold ${node.id}`);
  console.log(`requiredFields: ${REQUIRED_TEMPLATE_FIELDS.join(", ")}`);
}
