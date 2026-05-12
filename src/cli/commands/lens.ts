import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import type { ParsedArgs } from "../args.js";

export async function lensCommand(parsed: ParsedArgs): Promise<void> {
  const [, name] = parsed.positionals;
  if (name !== "resume") throw new Error("Usage: awg lens resume [--json]");
  const text = await new FileAwgStorage().readCompiledArtifact("lenses/resume.json");
  if (!text) throw new Error("Missing compiled resume lens. Run awg build first.");
  if (parsed.flags.json) console.log(text.trim());
  else {
    const lens = JSON.parse(text);
    console.log(lens.summary);
    for (const key of ["important", "open_decisions", "active_tasks", "active_risks", "unanswered_questions"]) {
      if (lens[key]?.length) {
        console.log(`\n${key}:`);
        for (const node of lens[key]) console.log(`- ${node.id} ${node.title} (${node.status})`);
      }
    }
    if (lens.recommended_maintenance?.length) {
      console.log("\nrecommended_maintenance:");
      for (const item of lens.recommended_maintenance) console.log(`- ${item}`);
    }
  }
}
