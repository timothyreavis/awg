import path from "node:path";
import { currentVaultPath, readRegistry, vaultHealth } from "../../global/registry.js";
import type { ParsedArgs } from "../args.js";

export async function vaultCommand(parsed: ParsedArgs): Promise<void> {
  const [, subcommand] = parsed.positionals;
  if (subcommand === "list") return listVaults(parsed);
  if (subcommand === "info") return infoVault(parsed);
  throw new Error("Usage: awg vault list [--json] | awg vault info [--json]");
}

async function listVaults(parsed: ParsedArgs): Promise<void> {
  const registry = await readRegistry();
  const rows = [];
  for (const vault of registry.vaults) rows.push({ ...vault, health: await vaultHealth(vault.path) });
  if (parsed.flags.json) {
    console.log(JSON.stringify({ version: registry.version, vaults: rows }, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log("No registered AWG vaults. Run awg register inside a project.");
    return;
  }
  for (const vault of rows) {
    const health = vault.health.exists ? (vault.health.built ? `built warnings=${vault.health.warnings} fatal=${vault.health.fatalErrors}` : "not built") : "missing";
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
  if (parsed.flags.json) console.log(JSON.stringify(info, null, 2));
  else console.log(`${entry.name}\nscope: ${entry.scope}\npath: ${entry.path}\nregistered: ${entry.registeredAt}\nlast seen: ${entry.lastSeenAt}`);
}
