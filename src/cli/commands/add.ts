import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { AWG_VERSION, CORE_EDGE_RELS, CORE_STATUSES } from "../../core/constants.js";
import { buildAwg } from "../../core/compiler.js";
import { runEventId } from "../../core/runs.js";
import { attachRun, resolveWriteRunId } from "../../core/runAttribution.js";
import { edgeId, nodeId, responseId } from "../../core/ids.js";
import type { AwgEdge, AwgEvent, AwgNode, AwgResponse } from "../../core/types.js";
import { nowIso } from "../../util/time.js";
import { arr, str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";
import { applyRichNodePatch, richNodePatch } from "../nodeContent.js";

export async function addCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  if (sub === "node") return addNode(parsed);
  if (sub === "edge") return addEdge(parsed);
  if (sub === "response") return addResponse(parsed);
  if (sub === "evidence") return addEvidence(parsed);
  throw new Error("Usage: awg add node|edge|response|evidence ...");
}

async function addNode(parsed: ParsedArgs): Promise<void> {
  const type = required(parsed, "type");
  const title = required(parsed, "title");
  const summary = required(parsed, "summary");
  const id = str(parsed.flags, "id");
  if (id && !id.startsWith("n:")) throw new Error("--id for node must start with n:");
  const status = str(parsed.flags, "status", "active") ?? "active";
  if (!CORE_STATUSES.includes(status as never)) throw new Error(`--status must be one of: ${CORE_STATUSES.join(", ")}`);
  const at = nowIso();
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const runId = resolveWriteRunId(graph, parsed.flags);
  const rich = richNodePatch(parsed);
  const applied = applyRichNodePatch(undefined, rich);
  const node: AwgNode = attachRun({
    awg: AWG_VERSION,
    kind: "node",
    id: id ?? nodeId(title),
    type,
    title,
    summary,
    status,
    importance: numberFlag(parsed, "importance", 0.5),
    confidence: numberFlag(parsed, "confidence", 0.8),
    created_at: at,
    updated_at: at,
    tags: arr(parsed.flags, "tag")
    , ...applied.patch
  }, runId);
  const source = str(parsed.flags, "source");
  const createdBy = str(parsed.flags, "created-by", "agent:codex");
  if (source) node.source = source;
  node.provenance = { created_by: createdBy, updated_by: createdBy, source: source ?? "agent_generated", human_approved: false };
  await storage.appendLogEntry(node);
  if (runId) await storage.appendLogEntry(attachRun({ awg: AWG_VERSION, kind: "event", id: runEventId(runId, "node", at), type: "node_created", target: node.id, by: createdBy, at }, runId) as AwgEvent);
  if (parsed.flags.json) return printJson({ ok: true, nodeId: node.id, node, updated: applied.updatedKeys, warnings: applied.warnings });
  console.log(`Added node ${node.id}`);
}

