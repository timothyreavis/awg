import { RELATION_HELP } from "../../core/relations.js";
import type { ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function relsCommand(parsed: ParsedArgs): Promise<void> {
  if (parsed.flags.json) return printJson({ ok: true, relations: RELATION_HELP });
  console.log("AWG relations");
  for (const rel of RELATION_HELP) {
    console.log(`- ${rel.id}: ${rel.description}`);
    console.log(`  ${rel.example}`);
  }
}
