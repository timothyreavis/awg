import { buildAwg } from "../../core/compiler.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import type { ParsedArgs } from "../args.js";

export async function validateCommand(parsed: ParsedArgs): Promise<void> {
  const result = await buildAwg(new FileAwgStorage(), { strict: Boolean(parsed.flags.strict), write: false });
  if (parsed.flags.json) console.log(JSON.stringify(result.diagnostics, null, 2));
  else console.log(`AWG validate: ${result.diagnostics.summary.warning_count} warnings, ${result.diagnostics.summary.fatal_error_count} fatal errors.`);
  if (result.diagnostics.summary.fatal_error_count > 0) process.exitCode = 1;
}
