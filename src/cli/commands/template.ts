import { buildAwg } from "../../core/compiler.js";
import type { AwgNode } from "../../core/types.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function templateCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  if (sub !== "status") throw new Error("Usage: awg template status [--goal <goal>] [--json]");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const goal = str(parsed.flags, "goal");
  const templates = graph.nodes.filter(isTemplateNode).sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || b.importance - a.importance || a.title.localeCompare(b.title));
  const activeTemplates = templates.filter((node) => node.status === "active" || node.status === "accepted");
  const selectedForGoal = goal ? selectForGoal(activeTemplates, goal) : undefined;
  const rootsByScope = groupRoots(activeTemplates);
  const missingSections = activeTemplates.flatMap(missingRecommendedSections);
  const conflicts = findConflicts(activeTemplates);
  const warnings = [
    ...(!activeTemplates.length ? ["No active operating template found."] : []),
    ...missingSections.map((item) => `${item.templateId} missing ${item.section}`)
  ];
  const result = {
    ok: conflicts.length === 0,
    activeTemplateId: selectedForGoal?.id ?? activeTemplates[0]?.id ?? null,
    activeTemplates: activeTemplates.map(templateSummary),
    rootsByScope,
    selectedForGoal: selectedForGoal ? templateSummary(selectedForGoal) : null,
    missingSections,
    conflicts,
    warnings,
    suggestedCommands: ["awg search template", "awg lens task --goal \"template governance\""]
  };
  if (parsed.flags.json) return printJson(result);
  console.log("AWG template status");
  console.log("");
  console.log(`activeTemplateId: ${result.activeTemplateId ?? "none"}`);
  for (const template of result.activeTemplates) console.log(`- ${template.id} ${template.title} (${template.status}, scope:${template.scope})`);
  if (result.missingSections.length) {
    console.log("");
    console.log("missingSections:");
    for (const item of result.missingSections) console.log(`- ${item.templateId}: ${item.section}`);
  }
  if (result.conflicts.length) {
    console.log("");
    console.log("conflicts:");
    for (const conflict of result.conflicts) console.log(`- ${conflict}`);
  }
  if (result.warnings.length) {
    console.log("");
    console.log("warnings:");
    for (const warning of result.warnings) console.log(`- ${warning}`);
  }
}

function isTemplateNode(node: AwgNode): boolean {
  const tags = node.tags ?? [];
  return node.type === "template" || tags.includes("template") || tags.includes("operating-template") || tags.includes("template:operating");
}

function templateSummary(node: AwgNode): Record<string, unknown> {
  const fields = node.fields ?? {};
  return { id: node.id, title: node.title, status: node.status, scope: String(fields.scope ?? "project"), reviewState: fields.review_state ?? null, updated_at: node.updated_at };
}

function groupRoots(nodes: AwgNode[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const node of nodes) {
    const scope = String(node.fields?.scope ?? "project");
    (grouped[scope] ||= []).push(node.id);
  }
  return grouped;
}

function missingRecommendedSections(node: AwgNode): Array<{ templateId: string; section: string }> {
  const fields = node.fields ?? {};
  const missing: Array<{ templateId: string; section: string }> = [];
  for (const section of ["rationale", "affected_scope", "migration_notes", "review_state"]) {
    if (fields[section] === undefined) missing.push({ templateId: node.id, section });
  }
  return missing;
}

function findConflicts(nodes: AwgNode[]): string[] {
  const byScope = new Map<string, AwgNode[]>();
  for (const node of nodes) {
    const scope = String(node.fields?.scope ?? "project");
    byScope.set(scope, [...(byScope.get(scope) ?? []), node]);
  }
  return [...byScope.entries()].filter(([, items]) => items.length > 1).map(([scope, items]) => `Multiple active templates for scope ${scope}: ${items.map((node) => node.id).join(", ")}`);
}

function selectForGoal(nodes: AwgNode[], goal: string): AwgNode | undefined {
  const terms = goal.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return [...nodes].sort((a, b) => scoreTemplate(b, terms) - scoreTemplate(a, terms) || a.title.localeCompare(b.title))[0];
}

function scoreTemplate(node: AwgNode, terms: string[]): number {
  const haystack = [node.id, node.title, node.summary, ...(node.tags ?? [])].join(" ").toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) + node.importance;
}
