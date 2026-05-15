import { AWG_VERSION } from "../../core/constants.js";
import { buildAwg } from "../../core/compiler.js";
import { edgeId } from "../../core/ids.js";
import { attachRun, resolveWriteRunId } from "../../core/runAttribution.js";
import { runEventId } from "../../core/runs.js";
import type { AwgEdge, AwgEvent, CompiledGraph } from "../../core/types.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { nowIso } from "../../util/time.js";
import { str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function reconcileCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  if (sub === "duplicate") return duplicate(parsed);
  if (sub === "supersede") return twoNodeReconcile(parsed, "supersedes", "superseded_by", "supersede");
  if (sub === "contradict") return twoNodeReconcile(parsed, "contradicts", "contradicts", "contradict");
  if (sub === "resolved-by") return twoNodeReconcile(parsed, "resolved_by", undefined, "resolved-by");
  if (sub === "intentionally-open") return intentionallyOpen(parsed);
  throw new Error("Usage: awg reconcile duplicate|supersede|contradict|resolved-by|intentionally-open ...");
}

async function duplicate(parsed: ParsedArgs): Promise<void> {
  const a = parsed.positionals[2];
  const b = parsed.positionals[3];
  const canonical = required(parsed, "canonical");
  if (!a || !b) throw new Error("Usage: awg reconcile duplicate <a> <b> --canonical <id> [--reason \"...\"] [--json]");
  assertDistinct(a, b);
  if (canonical !== a && canonical !== b) throw new Error("--canonical must be one of the duplicate node IDs.");
  const duplicateId = canonical === a ? b : a;
  await appendReconciliation(parsed, [
    { from: duplicateId, rel: "duplicate_of", to: canonical },
    { from: canonical, rel: "canonical_for", to: duplicateId }
  ], "duplicate");
}

async function twoNodeReconcile(parsed: ParsedArgs, rel: string, reverseRel: string | undefined, label: string): Promise<void> {
  const a = parsed.positionals[2];
  const b = parsed.positionals[3];
  if (!a || !b) throw new Error(`Usage: awg reconcile ${label} <a> <b> [--reason "..."] [--json]`);
  assertDistinct(a, b);
  const specs = [{ from: label === "resolved-by" ? a : b, rel, to: label === "supersede" ? a : b }];
  if (label === "supersede") specs[0] = { from: b, rel: "supersedes", to: a };
  if (label === "contradict") specs[0] = { from: a, rel: "contradicts", to: b };
  if (label === "resolved-by") specs[0] = { from: a, rel: "resolved_by", to: b };
  if (reverseRel) specs.push({ from: specs[0].to, rel: reverseRel, to: specs[0].from });
  await appendReconciliation(parsed, specs, label);
}

async function intentionallyOpen(parsed: ParsedArgs): Promise<void> {
  const target = parsed.positionals[2];
  if (!target) throw new Error("Usage: awg reconcile intentionally-open <target> [--reason \"...\"] [--json]");
  if (!str(parsed.flags, "reason")) throw new Error("--reason is required for intentionally-open acknowledgements.");
  await appendReconciliation(parsed, [{ from: target, rel: "intentionally_open", to: target }], "intentionally-open");
}

async function appendReconciliation(parsed: ParsedArgs, specs: Array<{ from: string; rel: string; to: string }>, action: string): Promise<void> {
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  for (const id of new Set(specs.flatMap((spec) => [spec.from, spec.to]))) assertNode(graph, id);
  const runId = resolveWriteRunId(graph, parsed.flags);
  const at = nowIso();
  const by = str(parsed.flags, "by", "agent:codex") ?? "agent:codex";
  const reason = str(parsed.flags, "reason");
  const edges: AwgEdge[] = specs.map((spec) => attachRun({
    awg: AWG_VERSION,
    kind: "edge",
    id: edgeId(spec.from, spec.rel, spec.to),
    from: spec.from,
    rel: spec.rel,
    to: spec.to,
    created_at: at,
    reason
  }, runId));
  for (const edge of edges) await storage.appendLogEntry(edge);
  const event: AwgEvent = attachRun({
    awg: AWG_VERSION,
    kind: "event",
    id: runEventId(runId ?? `reconcile:${action}`, "reconcile", at),
    type: "reconciliation_added",
    target: specs[0].from,
    by,
    at,
    action,
    edgeIds: edges.map((edge) => edge.id),
    reason
  }, runId);
  await storage.appendLogEntry(event);
  if (parsed.flags.json) return printJson({ ok: true, action, edgeIds: edges.map((edge) => edge.id), edges, eventId: event.id, runId: runId ?? null });
  console.log(`Added reconciliation ${action}: ${edges.map((edge) => edge.id).join(", ")}`);
}

function assertNode(graph: CompiledGraph, id: string): void {
  if (!id.startsWith("n:")) throw new Error(`Reconciliation target must be a node id: ${id}`);
  if (!graph.nodes.some((node) => node.id === id)) throw new Error(`Node not found: ${id}`);
}

function assertDistinct(a: string, b: string): void {
  if (a === b) throw new Error("Reconciliation targets must be distinct node IDs.");
}

function required(parsed: ParsedArgs, key: string): string {
  const value = str(parsed.flags, key);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}
