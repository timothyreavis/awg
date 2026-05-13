import type { AwgEdge, AwgNode } from "./types.js";

export function evidenceIdsFromNode(node: Pick<AwgNode, "evidence"> | undefined): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(node?.evidence)) return ids;
  for (const item of node.evidence) {
    const id = evidenceIdFromEntry(item);
    if (id) ids.add(id);
  }
  return ids;
}

export function hasEvidenceReference(node: AwgNode | undefined, incoming: AwgEdge[], nodeById: Map<string, AwgNode>): boolean {
  if (!node) return false;
  const evidenceIds = evidenceIdsFromNode(node);
  if ([...evidenceIds].some((id) => nodeById.has(id))) return true;
  return incoming.some((edge) => nodeById.get(edge.from)?.type === "evidence");
}

function evidenceIdFromEntry(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.id === "string") return record.id;
  if (typeof record.nodeId === "string") return record.nodeId;
  return undefined;
}
