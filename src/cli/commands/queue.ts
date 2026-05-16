import { buildAwg } from "../../core/compiler.js";
import { BUILT_IN_WORK_QUEUES, filterWorkQueueItems } from "../../core/workQueues.js";
import type { WorkQueueItem } from "../../core/types.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function queueCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  if (!sub || !["list", "next", "show"].includes(sub)) throw new Error("Usage: awg queue list|next|show ...");
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false });
  const index = graph.work_queue_index;
  if (sub === "show") return showQueueItem(parsed, graph);
  const queue = str(parsed.flags, "queue");
  if (queue) assertQueue(queue);
  const limit = numberFlag(parsed, "limit", sub === "next" ? 10 : parsed.flags.json ? undefined : 20);
  if (parsed.flags.autonomous && parsed.flags["human-review"]) throw new Error("--autonomous and --human-review cannot be used together");
  if (sub === "list") {
    const items = filterWorkQueueItems(index, { queue, limit, autonomous: Boolean(parsed.flags.autonomous), humanReview: Boolean(parsed.flags["human-review"]) });
    const queues = (index?.queues ?? []).filter((candidate) => !queue || candidate.id === queue);
    if (parsed.flags.json) return printJson({ ok: true, generated_at: index?.generated_at ?? graph.generated_at, summary: index?.summary ?? emptySummary(), queues, items });
    if (!items.length) return console.log("Work queues are empty for this filter.");
    for (const group of queues.filter((candidate) => items.some((item) => item.queue === candidate.id))) {
      const shown = items.filter((candidate) => candidate.queue === group.id);
      const suffix = group.count === shown.length ? `${shown.length} item${shown.length === 1 ? "" : "s"}` : `${shown.length} shown of ${group.count}`;
      console.log(`\n${group.title} (${group.id}) - ${suffix}`);
      for (const item of shown) printItem(item, false);
    }
    return;
  }
  if (parsed.flags["human-review"]) throw new Error("awg queue next does not support --human-review; use --include-human-review");
  const items = filterWorkQueueItems(index, { queue, limit, autonomous: Boolean(parsed.flags.autonomous), includeHumanReview: Boolean(parsed.flags["include-human-review"]), goal: str(parsed.flags, "goal"), graph });
  if (parsed.flags.json) return printJson({ ok: true, generated_at: index?.generated_at ?? graph.generated_at, goal: str(parsed.flags, "goal"), items });
  if (!items.length) return console.log("No next work queue items match this filter.");
  for (const item of items) printItem(item, true);
}

function showQueueItem(parsed: ParsedArgs, graph: Awaited<ReturnType<typeof buildAwg>>["graph"]): void {
  const id = parsed.positionals[2];
  if (!id) throw new Error("Usage: awg queue show <work-queue-item-id> [--json]");
  const item = graph.work_queue_index?.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Work queue item not found: ${id}`);
  const nodes = graph.nodes.filter((node) => item.nodeIds.includes(node.id));
  const runs = (graph.run_summaries ?? []).filter((run) => item.runIds.includes(String((run as { runId?: string }).runId)));
  const inboxItems = (graph.maintenance_inbox?.items ?? []).filter((candidate) => item.inboxItemIds.includes(candidate.id));
  const diagnostics = graph.diagnostics.diagnostics.filter((diag) => diag.id && (item.nodeIds.includes(diag.id) || item.edgeIds.includes(diag.id) || item.runIds.includes(diag.id)));
  const claims = (graph.claim_index?.claims ?? []).filter((claim) => item.claimIds.includes(claim.id) || item.nodeIds.includes(claim.id));
  const evidence = (graph.evidence_index?.evidence ?? []).filter((candidate) => item.evidenceIds.includes(candidate.id) || item.nodeIds.includes(candidate.id));
  if (parsed.flags.json) return printJson({ ok: true, item, nodes, runs, inboxItems, diagnostics, claims, evidence });
  printItem(item, true);
  for (const command of item.suggestedCommands) console.log(`  suggestion: ${command}`);
}

function printItem(item: WorkQueueItem, verbose: boolean): void {
  console.log(`- ${item.id} [${item.queue}] ${item.title} (${item.severity}, priority ${item.priority})`);
  if (verbose) console.log(`  ${item.summary}`);
  if (item.nodeIds.length) console.log(`  nodes: ${item.nodeIds.join(", ")}`);
  if (item.runIds.length) console.log(`  runs: ${item.runIds.join(", ")}`);
  if (verbose && item.reasons.length) console.log(`  reasons: ${item.reasons.join("; ")}`);
}

function assertQueue(queue: string): void {
  const valid = BUILT_IN_WORK_QUEUES.map((item) => item.id);
  if (!valid.includes(queue as never)) throw new Error(`Unknown queue id: ${queue}. Valid queue ids: ${valid.join(", ")}`);
}

function numberFlag(parsed: ParsedArgs, key: string, fallback?: number): number | undefined {
  const value = str(parsed.flags, key);
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`--${key} must be a non-negative integer`);
  return number;
}

function emptySummary(): Record<string, unknown> {
  return { total: 0, byQueue: {}, bySeverity: {}, autonomousSafe: 0, needsHumanReview: 0, blocked: 0, highPriority: 0 };
}
