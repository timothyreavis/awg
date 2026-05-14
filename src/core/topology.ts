import { lstatSync, readFileSync } from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import { readRegistry, vaultHealth, vaultRegistryState, type Registry, type VaultEntry, type VaultRelationship } from "../global/registry.js";
import type { AwgNode, CompiledGraph, Diagnostic } from "./types.js";

export interface TopologyIndex {
  schemaVersion: 1;
  generatedAt: string;
  currentVault: TopologyVault | null;
  relationships: TopologyRelationship[];
  directNeighbors: TopologyNeighbor[];
  crossVaultRefs: CrossVaultRefEntry[];
  diagnostics: Diagnostic[];
}

export interface TopologyVault {
  id: string;
  vaultId: string;
  name: string;
  path: string;
  scope: string;
  health?: Awaited<ReturnType<typeof vaultHealth>>;
}

export interface TopologyRelationship extends VaultRelationship {
  direction: "outgoing" | "incoming" | "symmetric";
  health: { fromRegistered: boolean; toRegistered: boolean; archived: boolean };
}

export interface TopologyNeighbor extends TopologyVault {
  relationships: string[];
  relationshipSummaries: string[];
  tags: string[];
  whySurfaced: string[];
  stale: boolean;
  summary: { source: string; text: string };
  health: Awaited<ReturnType<typeof vaultHealth>>;
}

export interface CrossVaultRefEntry {
  nodeId: string;
  vaultId?: string;
  targetNodeId?: string;
  rel?: string;
  reason?: string;
  status?: string;
  valid: boolean;
}

