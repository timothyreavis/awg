import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { AWG_VERSION } from "../../core/constants.js";
import { edgeId, nodeId, responseId } from "../../core/ids.js";
import type { AwgEdge, AwgNode, AwgResponse } from "../../core/types.js";
import { nowIso } from "../../util/time.js";
import { arr, str, type ParsedArgs } from "../args.js";

export async function addCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  if (sub === "node") return addNode(parsed);
  if (sub === "edge") return addEdge(parsed);
  if (sub === "response") return addResponse(parsed);
  throw new Error("Usage: awg add node|edge|response ...");
}

async function addNode(parsed: ParsedArgs): Promise<void> {
  const type = required(parsed, "type");
  const title = required(parsed, "title");
  const summary = required(parsed, "summary");
  const at = nowIso();
  const node: AwgNode = {
    awg: AWG_VERSION,
    kind: "node",
    id: str(parsed.flags, "id") ?? nodeId(title),
    type,
    title,
    summary,
    status: str(parsed.flags, "status", "active") ?? "active",
    importance: numberFlag(parsed, "importance", 0.5),
    confidence: numberFlag(parsed, "confidence", 0.8),
    created_at: at,
    updated_at: at,
    tags: arr(parsed.flags, "tag")
  };
  const body = str(parsed.flags, "body");
  const source = str(parsed.flags, "source");
  const createdBy = str(parsed.flags, "created-by", "agent:codex");
  if (body) node.body = body;
  if (source) node.source = source;
  node.provenance = { created_by: createdBy, updated_by: createdBy, source: source ?? "agent_generated", human_approved: false };
  await new FileAwgStorage().appendLogEntry(node);
  console.log(`Added node ${node.id}`);
}

async function addEdge(parsed: ParsedArgs): Promise<void> {
  const from = required(parsed, "from");
  const rel = required(parsed, "rel");
  const to = required(parsed, "to");
  const edge: AwgEdge = {
    awg: AWG_VERSION,
    kind: "edge",
    id: str(parsed.flags, "id") ?? edgeId(from, rel, to),
    from,
    rel,
    to,
    created_at: nowIso()
  };
  const reason = str(parsed.flags, "reason");
  if (reason) edge.reason = reason;
  const confidence = str(parsed.flags, "confidence");
  if (confidence !== undefined) edge.confidence = numberFlag(parsed, "confidence");
  await new FileAwgStorage().appendLogEntry(edge);
  console.log(`Added edge ${edge.id}`);
}

async function addResponse(parsed: ParsedArgs): Promise<void> {
  const response: AwgResponse = {
    awg: AWG_VERSION,
    kind: "response",
    id: str(parsed.flags, "id") ?? responseId(),
    type: required(parsed, "type"),
    target: required(parsed, "target"),
    summary: required(parsed, "summary"),
    by: str(parsed.flags, "by", "human") ?? "human",
    at: nowIso()
  };
  await new FileAwgStorage().appendLogEntry(response);
  console.log(`Added response ${response.id}`);
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