async function addEdge(parsed: ParsedArgs): Promise<void> {
  const from = required(parsed, "from");
  const rel = required(parsed, "rel");
  const to = required(parsed, "to");
  const id = str(parsed.flags, "id");
  if (!from.startsWith("n:")) throw new Error("--from must be a node id starting with n:");
  if (!to.startsWith("n:")) throw new Error("--to must be a node id starting with n:");
  if (id && !id.startsWith("e:")) throw new Error("--id for edge must start with e:");
  if (!CORE_EDGE_RELS.includes(rel as never)) throw new Error(`--rel must be one of: ${CORE_EDGE_RELS.join(", ")}`);
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const runId = resolveWriteRunId(graph, parsed.flags);
  const at = nowIso();
  const edge: AwgEdge = attachRun({
    awg: AWG_VERSION,
    kind: "edge",
    id: id ?? edgeId(from, rel, to),
    from,
    rel,
    to,
    created_at: at
  }, runId);
  const reason = str(parsed.flags, "reason");
  if (reason) edge.reason = reason;
  const confidence = str(parsed.flags, "confidence");
  if (confidence !== undefined) edge.confidence = numberFlag(parsed, "confidence");
  await storage.appendLogEntry(edge);
  if (runId) await storage.appendLogEntry(attachRun({ awg: AWG_VERSION, kind: "event", id: runEventId(runId, "edge", at), type: "edge_created", target: edge.id, by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex", at, from, to, rel }, runId) as AwgEvent);
  if (parsed.flags.json) return printJson({ ok: true, edgeId: edge.id, edge });
  console.log(`Added edge ${edge.id}`);
}

async function addResponse(parsed: ParsedArgs): Promise<void> {
  const id = str(parsed.flags, "id");
  if (id && !id.startsWith("r:")) throw new Error("--id for response must start with r:");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const runId = resolveWriteRunId(graph, parsed.flags);
  const at = nowIso();
  const response: AwgResponse = attachRun({
    awg: AWG_VERSION,
    kind: "response",
    id: id ?? responseId(),
    type: required(parsed, "type"),
    target: required(parsed, "target"),
    summary: required(parsed, "summary"),
    by: str(parsed.flags, "by", "human") ?? "human",
    at
  }, runId);
  await storage.appendLogEntry(response);
  if (runId) await storage.appendLogEntry(attachRun({ awg: AWG_VERSION, kind: "event", id: runEventId(runId, "response", at), type: "response_added", target: response.target, by: response.by, at, response: response.id }, runId) as AwgEvent);
  if (parsed.flags.json) return printJson({ ok: true, responseId: response.id, response });
  console.log(`Added response ${response.id}`);
}

async function addEvidence(parsed: ParsedArgs): Promise<void> {
  const target = required(parsed, "target");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const runId = resolveWriteRunId(graph, parsed.flags);
  const targetNode = graph.nodes.find((node) => node.id === target);
  if (!targetNode) throw new Error(`Target node not found: ${target}`);
  const at = nowIso();
  const summary = required(parsed, "summary");
  const id = str(parsed.flags, "id");
  if (id && !id.startsWith("n:")) throw new Error("--id for evidence must start with n:");
  const source = str(parsed.flags, "source", "manual") ?? "manual";
  const evidenceStatus = str(parsed.flags, "status", "unknown") ?? "unknown";
  if (!["terminal", "test", "manual", "file", "url", "log", "other"].includes(source)) throw new Error("--source must be one of: terminal, test, manual, file, url, log, other");
  if (!["passed", "failed", "unknown"].includes(evidenceStatus)) throw new Error("--status must be one of: passed, failed, unknown");
  const rel = str(parsed.flags, "rel", "supports") ?? "supports";
  if (!CORE_EDGE_RELS.includes(rel as never)) throw new Error(`--rel must be one of: ${CORE_EDGE_RELS.join(", ")}`);
  const evidenceNode: AwgNode = attachRun({
    awg: AWG_VERSION,
    kind: "node",
    id: id ?? nodeId(str(parsed.flags, "title") ?? summary),
    type: "evidence",
    title: str(parsed.flags, "title") ?? summary.slice(0, 80),
    summary,
    status: "active",
    importance: numberFlag(parsed, "importance", 0.5),
    confidence: numberFlag(parsed, "confidence", 0.8),
    created_at: at,
    updated_at: at,
    source,
    evidence_status: evidenceStatus,
    command: str(parsed.flags, "command"),
    path: str(parsed.flags, "path")
  }, runId);
  const edge: AwgEdge = attachRun({ awg: AWG_VERSION, kind: "edge", id: edgeId(evidenceNode.id, rel, target), from: evidenceNode.id, rel, to: target, created_at: at, reason: summary }, runId);
  const targetEvidence = Array.isArray(targetNode.evidence) ? targetNode.evidence : [];
  const updatedTarget: AwgNode = { ...targetNode, evidence: [...targetEvidence, { id: evidenceNode.id, summary, source: evidenceNode.source, status: evidenceNode.evidence_status, at }], updated_at: at };
  const eventId = `ev:${target.replace(/^n:/, "")}:evidence:${at.replace(/[^0-9]/g, "")}`;
  const event: AwgEvent = attachRun({ awg: AWG_VERSION, kind: "event", id: eventId, type: "evidence_added", target, by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex", at, evidence: evidenceNode.id }, runId);
  await storage.appendLogEntry(evidenceNode);
  await storage.appendLogEntry(edge);
  await storage.appendLogEntry(updatedTarget);
  await storage.appendLogEntry(event);
  if (parsed.flags.json) return printJson({ ok: true, target, evidenceNodeId: evidenceNode.id, edgeId: edge.id, eventId });
  console.log(`Added evidence ${evidenceNode.id} -> ${target}`);
}

function required(parsed: ParsedArgs, key: string): string {
  const value = str(parsed.flags, key);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

function numberFlag(parsed: ParsedArgs, key: string, fallback?: number): number {
  const value = str(parsed.flags, key);
  if (value === undefined) {
    if (fallback === undefined) throw new Error(`Missing required --${key}`);
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`--${key} must be a number between 0 and 1`);
  return number;
}
