import { buildAwg } from "../../core/compiler.js";
import { charBudget } from "../../core/budget.js";
import { buildHandoff } from "../../core/retrieval.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { num, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function handoffCommand(parsed: ParsedArgs): Promise<void> {
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false });
  const output = buildHandoff(graph, charBudget(num(parsed.flags, "budget", 0) || undefined));
  if (parsed.flags.json) return printJson(output);
  console.log("AWG handoff");
  for (const section of output.sections) {
    if (!section.items.length && !section.omitted) continue;
    console.log(`\n${section.section}${section.omitted ? ` (${section.omitted} omitted)` : ""}:`);
    for (const item of section.items) {
      const record = item as Record<string, unknown>;
      console.log(`- ${record.id ? `${record.id} ` : ""}${record.title ?? record.summary ?? record.message ?? item}${record.status ? ` (${record.status})` : ""}`);
    }
  }
}
