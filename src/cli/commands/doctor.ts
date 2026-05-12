import { buildAwg } from "../../core/compiler.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import type { ParsedArgs } from "../args.js";

export async function doctorCommand(parsed: ParsedArgs): Promise<void> {
  const result = await buildAwg(new FileAwgStorage(), { write: true });
  if (parsed.flags.json) {
    console.log(JSON.stringify(result.diagnostics, null, 2));
    return;
  }
  for (const diag of result.diagnostics.diagnostics) {
    console.log(`${diag.severity.toUpperCase()} ${diag.code}${diag.id ? ` ${diag.id}` : ""}: ${diag.message}`);
  }
  if (result.diagnostics.diagnostics.length === 0) console.log("No diagnostics.");
  if (result.diagnostics.summary.fatal_error_count > 0) process.exitCode = 1;
}
