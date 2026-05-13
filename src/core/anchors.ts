import type { AnchorIndex, AnchorIndexEntry, AwgAnchor, AwgNode } from "./types.js";

export function buildAnchorIndex(nodes: AwgNode[]): AnchorIndex {
  const groups = new Map<string, AnchorIndexEntry>();
  const byNodeId: Record<string, AnchorIndexEntry[]> = {};
  for (const node of nodes) {
    for (const anchor of node.anchors ?? []) {
      const value = anchorValue(anchor);
      if (!value) continue;
      const key = `${anchor.kind}\0${value}`;
      const entry = groups.get(key) ?? { key, kind: anchor.kind, value, nodeIds: [] };
      if (!entry.nodeIds.includes(node.id)) entry.nodeIds.push(node.id);
      groups.set(key, entry);
    }
  }
  const entries = [...groups.values()].map((entry) => ({ ...entry, nodeIds: entry.nodeIds.sort() })).sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
  const byKind: Record<string, AnchorIndexEntry[]> = {};
  for (const entry of entries) {
    (byKind[entry.kind] ||= []).push(entry);
    for (const nodeId of entry.nodeIds) (byNodeId[nodeId] ||= []).push(entry);
  }
  for (const entriesForNode of Object.values(byNodeId)) entriesForNode.sort((a, b) => a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value));
  return { entries, byKind, byNodeId: Object.fromEntries(Object.entries(byNodeId).sort(([a], [b]) => a.localeCompare(b))) };
}

function anchorValue(anchor: AwgAnchor): string {
  return anchor.url ?? anchor.path ?? anchor.name ?? anchor.label ?? "";
}
