import path from "node:path";
import { currentVaultPath, pruneMissingVaults, readRegistry, vaultHealth, vaultRegistryState } from "../../global/registry.js";
import type { ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function vaultCommand(parsed: ParsedArgs): Promise<void> {
  const [, subcommand] = parsed.positionals;
  if (subcommand === "list") return listVaults(parsed);
  if (subcommand === "info") return infoVault(parsed);
  if (subcommand === "prune") return pruneVaults(parsed);
  throw new Error("Usage: awg vault list [--missing] [--json] | awg vault info [--json] | awg vault prune [--dry-run] [--yes] [--json]");
}

async function listVaults(parsed: ParsedArgs): Promise<void> {
  const registry = await readRegistry();
  const rows = [];
  for (const vault of registry.vaults) rows.push({ ...vault, health: await vaultHealth(vault.path), state: await vaultRegistryState(vault.path) });
  const filtered = parsed.flags.missing ? rows.filter((row) => row.state.status !== "ok") : rows;
  if (parsed.flags.json) {
    printJson({ version: registry.version, vaults: filtered });
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
