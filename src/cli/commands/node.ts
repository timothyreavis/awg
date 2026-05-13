import { buildAwg } from "../../core/compiler.js";
import { buildNodeDetail, type NodeDetailOutput } from "../../core/nodeDetail.js";
import type { AwgAnchor, AwgNode, AwgPresentationBlock, RawLogEntry } from "../../core/types.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { stableStringify } from "../../util/json.js";
import type { ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function nodeCommand(parsed: ParsedArgs): Promise<void> {
  const [, subcommand, nodeId] = parsed.positionals;
  if (subcommand !== "show" || !nodeId) throw new Error("Usage: awg node show <node-id> [--json]");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const detail = buildNodeDetail(graph, nodeId);
  if (!detail) {
    if (parsed.flags.json) {
      printJson({ ok: false, code: "node_not_found", nodeId, message: `Node not found: ${nodeId}` });
      process.exitCode = 1;
      return;
    }
    throw new Error(`Node not found: ${nodeId}`);
  }
  detail.history = await nodeHistory(storage, nodeId);
  if (parsed.flags.json) return printJson(detail);
  printNodeDetail(detail);
}

function printNodeDetail(detail: NodeDetailOutput): void {
  const { node } = detail;
  console.log(`${node.id}\t${node.type}\t${node.status}`);
  console.log(node.title);
  console.log(node.summary);
  console.log(`importance=${node.importance} confidence=${node.confidence} updated=${node.updated_at}`);
  if (node.tags?.length) console.log(`tags: ${node.tags.join(", ")}`);
  if (detail.runAttribution.directRunId) console.log(`run: ${detail.runAttribution.directRunId}`);

  if (node.body) section("Body", node.body);
  if (node.fields && Object.keys(node.fields).length) section("Fields", stableStringify(node.fields).trimEnd());
  if (node.freshness) section("Freshness", stableStringify(node.freshness).trimEnd());
  if (node.blocks?.length) section("Blocks", node.blocks.map(formatBlock).join("\n"));
  if (node.anchors?.length) section("Anchors", node.anchors.map(formatAnchor).join("\n"));
  const additional = additionalNodeFields(node);
  if (Object.keys(additional).length) section("Additional Fields", stableStringify(additional).trimEnd());

  if (detail.edges.outgoing.length || detail.edges.incoming.length) {
    const lines = [
      ...detail.edges.outgoing.map((edge) => `- ${edge.id}: ${node.id} -${edge.rel}-> ${edge.to}`),
      ...detail.edges.incoming.map((edge) => `- ${edge.id}: ${edge.from} -${edge.rel}-> ${node.id}`)
    ];
    section("Edges", lines.join("\n"));
  }
  if (detail.responses.length) section("Responses", detail.responses.map((response) => `- ${response.id}: ${response.type} by ${response.by} at ${response.at}: ${response.summary}`).join("\n"));
  if (detail.evidence.nodes.length) {
    section("Evidence", detail.evidence.nodes.map((evidence) => `- ${evidence.id}: ${evidence.summary}`).join("\n"));
  }
  if (detail.diagnostics.length) section("Diagnostics", detail.diagnostics.map((diag) => `- ${diag.severity} ${diag.code}: ${diag.message}`).join("\n"));
  if (detail.runAttribution.runs.length) {
    section("Run Attribution", detail.runAttribution.runs.map((run) => `- ${run.runId}: ${run.roles.join(", ")}`).join("\n"));
  }
  if (detail.history && detail.history.snapshotCount > 1) {
    section("History", detail.history.snapshots.map((snapshot) => `- ${snapshot.file}:${snapshot.line} ${snapshot.node.updated_at}: ${snapshot.node.summary}`).join("\n"));
  }
}

function section(title: string, body: string): void {
  console.log(`\n${title}:`);
  console.log(body);
}

function formatAnchor(anchor: AwgAnchor): string {
  const value = anchor.url ?? anchor.path ?? anchor.name ?? anchor.label ?? "";
  return `- ${anchor.kind}${value ? `: ${value}` : ""}`;
}

function formatBlock(block: AwgPresentationBlock): string {
  const title = block.title ? ` ${block.title}` : "";
  return `- ${block.type}${title}: ${stableStringify(block.data).trimEnd()}`;
}

function additionalNodeFields(node: NodeDetailOutput["node"]): Record<string, unknown> {
  const known = new Set([
    "awg", "kind", "id", "type", "title", "summary", "status", "importance", "confidence", "created_at", "updated_at",
    "tags", "body", "fields", "blocks", "freshness", "anchors", "review_after", "superseded_by", "run", "runId", "meta"
  ]);
  return Object.fromEntries(Object.entries(node).filter(([key, value]) => !known.has(key) && value !== undefined));
}

async function nodeHistory(storage: FileAwgStorage, nodeId: string): Promise<NonNullable<NodeDetailOutput["history"]>> {
  const snapshots = (await storage.readLogEntries()).flatMap((entry) => nodeSnapshot(entry, nodeId));
  return { snapshotCount: snapshots.length, snapshots };
}

function nodeSnapshot(entry: RawLogEntry, nodeId: string): NonNullable<NodeDetailOutput["history"]>["snapshots"] {
  try {
    const parsed = JSON.parse(entry.raw) as Partial<AwgNode>;
    if (parsed.kind !== "node" || parsed.id !== nodeId) return [];
    return [{ file: entry.file, line: entry.line, node: parsed as AwgNode }];
  } catch {
    return [];
  }
}
