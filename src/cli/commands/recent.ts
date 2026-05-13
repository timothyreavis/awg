import { buildAwg } from "../../core/compiler.js";
import { buildRecent } from "../../core/retrieval.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { num, str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function recentCommand(parsed: ParsedArgs): Promise<void> {
  const days = num(parsed.flags, "days", 7);
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false });
  const output = buildRecent(graph, days, Date.now(), str(parsed.flags, "run"));
  if (parsed.flags.json) return printJson(output);
  console.log(`Recent AWG changes (${days} days)`);
  for (const node of output.nodes) console.log(`- ${node.id} ${node.title} (${node.status})`);
  if (output.runs.length) {
    console.log("\nruns:");
    for (const run of output.runs) console.log(`- ${run.id} ${run.status} ${run.goal}`);
  }
  if (output.responses.length) {
    console.log("\nresponses:");
    for (const response of output.responses) console.log(`- ${response.id} ${response.summary}`);
  }
}
