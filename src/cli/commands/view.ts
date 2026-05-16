import path from "node:path";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import type { ParsedArgs } from "../args.js";
import { printJson } from "../format.js";
import { buildAwg } from "../../core/compiler.js";

export async function viewCommand(parsed: ParsedArgs): Promise<void> {
  const [, name] = parsed.positionals;
  if (name === "list") return listViews(parsed);
  if (name === "show") return showView(parsed);
  if (name !== "current") throw new Error("Usage: awg view current [--json] [--text] | awg view list [--json] | awg view show <view-id> [--json]");
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
    console.log(path.join(storage.root, ".awg", "compiled", "site", "index.html"));
  }
}

async function listViews(parsed: ParsedArgs): Promise<void> {
  const storage = new FileAwgStorage();
  const { graph, currentView } = await buildAwg(storage, { write: false });
  const views = [
    { id: "v:current", title: currentView.title, audience: "human", generated: true, blocks: currentView.blocks.length },
    ...(graph.authored_views ?? []).map((view) => ({ id: view.id, title: view.title, summary: view.summary, audience: view.audience, tags: view.tags ?? [], generated: false, blocks: Array.isArray(view.blocks) ? view.blocks.length : 0, diagnostics: view.diagnostics.length }))
  ];
  if (parsed.flags.json) return printJson({ ok: true, views });
  for (const view of views) console.log(`${view.id}\t${view.title}`);
}

async function showView(parsed: ParsedArgs): Promise<void> {
  const id = parsed.positionals[2];
  if (!id) throw new Error("Usage: awg view show <view-id> [--json]");
  const storage = new FileAwgStorage();
  const { graph, currentView } = await buildAwg(storage, { write: false });
  const view = id === "v:current" ? currentView : graph.authored_views?.find((item) => item.id === id) ?? graph.views.find((item) => item.id === id);
  if (!view) throw new Error(`View not found: ${id}`);
  if (parsed.flags.json) return printJson({ ok: true, view });
  console.log(`${view.title} (${view.id})`);
  if ("summary" in view && view.summary) console.log(view.summary);
  for (const block of view.blocks ?? []) console.log(`- ${block.title ?? block.type}`);
}
