import { AWG_VERSION, CORE_STATUSES } from "../../core/constants.js";
import { buildAwg } from "../../core/compiler.js";
import { activeRun, buildRuns } from "../../core/runs.js";
import type { AwgEvent, AwgNode } from "../../core/types.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { nowIso } from "../../util/time.js";
import { arr, str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function updateCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub, nodeId] = parsed.positionals;
  if (sub !== "node" || !nodeId) throw new Error("Usage: awg update node <node-id> [--title ...] [--summary ...] [--status ...] [--json]");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const run = activeRun(buildRuns(graph));
  const prior = graph.nodes.find((node) => node.id === nodeId);
  if (!prior) throw new Error(`Node not found: ${nodeId}`);
  const at = nowIso();
  const patch = nodePatch(parsed);
  if (Object.keys(patch).length === 0) throw new Error("No update fields provided.");
  if (patch.tags) patch.tags = [...new Set([...(prior.tags ?? []), ...patch.tags])].sort();
  if (patch.anchors) patch.anchors = [...(prior.anchors ?? []), ...patch.anchors];
  const next: AwgNode = { ...prior, ...patch, updated_at: at };
  await storage.appendLogEntry(next);
  const eventId = `ev:${nodeId.replace(/^n:/, "")}:update:${at.replace(/[^0-9]/g, "")}`;
  const event: AwgEvent = { awg: AWG_VERSION, kind: "event", id: eventId, type: "node_updated", target: nodeId, by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex", at, fields: Object.keys(patch).sort() };
  if (run) event.run = run.id;
  await storage.appendLogEntry(event);
  const output = { ok: true, nodeId, eventId, updated: patch, warnings: [] as string[] };
  if (parsed.flags.json) return printJson(output);
  console.log(`Updated node ${nodeId}`);
}

function nodePatch(parsed: ParsedArgs): Partial<AwgNode> {
  const patch: Partial<AwgNode> = {};
  for (const key of ["title", "summary", "status", "review-after"] as const) {
    const value = str(parsed.flags, key);
    if (value !== undefined) (patch as Record<string, unknown>)[key.replace(/-/g, "_")] = value;
  }
  if (patch.status && !CORE_STATUSES.includes(patch.status as never)) throw new Error(`--status must be one of: ${CORE_STATUSES.join(", ")}`);
  for (const key of ["importance", "confidence"] as const) {
    const value = str(parsed.flags, key);
    if (value !== undefined) {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`--${key} must be a number between 0 and 1`);
      patch[key] = number;
    }
  }
  const tags = arr(parsed.flags, "tag");
  if (tags.length) patch.tags = tags;
  const evidenceRequired = str(parsed.flags, "evidence-required");
  if (evidenceRequired !== undefined) patch.evidence_required = evidenceRequired === "true" || evidenceRequired === "1" || evidenceRequired === "yes";
  const anchors = arr(parsed.flags, "anchor").map(parseAnchor);
  if (anchors.length) patch.anchors = anchors;
  return patch;
}

function parseAnchor(value: string): { kind: "file" | "symbol" | "url" | "command" | "doc" | "external"; path?: string; name?: string; url?: string; label?: string } {
  const separator = value.indexOf(":");
  const kind = separator >= 0 ? value.slice(0, separator) : value;
  const rest = separator >= 0 ? value.slice(separator + 1) : "";
  if (!["file", "symbol", "url", "command", "doc", "external"].includes(kind)) throw new Error("--anchor must start with file:, symbol:, url:, command:, doc:, or external:");
  if (kind === "url") return { kind, url: rest };
  if (kind === "command") return { kind, label: rest };
  return { kind: kind as never, path: rest || undefined, label: rest || undefined };
}
