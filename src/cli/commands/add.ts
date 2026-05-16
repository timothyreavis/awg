import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { AWG_VERSION, CORE_EDGE_RELS, CORE_STATUSES } from "../../core/constants.js";
import { assertCliViewBlocks } from "../../core/blocks.js";
import { LENS_AUDIENCES, LENS_SCOPES, validateLens } from "../../core/lensConfigs.js";
import { relationError } from "../../core/relations.js";
import { buildAwg } from "../../core/compiler.js";
import { runEventId } from "../../core/runs.js";
import { attachRun, resolveWriteRunId } from "../../core/runAttribution.js";
import { edgeId, nodeId, responseId } from "../../core/ids.js";
import type { AwgEdge, AwgEvent, AwgLens, AwgLensSection, AwgNode, AwgPresentationBlock, AwgResponse, AwgView } from "../../core/types.js";
import { nowIso } from "../../util/time.js";
import { arr, str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";
import { applyRichNodePatch, parseJsonInput, richNodePatch } from "../nodeContent.js";

export async function addCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  if (sub === "node") return addNode(parsed);
  if (sub === "claim") return addClaim(parsed);
  if (sub === "edge") return addEdge(parsed);
  if (sub === "response") return addResponse(parsed);
  if (sub === "evidence") return addEvidence(parsed);
  if (sub === "view") return addView(parsed);
  if (sub === "lens") return addLens(parsed);
  throw new Error("Usage: awg add node|claim|edge|response|evidence|view|lens ...");
}

