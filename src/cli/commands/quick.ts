import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { AWG_VERSION, CORE_STATUSES } from "../../core/constants.js";
import { buildAwg } from "../../core/compiler.js";
import { attachRun, resolveWriteRunId } from "../../core/runAttribution.js";
import { edgeId, nodeId } from "../../core/ids.js";
import { runEventId } from "../../core/runs.js";
import type { AwgEdge, AwgEvent, AwgNode } from "../../core/types.js";
import { nowIso } from "../../util/time.js";
import { arr, str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

const QUICK_TYPES = ["note", "task", "risk", "question", "decision"] as const;
type QuickType = typeof QUICK_TYPES[number];

const DEFAULT_STATUS: Record<QuickType, string> = {
  note: "active",
  task: "active",
  risk: "active",
  question: "active",
  decision: "accepted"
};

const ALLOWED_STATUS: Record<QuickType, string[]> = {
  note: ["active", "needs_review"],
  task: ["active", "in_progress", "needs_review"],
  risk: ["active", "needs_review"],
  question: ["active", "needs_review"],
  decision: ["proposed", "accepted", "needs_review"]
};

export async function quickCommand(parsed: ParsedArgs): Promise<void> {
  const [, rawType, summaryArg] = parsed.positionals;
  if (!isQuickType(rawType) || !summaryArg) throw new Error(usage());
  const summary = summaryArg;
  const title = str(parsed.flags, "title") ?? summary.slice(0, 80);
  const status = str(parsed.flags, "status", DEFAULT_STATUS[rawType]) ?? DEFAULT_STATUS[rawType];
  if (!ALLOWED_STATUS[rawType].includes(status)) throw new Error(`--status for quick ${rawType} must be one of: ${ALLOWED_STATUS[rawType].join(", ")}`);
  if (!CORE_STATUSES.includes(status as never)) throw new Error(`--status must be one of: ${CORE_STATUSES.join(", ")}`);
  const target = str(parsed.flags, "target");
  if (target && !target.startsWith("n:")) throw new Error("--target must be a node id starting with n:");

  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  if (target && !graph.nodes.some((node) => node.id === target)) throw new Error(`Target node not found: ${target}`);
  const runId = resolveWriteRunId(graph, parsed.flags);
  const at = nowIso();
  const body = str(parsed.flags, "body");
  const node: AwgNode = attachRun({
    awg: AWG_VERSION,
    kind: "node",
    id: str(parsed.flags, "id") ?? nodeId(title),
    type: rawType,
    title,
    summary,
    status,
    importance: 0.5,
    confidence: status === "needs_review" || status === "proposed" ? 0.6 : 0.8,
    created_at: at,
    updated_at: at,
    tags: arr(parsed.flags, "tag"),
    ...(body ? { body } : {}),
    provenance: { created_by: "agent:codex", updated_by: "agent:codex", source: "quick_capture", human_approved: false }
  }, runId);
  if (!node.id.startsWith("n:")) throw new Error("--id for quick capture must start with n:");
  const event: AwgEvent | undefined = runId ? attachRun({
    awg: AWG_VERSION,
    kind: "event",
    id: runEventId(runId, `quick-${rawType}`, at),
    type: "node_created",
    target: node.id,
    by: "agent:codex",
    at
  }, runId) as AwgEvent : undefined;
  const edge: AwgEdge | undefined = target ? attachRun({
    awg: AWG_VERSION,
    kind: "edge" as const,
    id: edgeId(node.id, "relates_to", target),
    from: node.id,
    rel: "relates_to",
    to: target,
    created_at: at,
    reason: `Quick ${rawType} capture relates to ${target}.`
  }, runId) : undefined;
  await storage.appendLogEntry(node);
  if (edge) await storage.appendLogEntry(edge);
  if (event) await storage.appendLogEntry(event);
  if (parsed.flags.json) return printJson({ ok: true, type: rawType, nodeId: node.id, edgeId: edge?.id ?? null, runId: runId ?? null, node, edge: edge ?? null });
  console.log(`Added quick ${rawType} ${node.id}${edge ? ` -> ${target}` : ""}`);
}

function isQuickType(value: string | undefined): value is QuickType {
  return Boolean(value && QUICK_TYPES.includes(value as QuickType));
}

function usage(): string {
  return "Usage: awg quick note|task|risk|question|decision \"summary\" [--title <title>] [--body <body>] [--tag <tag>] [--target <node-id>] [--status <status>] [--run <run-id>|--no-run] [--json]";
}
