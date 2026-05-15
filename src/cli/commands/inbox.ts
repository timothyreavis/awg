import { buildAwg } from "../../core/compiler.js";
import { filterInboxItems } from "../../core/maintenance.js";
import type { MaintenanceInboxItem } from "../../core/types.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function inboxCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false });
  const inbox = graph.maintenance_inbox;
  if (sub === "show") {
    const id = parsed.positionals[2];
    if (!id) throw new Error("Usage: awg inbox show <item-id> [--json]");
    const item = inbox?.items.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`Inbox item not found: ${id}`);
    if (parsed.flags.json) return printJson({ ok: true, item });
    return printItem(item, true);
  }
  if (sub && sub !== "show") throw new Error("Usage: awg inbox [--kind <kind>] [--limit <n>] [--json] or awg inbox show <item-id> [--json]");
  const items = filterInboxItems(inbox, { kind: str(parsed.flags, "kind"), limit: numberFlag(parsed, "limit", parsed.flags.json ? undefined : 20) });
  if (parsed.flags.json) return printJson({ ok: true, generated_at: inbox?.generated_at ?? graph.generated_at, summary: inbox?.summary ?? { total: 0, byKind: {}, bySeverity: {}, highPriority: 0 }, items });
  if (!items.length) return console.log("Maintenance inbox is empty.");
  let prior = "";
  for (const item of items) {
    const group = `${item.severity.toUpperCase()} priority ${item.priority}`;
    if (group !== prior) {
      console.log(`\n${group}`);
      prior = group;
    }
    printItem(item, false);
  }
}

function printItem(item: MaintenanceInboxItem, verbose: boolean): void {
  console.log(`- ${item.id} ${item.kind}/${item.code}: ${item.message}`);
  if (item.nodeIds.length) console.log(`  nodes: ${item.nodeIds.join(", ")}`);
  if (item.runIds.length) console.log(`  runs: ${item.runIds.join(", ")}`);
  if (verbose && item.reasons.length) console.log(`  reasons: ${item.reasons.join("; ")}`);
  for (const command of item.suggestedCommands.slice(0, verbose ? undefined : 2)) console.log(`  suggestion: ${command}`);
}

function numberFlag(parsed: ParsedArgs, key: string, fallback?: number): number | undefined {
  const value = str(parsed.flags, key);
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`--${key} must be a non-negative integer`);
  return number;
}