export async function buildTopologyIndex(graph: CompiledGraph, root: string): Promise<TopologyIndex> {
  const registry = await readRegistry();
  const currentVault = currentVaultForRegistry(registry, root);
  const diagnostics: Diagnostic[] = [];
  const crossVaultRefs = collectCrossVaultRefs(graph.nodes, registry, diagnostics);
  if (!currentVault) {
    return { schemaVersion: 1, generatedAt: graph.generated_at, currentVault: null, relationships: [], directNeighbors: [], crossVaultRefs, diagnostics };
  }
  const current = toTopologyVault(currentVault, await vaultHealth(currentVault.path));
  const activeRelationships = (registry.relationships ?? []).filter((relationship) => !relationship.archivedAt && (relationship.fromVaultId === current.id || relationship.toVaultId === current.id));
  const relationships: TopologyRelationship[] = [];
  const neighbors = new Map<string, TopologyNeighbor>();
  for (const relationship of activeRelationships) {
    const fromRegistered = Boolean(registry.vaults.find((vault) => vault.id === relationship.fromVaultId));
    const toRegistered = Boolean(registry.vaults.find((vault) => vault.id === relationship.toVaultId));
    const direction = relationship.rel === "sibling_of" || relationship.rel === "related_to" ? "symmetric" : relationship.fromVaultId === current.id ? "outgoing" : "incoming";
    relationships.push({ ...relationship, ...(relationship.visibility === "private" ? { summary: undefined } : {}), direction, health: { fromRegistered, toRegistered, archived: false } });
    const neighborId = relationship.fromVaultId === current.id ? relationship.toVaultId : relationship.fromVaultId;
    const neighborEntry = registry.vaults.find((vault) => vault.id === neighborId);
    if (!neighborEntry) {
      diagnostics.push({ severity: "warning", code: "topology_missing_related_vault", message: `Relationship ${relationship.id} references an unregistered vault: ${neighborId}`, id: relationship.id, fixSuggestion: { vaultId: neighborId } });
      continue;
    }
    const existing = neighbors.get(neighborId);
    const health = await vaultHealth(neighborEntry.path);
    const state = await vaultRegistryState(neighborEntry.path);
    const summary = relationship.visibility === "private" ? { source: "private_relationship", text: "Private relationship. Related-vault summary is hidden." } : readNeighborSummary(neighborEntry, diagnostics, relationship.id);
    const why = `direct_registry_relationship:${relationship.rel}`;
    if (state.status !== "ok") diagnostics.push({ severity: "warning", code: "topology_related_vault_missing_or_invalid", message: `Related vault ${neighborEntry.id} is ${state.status}: ${state.reason}`, id: relationship.id, fixSuggestion: { vaultId: neighborEntry.id, path: neighborEntry.path } });
    if (!health.built) diagnostics.push({ severity: "warning", code: "topology_related_vault_not_built", message: `Related vault ${neighborEntry.id} has no usable compiled output.`, id: relationship.id, fixSuggestion: { vaultId: neighborEntry.id, path: neighborEntry.path } });
    if (existing) {
      existing.relationships.push(relationship.id);
      if (relationship.visibility !== "private" && relationship.summary) existing.relationshipSummaries.push(relationship.summary);
      existing.whySurfaced.push(why);
    } else {
      neighbors.set(neighborId, { ...toTopologyVault(neighborEntry, health), relationships: [relationship.id], relationshipSummaries: relationship.visibility !== "private" && relationship.summary ? [relationship.summary] : [], tags: Array.isArray(neighborEntry.tags) ? neighborEntry.tags : [], whySurfaced: [why], health, stale: !health.built || state.status !== "ok", summary });
    }
  }
  return {
    schemaVersion: 1,
    generatedAt: graph.generated_at,
    currentVault: current,
    relationships: relationships.sort((a, b) => a.id.localeCompare(b.id)),
    directNeighbors: [...neighbors.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
    crossVaultRefs,
    diagnostics: diagnostics.sort((a, b) => (a.id ?? "").localeCompare(b.id ?? "") || a.code.localeCompare(b.code))
  };
}

export function topologyRelevant(topology: TopologyIndex | undefined, goal?: string, relevantNodeIds: string[] = []): TopologyNeighbor[] {
  if (!topology) return [];
  const needle = (goal ?? "").toLowerCase();
  const relevant = new Set(relevantNodeIds);
  const relevantRefs = topology.crossVaultRefs.filter((ref) => relevant.has(ref.nodeId));
  return topology.directNeighbors.filter((neighbor) => {
    if (["depends_on", "provides_contract_for", "deploys_to", "owns"].some((rel) => neighbor.whySurfaced.some((why) => why.includes(rel)))) return true;
    if (needle && [neighbor.name, neighbor.id, neighbor.path, neighbor.summary.text, ...neighbor.tags, ...neighbor.relationshipSummaries, ...neighbor.whySurfaced].some((value) => value.toLowerCase().includes(needle))) return true;
    return relevantRefs.some((ref) => ref.vaultId === neighbor.id);
  });
}

export function collectCrossVaultRefs(nodes: AwgNode[], registry: Registry, diagnostics: Diagnostic[] = []): CrossVaultRefEntry[] {
  const vaultIds = new Set(registry.vaults.map((vault) => vault.id));
  const validRels = new Set(["references", "affects", "requires_update", "implements", "blocked_by"]);
  const out: CrossVaultRefEntry[] = [];
  for (const node of nodes) {
    const refs = node.fields?.crossVaultRefs;
    if (refs === undefined) continue;
    if (!Array.isArray(refs)) {
      diagnostics.push({ severity: "warning", code: "invalid_cross_vault_refs", message: `Node ${node.id} fields.crossVaultRefs must be an array.`, id: node.id });
      continue;
    }
    for (const ref of refs) {
      const record = ref && typeof ref === "object" && !Array.isArray(ref) ? ref as Record<string, unknown> : {};
      const vaultId = typeof record.vaultId === "string" ? record.vaultId : undefined;
      const rel = typeof record.rel === "string" ? record.rel : undefined;
      const status = typeof record.status === "string" ? record.status : undefined;
      const valid = Boolean(vaultId && vaultIds.has(vaultId) && (!rel || validRels.has(rel)));
      if (!valid) diagnostics.push({ severity: "warning", code: "invalid_cross_vault_refs", message: `Node ${node.id} has an invalid cross-vault reference.`, id: node.id, fixSuggestion: { vaultId, rel } });
      out.push({ nodeId: node.id, vaultId, targetNodeId: typeof record.nodeId === "string" ? record.nodeId : undefined, rel, reason: typeof record.reason === "string" ? record.reason : undefined, status, valid });
    }
  }
  return out.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || (a.vaultId ?? "").localeCompare(b.vaultId ?? ""));
}

export function readCompiledTopology(root: string): TopologyIndex | undefined {
  const parsed = readSafeJson(path.join(root, ".awg"), "compiled/indexes/topology.json");
  return parsed.kind === "ok" ? parsed.value as TopologyIndex : undefined;
}