async function addClaim(parsed: ParsedArgs): Promise<void> {
  const title = required(parsed, "title");
  const claim = required(parsed, "claim");
  const at = nowIso();
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const runId = resolveWriteRunId(graph, parsed.flags);
  const kind = str(parsed.flags, "kind", "fact") ?? "fact";
  if (!["fact", "assumption", "hypothesis", "requirement", "policy", "metric", "external_fact", "implementation_fact"].includes(kind)) throw new Error("--kind must be one of: fact, assumption, hypothesis, requirement, policy, metric, external_fact, implementation_fact");
  const node: AwgNode = attachRun({
    awg: AWG_VERSION,
    kind: "node",
    id: str(parsed.flags, "id") ?? nodeId(title),
    type: "claim",
    title,
    summary: str(parsed.flags, "summary") ?? claim.slice(0, 160),
    status: str(parsed.flags, "status", "active") ?? "active",
    importance: numberFlag(parsed, "importance", 0.5),
    confidence: numberFlag(parsed, "confidence", 0.8),
    created_at: at,
    updated_at: at,
    tags: arr(parsed.flags, "tag"),
    fields: {
      claim,
      claim_kind: kind,
      verification_status: "unverified",
      source_of_truth: str(parsed.flags, "source-of-truth"),
      review_after: str(parsed.flags, "review-after")
    },
    freshness: {
      state: "unknown",
      review_after: str(parsed.flags, "review-after"),
      source_of_truth: str(parsed.flags, "source-of-truth")
    }
  }, runId);
  if (parsed.flags["evidence-required"] !== undefined) node.evidence_required = true;
  node.provenance = { created_by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex", updated_by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex", source: "agent_generated", human_approved: false };
  await storage.appendLogEntry(node);
  if (runId) await storage.appendLogEntry(attachRun({ awg: AWG_VERSION, kind: "event", id: runEventId(runId, "claim", at), type: "claim_created", target: node.id, by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex", at }, runId) as AwgEvent);
  if (parsed.flags.json) return printJson({ ok: true, claimId: node.id, node });
  console.log(`Added claim ${node.id}`);
}

async function addLens(parsed: ParsedArgs): Promise<void> {
  const id = required(parsed, "id");
  const title = required(parsed, "title");
  const purpose = required(parsed, "purpose");
  const scope = str(parsed.flags, "scope", "vault") ?? "vault";
  const audience = str(parsed.flags, "audience", "agent") ?? "agent";
  if (!LENS_SCOPES.includes(scope as never)) throw new Error(`--scope must be one of: ${LENS_SCOPES.join(", ")}`);
  if (!LENS_AUDIENCES.includes(audience as never)) throw new Error(`--audience must be one of: ${LENS_AUDIENCES.join(", ")}`);
  const at = nowIso();
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const runId = resolveWriteRunId(graph, parsed.flags);
  const lens: AwgLens = attachRun({
    awg: AWG_VERSION,
    kind: "lens",
    id,
    title,
    purpose,
    summary: str(parsed.flags, "summary"),
    status: str(parsed.flags, "status", "needs_review") ?? "needs_review",
    scope,
    audience,
    selector: parseObjectInput(parsed, "selector-json"),
    sections: parseLensSections(required(parsed, "sections-json"), "--sections-json"),
    budget: parseObjectInput(parsed, "budget-json"),
    tags: arr(parsed.flags, "tag"),
    created_at: at,
    updated_at: at
  }, runId);
  const blocking = validateLens(lens, graph, "fatal").filter((diag) => diag.severity === "fatal");
  if (blocking.length) throw new Error(blocking[0].message);
  const by = str(parsed.flags, "by", "agent:codex") ?? "agent:codex";
  await storage.appendLogEntry(lens);
  if (runId) await storage.appendLogEntry(attachRun({ awg: AWG_VERSION, kind: "event", id: runEventId(runId, "lens", at), type: "lens_created", target: lens.id, by, at }, runId) as AwgEvent);
  if (parsed.flags.json) return printJson({ ok: true, lensId: lens.id, lens });
  console.log(`Added lens ${lens.id}`);
}

async function addView(parsed: ParsedArgs): Promise<void> {
  const id = required(parsed, "id");
  if (!/^v:.+/.test(id)) throw new Error("--id for view must start with v: and include a non-empty slug");
  const title = required(parsed, "title");
  const audience = str(parsed.flags, "audience", "human") ?? "human";
  if (!["human", "agent", "reviewer"].includes(audience)) throw new Error("--audience must be one of: human, agent, reviewer");
  const at = nowIso();
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const runId = resolveWriteRunId(graph, parsed.flags);
  const blocks = parseViewBlocks(parsed);
  const view: AwgView = attachRun({
    awg: AWG_VERSION,
    kind: "view",
    id,
    title,
    summary: str(parsed.flags, "summary"),
    audience,
    blocks,
    tags: arr(parsed.flags, "tag"),
    created_at: at,
    updated_at: at
  }, runId);
  const by = str(parsed.flags, "by", "agent:codex") ?? "agent:codex";
  await storage.appendLogEntry(view);
  if (runId) await storage.appendLogEntry(attachRun({ awg: AWG_VERSION, kind: "event", id: runEventId(runId, "view", at), type: "view_created", target: view.id, by, at }, runId) as AwgEvent);
  if (parsed.flags.json) return printJson({ ok: true, viewId: view.id, view });
  console.log(`Added view ${view.id}`);
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
  if (parsed.flags["evidence-required"] !== undefined) node.evidence_required = true;
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
  if (!CORE_EDGE_RELS.includes(rel as never)) throw new Error(relationError(rel));
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
  if (!["terminal", "test", "manual", "file", "url", "log", "doc", "system", "other"].includes(source)) throw new Error("--source must be one of: terminal, test, manual, file, url, log, doc, system, other");
  if (!["passed", "failed", "unknown", "superseded"].includes(evidenceStatus)) throw new Error("--status must be one of: passed, failed, unknown, superseded");
  const rel = str(parsed.flags, "rel") ?? (evidenceStatus === "failed" ? "contradicts" : "supports");
  if (!["supports", "contradicts", "verified_by", "derived_from"].includes(rel)) throw new Error("--rel must be one of: supports, contradicts, verified_by, derived_from. Use `awg add edge` for non-proof relationships.");
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
    observed_at: at,
    command: str(parsed.flags, "command"),
    path: str(parsed.flags, "path"),
    url: str(parsed.flags, "url"),
    expires_at: str(parsed.flags, "expires-at"),
    review_after: str(parsed.flags, "review-after"),
    reliability: str(parsed.flags, "reliability"),
    excerpt: str(parsed.flags, "excerpt"),
    redacted: parsed.flags.redacted !== undefined
  }, runId);
  if (evidenceNode.reliability && !["low", "medium", "high"].includes(String(evidenceNode.reliability))) throw new Error("--reliability must be one of: low, medium, high");
  const edgeFrom = rel === "verified_by" || rel === "derived_from" ? target : evidenceNode.id;
  const edgeTo = rel === "verified_by" || rel === "derived_from" ? evidenceNode.id : target;
  const edge: AwgEdge = attachRun({ awg: AWG_VERSION, kind: "edge", id: edgeId(edgeFrom, rel, edgeTo), from: edgeFrom, rel, to: edgeTo, created_at: at, reason: summary }, runId);
  const targetEvidence = Array.isArray(targetNode.evidence) ? targetNode.evidence : [];
  const fields = targetNode.fields && typeof targetNode.fields === "object" && !Array.isArray(targetNode.fields) ? targetNode.fields : {};
  const verification_status = nextVerificationStatus(String(fields.verification_status ?? "unverified"), evidenceStatus);
  const claimBearing = targetNode.type === "claim" || typeof fields.claim === "string" || typeof fields.claim_kind === "string";
  const updatedTarget: AwgNode = { ...targetNode, evidence: [...targetEvidence, { id: evidenceNode.id, summary, source: evidenceNode.source, status: evidenceNode.evidence_status, at, url: evidenceNode.url, path: evidenceNode.path, expires_at: evidenceNode.expires_at, review_after: evidenceNode.review_after }], updated_at: at };
  if (claimBearing) updatedTarget.fields = { ...fields, verification_status, verified_at: evidenceStatus === "passed" ? at : fields.verified_at, verified_by: evidenceNode.id };
  const eventId = `ev:${target.replace(/^n:/, "")}:evidence:${at.replace(/[^0-9]/g, "")}`;
  const event: AwgEvent = attachRun({ awg: AWG_VERSION, kind: "event", id: eventId, type: "evidence_added", target, by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex", at, evidence: evidenceNode.id }, runId);
  await storage.appendLogEntry(evidenceNode);
  await storage.appendLogEntry(edge);
  await storage.appendLogEntry(updatedTarget);
  await storage.appendLogEntry(event);
  if (parsed.flags.json) return printJson({ ok: true, target, evidenceNodeId: evidenceNode.id, edgeId: edge.id, edgeIds: [edge.id], eventId, verificationStatus: verification_status });
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

function parseViewBlocks(parsed: ParsedArgs): AwgPresentationBlock[] {
  const blocks = [
    ...arr(parsed.flags, "block-json").flatMap((value) => parseViewBlockInput(value, "--block-json")),
    ...(str(parsed.flags, "blocks-json") !== undefined ? parseViewBlockInput(required(parsed, "blocks-json"), "--blocks-json") : [])
  ];
  if (!blocks.length) throw new Error("View requires at least one --block-json or --blocks-json block");
  assertCliViewBlocks(blocks, "--blocks-json");
  return blocks;
}

function parseViewBlockInput(value: string, flag: string): AwgPresentationBlock[] {
  const parsed = parseJsonInput(value, flag);
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  for (const block of blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) throw new Error(`${flag} must contain a block object or array of block objects`);
  }
  return blocks as AwgPresentationBlock[];
}

function parseObjectInput(parsed: ParsedArgs, key: string): Record<string, unknown> | undefined {
  const value = str(parsed.flags, key);
  if (value === undefined) return undefined;
  const parsedValue = parseJsonInput(value, `--${key}`);
  if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) throw new Error(`--${key} must be a JSON object`);
  return parsedValue as Record<string, unknown>;
}

function parseLensSections(value: string, flag: string): AwgLensSection[] {
  const parsed = parseJsonInput(value, flag);
  if (!Array.isArray(parsed)) throw new Error(`${flag} must be a JSON array`);
  for (const section of parsed) {
    if (!section || typeof section !== "object" || Array.isArray(section)) throw new Error(`${flag} must contain section objects`);
  }
  return parsed as AwgLensSection[];
}

function nextVerificationStatus(current: string, evidenceStatus: string): string {
  if (evidenceStatus === "failed") return "contradicted";
  if (evidenceStatus === "passed") return current === "contradicted" ? current : "verified";
  if (evidenceStatus === "unknown") return ["verified", "contradicted"].includes(current) ? current : "supported";
  return current;
}
