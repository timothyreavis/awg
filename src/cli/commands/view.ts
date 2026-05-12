import path from "node:path";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import type { ParsedArgs } from "../args.js";

export async function viewCommand(parsed: ParsedArgs): Promise<void> {
  const [, name] = parsed.positionals;
  if (name !== "current") throw new Error("Usage: awg view current [--json] [--text]");
  const storage = new FileAwgStorage();
  const text = await storage.readCompiledArtifact("views/current.json");
  if (!text) throw new Error("Missing compiled current view. Run awg build first.");
  if (parsed.flags.json) console.log(text.trim());
  else if (parsed.flags.text) {
    const view = JSON.parse(text);
    console.log(`${view.title} (${view.generated_at})`);
    for (const block of view.blocks) {
      const count = block.items ? block.items.length : "";
      console.log(`- ${block.title}${count !== "" ? `: ${count}` : ""}`);
    }
  } else {
    console.log(path.join(process.cwd(), ".awg", "compiled", "site", "index.html"));
  }
}
