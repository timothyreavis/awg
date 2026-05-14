import path from "node:path";
import { buildAwg } from "../../core/compiler.js";
import { buildTopologyIndex } from "../../core/topology.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { currentVaultPath, linkVaults, pruneMissingVaults, readRegistry, unlinkVaultRelationship, vaultHealth, vaultRegistryState } from "../../global/registry.js";
import type { ParsedArgs } from "../args.js";
import { num, str } from "../args.js";
import { printJson } from "../format.js";

export async function vaultCommand(parsed: ParsedArgs): Promise<void> {
  const [, subcommand] = parsed.positionals;
  if (subcommand === "list") return listVaults(parsed);
  if (subcommand === "info") return infoVault(parsed);
  if (subcommand === "prune") return pruneVaults(parsed);
  if (subcommand === "link") return linkVault(parsed);
  if (subcommand === "unlink") return unlinkVault(parsed);
  if (subcommand === "topology") return topologyVault(parsed);
  throw new Error("Usage: awg vault list [--missing] [--json] | awg vault info [--json] | awg vault prune [--dry-run] [--yes] [--json] | awg vault link --to <vault> --rel <rel> [--from <vault|current>] [--json] | awg vault unlink --relationship <id> [--json] | awg vault topology [--json]");
}

async function listVaults(parsed: ParsedArgs): Promise<void> {
  const registry = await readRegistry();
  const rows = [];
  for (const vault of registry.vaults) rows.push({ ...vault, health: await vaultHealth(vault.path), state: await vaultRegistryState(vault.path) });
  const filtered = parsed.flags.missing ? rows.filter((row) => row.state.status !== "ok") : rows;
  if (parsed.flags.json) {
    printJson({ version: registry.version, vaults: filtered, relationships: registry.relationships.map(redactPrivateRelationship) });
    return;
  }
  if (filtered.length === 0) {
    console.log("No registered AWG vaults. Run awg register inside a project.");
    return;
  }
  for (const vault of filtered) {
    const health = vault.state.status !== "ok" ? `${vault.state.status}: ${vault.state.reason}` : (vault.health.built ? `built warnings=${vault.health.warnings} fatal=${vault.health.fatalErrors}` : "not built");
    console.log(`${vault.name}\t${vault.scope}\t${health}\t${vault.path}`);
  }
}

async function infoVault(parsed: ParsedArgs): Promise<void> {
  const vaultPath = await currentVaultPath();
  if (!vaultPath) {
    console.log("No current AWG vault found. Run this inside a project with .awg.");
    return;
  }
  const registry = await readRegistry();
  const entry = registry.vaults.find((vault) => path.resolve(vault.path) === vaultPath);
  if (!entry) {
    console.log(`Current vault is not registered: ${vaultPath}`);
    return;
  }
  const info = { ...entry, health: await vaultHealth(entry.path) };
  if (parsed.flags.json) printJson(info);
  else console.log(`${entry.name}\nscope: ${entry.scope}\npath: ${entry.path}\nregistered: ${entry.registeredAt}\nlast seen: ${entry.lastSeenAt}`);
}

async function pruneVaults(parsed: ParsedArgs): Promise<void> {
  const dryRun = Boolean(parsed.flags["dry-run"]) || !parsed.flags.yes;
  const result = await pruneMissingVaults({ dryRun, yes: Boolean(parsed.flags.yes) });
  if (parsed.flags.json) return printJson({ ok: true, dryRun, ...result });
  if (dryRun) {
    if (result.missing.length === 0) console.log("No missing registered vaults.");
    else {
      console.log("Missing registered vaults:");
      for (const vault of result.missing) console.log(`- ${vault.name}\t${vault.path}`);
      console.log("Run awg vault prune --yes to remove them from the registry.");
    }
    return;
  }
  console.log(`Pruned ${result.pruned.length} missing registered vault(s).`);
}

async function linkVault(parsed: ParsedArgs): Promise<void> {
  try {
    const registry = await readRegistry();
    const from = await resolveVaultSelector(str(parsed.flags, "from", "current") ?? "current", registry);
    const toSelector = str(parsed.flags, "to");
    const rel = str(parsed.flags, "rel");
    if (!toSelector || !rel) throw Object.assign(new Error("Missing required --to or --rel."), { code: "AWG_VAULT_LINK_USAGE" });
    const to = await resolveVaultSelector(toSelector, registry);
    const result = await linkVaults({ fromVaultId: from.id, rel, toVaultId: to.id, summary: str(parsed.flags, "summary"), confidence: parsed.flags.confidence ? num(parsed.flags, "confidence", 1) : undefined, visibility: str(parsed.flags, "visibility") });
    const updatedRegistry = await readRegistry();
    const normalizedFrom = updatedRegistry.vaults.find((vault) => vault.id === result.relationship.fromVaultId) ?? from;
    const normalizedTo = updatedRegistry.vaults.find((vault) => vault.id === result.relationship.toVaultId) ?? to;
    const output = { ok: true, created: result.created, relationship: result.relationship, fromVault: briefVault(normalizedFrom), toVault: briefVault(normalizedTo), warnings: [] };
    if (parsed.flags.json) return printJson(output);
    console.log(`${result.created ? "Created" : "Updated"} ${result.relationship.id}: ${normalizedFrom.name} ${result.relationship.rel} ${normalizedTo.name}`);
  } catch (error) {
    return stableError(parsed, codeForError(error), error instanceof Error ? error.message : String(error), error && typeof error === "object" && "candidates" in error ? { candidates: (error as { candidates: unknown }).candidates } : {});
  }
}

