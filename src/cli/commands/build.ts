import { buildAwg } from "../../core/compiler.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import type { ParsedArgs } from "../args.js";

export async function buildCommand(parsed: ParsedArgs): Promise<void> {
  const result = await buildAwg(new FileAwgStorage(), { strict: Boolean(parsed.flags.strict), write: true });
  if (parsed.flags.json) console.log(JSON.stringify(result.diagnostics.summary, null, 2));
  else {
    const s = result.diagnostics.summary;
    console.log(`AWG build complete: ${s.node_count} nodes, ${s.edge_count} edges, ${s.warning_count} warnings, ${s.fatal_error_count} fatal errors.`);
  }
  if (result.diagnostics.summary.fatal_error_count > 0) process.exitCode = 1;
}
