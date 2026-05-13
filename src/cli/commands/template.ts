import { buildAwg } from "../../core/compiler.js";
import { buildOperatingTemplateIndex } from "../../core/operatingTemplates.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function templateCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  if (sub !== "status") throw new Error("Usage: awg template status [--goal <goal>] [--json]");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const goal = str(parsed.flags, "goal");
  const result = {
    ...(goal ? buildOperatingTemplateIndex(graph.nodes, goal) : graph.operating_templates ?? buildOperatingTemplateIndex(graph.nodes)),
    goal: goal ?? null
  };
  if (parsed.flags.json) return printJson(result);
  console.log("AWG template status");
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