async function unlinkVault(parsed: ParsedArgs): Promise<void> {
  const id = str(parsed.flags, "relationship");
  if (!id) return stableError(parsed, "AWG_VAULT_UNLINK_USAGE", "Missing required --relationship.");
  const { relationship } = await unlinkVaultRelationship(id);
  if (!relationship) return stableError(parsed, "AWG_VAULT_RELATIONSHIP_NOT_FOUND", "Vault relationship was not found.", { relationship: id });
  if (parsed.flags.json) return printJson({ ok: true, relationship });
  console.log(`Archived ${relationship.id}`);
}

async function topologyVault(parsed: ParsedArgs): Promise<void> {
  const depth = num(parsed.flags, "depth", 1);
  if (depth !== 1) return stableError(parsed, "AWG_VAULT_DEPTH_UNSUPPORTED", "V1.8 topology supports depth 1 only.");
  try {
    const storage = new FileAwgStorage();
    const { graph } = await buildAwg(storage, { write: false });
    const topology = await buildTopologyIndex(graph, storage.root);
    const output = { ok: true, generatedAt: topology.generatedAt, depth, currentVault: topology.currentVault, relatedVaults: topology.directNeighbors, relationships: topology.relationships, diagnostics: topology.diagnostics };
    if (parsed.flags.json) return printJson(output);
    if (!topology.currentVault) return console.log("No current registered AWG vault.");
    console.log(`${topology.currentVault.name} (${topology.currentVault.id})`);
    for (const neighbor of topology.directNeighbors) console.log(`- ${neighbor.name}\t${neighbor.whySurfaced.join(", ")}\t${neighbor.stale ? "stale/missing" : "ok"}`);
  } catch (error) {
    return stableError(parsed, codeForError(error), error instanceof Error ? error.message : String(error));
  }
}

async function resolveVaultSelector(selector: string, registry: Awaited<ReturnType<typeof readRegistry>>): Promise<Awaited<ReturnType<typeof readRegistry>>["vaults"][number]> {
  if (selector === "current") {
    const vaultPath = await currentVaultPath();
    if (!vaultPath) throw Object.assign(new Error("Current AWG vault was not found."), { code: "AWG_VAULT_CURRENT_NOT_FOUND" });
    const current = registry.vaults.find((vault) => path.resolve(vault.path) === vaultPath);
    if (!current) throw Object.assign(new Error("Current AWG vault is not registered."), { code: "AWG_VAULT_CURRENT_NOT_FOUND" });
    return current;
  }
  const pathSelector = path.resolve(selector);
  const idMatches = registry.vaults.filter((vault) => vault.id === selector);
  if (idMatches.length === 1) return idMatches[0];
  if (idMatches.length > 1) throw Object.assign(new Error("Vault selector matches multiple registered vaults."), { code: "AWG_VAULT_SELECTOR_AMBIGUOUS", candidates: idMatches.map(briefVault) });
  const pathMatches = registry.vaults.filter((vault) => path.resolve(vault.path) === pathSelector || path.resolve(path.dirname(vault.path)) === pathSelector);
  if (pathMatches.length === 1) return pathMatches[0];
  if (pathMatches.length > 1) throw Object.assign(new Error("Vault selector matches multiple registered vaults."), { code: "AWG_VAULT_SELECTOR_AMBIGUOUS", candidates: pathMatches.map(briefVault) });
  const matches = registry.vaults.filter((vault) => vault.name === selector);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw Object.assign(new Error("Vault selector matches multiple registered vaults."), { code: "AWG_VAULT_SELECTOR_AMBIGUOUS", candidates: matches.map(briefVault) });
  throw Object.assign(new Error("Vault selector was not found."), { code: "AWG_VAULT_SELECTOR_NOT_FOUND", selector });
}

function briefVault(vault: { id: string; name: string; path: string }): { id: string; name: string; path: string } {
  return { id: vault.id, name: vault.name, path: vault.path };
}

function redactPrivateRelationship<T extends { visibility?: unknown; summary?: unknown }>(relationship: T): T {
  return relationship.visibility === "private" ? { ...relationship, summary: undefined } : relationship;
}

function stableError(parsed: ParsedArgs, code: string, message: string, extra: Record<string, unknown> = {}): void {
  if (parsed.flags.json) {
    printJson({ ok: false, code, message, ...extra });
    process.exitCode = 1;
    return;
  }
  throw Object.assign(new Error(message), { code });
}

function codeForError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  if (code) return code;
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Unknown relationship")) return "AWG_VAULT_RELATIONSHIP_INVALID";
  if (message.includes("cannot link a vault to itself")) return "AWG_VAULT_RELATIONSHIP_SELF_LINK";
  if (message.includes("Visibility must be")) return "AWG_VAULT_VISIBILITY_INVALID";
  if (message.includes("No AWG project vault found")) return "AWG_VAULT_CURRENT_NOT_FOUND";
  return "AWG_VAULT_ERROR";
}