function currentVaultForRegistry(registry: Registry, root: string): VaultEntry | null {
  const configId = readConfigVaultId(root);
  if (configId) return registry.vaults.find((vault) => vault.id === configId) ?? null;
  const vaultPath = path.resolve(root, ".awg");
  return registry.vaults.find((vault) => path.resolve(vault.path) === vaultPath) ?? null;
}

function readConfigVaultId(root: string): string | null {
  try {
    const config = JSON.parse(readFileSync(path.join(root, ".awg", "config.json"), "utf8")) as { vault?: { id?: unknown } };
    return typeof config.vault?.id === "string" ? config.vault.id : null;
  } catch {
    return null;
  }
}

function toTopologyVault(vault: VaultEntry, health?: Awaited<ReturnType<typeof vaultHealth>>): TopologyVault {
  return { id: vault.id, vaultId: vault.id, name: vault.name, path: vault.path, scope: vault.scope, ...(health ? { health } : {}) };
}

function readNeighborSummary(vault: VaultEntry, diagnostics: Diagnostic[], relationshipId: string): { source: string; text: string } {
  const resume = readSafeJson(vault.path, "compiled/lenses/resume.json");
  if (resume.kind === "ok") {
    const parsed = resume.value as { summary?: unknown };
    if (typeof parsed.summary === "string") return { source: "compiled_resume", text: parsed.summary };
  } else if (resume.kind !== "missing") {
    diagnostics.push(neighborArtifactDiagnostic(vault, relationshipId, "compiled/lenses/resume.json", resume));
  }
  const current = readSafeJson(vault.path, "compiled/views/current.json");
  if (current.kind === "ok") {
    const parsed = current.value as { title?: unknown; summary?: unknown };
    const text = [parsed.title, parsed.summary].filter((value) => typeof value === "string").join(" ");
    if (text) return { source: "compiled_current_view", text };
  } else if (current.kind !== "missing") {
    diagnostics.push(neighborArtifactDiagnostic(vault, relationshipId, "compiled/views/current.json", current));
  }
  return { source: "registry", text: `${vault.name} (${vault.scope})` };
}

type SafeJsonResult =
  | { kind: "ok"; value: unknown }
  | { kind: "missing" }
  | { kind: "unsafe"; message: string }
  | { kind: "invalid"; message: string };

function readSafeJson(root: string, relativePath: string): SafeJsonResult {
  const file = path.resolve(root, relativePath);
  try {
    const stat = assertSafeLocalPath(root, file, "file");
    if (!stat) return { kind: "missing" };
    return { kind: "ok", value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { kind: "missing" };
    if (error instanceof Error && error.message.startsWith("Refusing to access")) return { kind: "unsafe", message: error.message };
    return { kind: "invalid", message: error instanceof Error ? error.message : String(error) };
  }
}

function assertSafeLocalPath(root: string, target: string, kind: "file" | "directory"): Stats | null {
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(target);
  const relative = path.relative(rootAbs, targetAbs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing to access path outside AWG vault: ${target}`);
  let current = rootAbs;
  let stat: Stats | null = lstatSync(rootAbs);
  if (stat.isSymbolicLink()) throw new Error(`Refusing to access symlink: ${rootAbs}`);
  if (!stat.isDirectory()) throw new Error(`Refusing to access non-directory path: ${rootAbs}`);
  const parts = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const isFinal = index === parts.length - 1;
    current = path.join(current, part);
    try {
      stat = lstatSync(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Refusing to access symlink: ${current}`);
    if (!isFinal && !stat.isDirectory()) throw new Error(`Refusing to access path through non-directory: ${current}`);
    if (isFinal && kind === "file" && !stat.isFile()) throw new Error(`Refusing to access non-file path: ${target}`);
    if (isFinal && kind === "directory" && !stat.isDirectory()) throw new Error(`Refusing to access non-directory path: ${target}`);
  }
  return stat;
}

function neighborArtifactDiagnostic(vault: VaultEntry, relationshipId: string, artifact: string, result: Exclude<SafeJsonResult, { kind: "ok" | "missing" }>): Diagnostic {
  const unsafe = result.kind === "unsafe";
  return {
    severity: "warning",
    code: unsafe ? "topology_related_vault_compiled_artifact_unsafe" : "topology_related_vault_compiled_artifact_invalid",
    message: `Related vault ${vault.id} has an unusable compiled artifact ${artifact}: ${result.message}`,
    id: relationshipId,
    fixSuggestion: { vaultId: vault.id, path: vault.path, artifact }
  };
}
