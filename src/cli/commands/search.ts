import { buildAwg } from "../../core/compiler.js";
import { searchGraph } from "../../core/search.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { num, str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function searchCommand(parsed: ParsedArgs): Promise<void> {
  const [, ...queryParts] = parsed.positionals;
  const query = queryParts.join(" ").trim();
  if (!query) throw new Error("Usage: awg search <query> [--type <type>] [--status <status>] [--tag <tag>] [--limit <n>] [--json]");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const results = searchGraph(graph, query, {
    type: str(parsed.flags, "type"),
    status: str(parsed.flags, "status"),
    tag: str(parsed.flags, "tag"),
    limit: num(parsed.flags, "limit", 20)
  });
  if (parsed.flags.json) return printJson({ ok: true, query, results });
  if (results.length === 0) {
    console.log(`No AWG nodes matched "${query}".`);
    return;
  }
  for (const result of results) {
    console.log(`${result.id}\t${result.type}\t${result.status}\tscore=${result.score}\t${result.title}`);
    if (result.matches.length) console.log(`  matches: ${result.matches.join(", ")}`);
  }
}
