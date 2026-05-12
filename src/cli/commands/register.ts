import { currentVaultPath, registerVault, unregisterVault } from "../../global/registry.js";
import { str } from "../args.js";
import type { ParsedArgs } from "../args.js";

export async function registerCommand(parsed: ParsedArgs): Promise<void> {
  const vaultPath = await currentVaultPath();
  if (!vaultPath) throw new Error("No project .awg vault found nearby. Run awg init first.");
  const result = await registerVault({ vaultPath, name: str(parsed.flags, "name"), scope: str(parsed.flags, "scope") });
  console.log(`${result.created ? "Registered" : "Updated"} ${result.entry.name} (${result.entry.path})`);
}

export async function unregisterCommand(parsed: ParsedArgs): Promise<void> {
  const explicitPath = str(parsed.flags, "path");
  const vaultPath = explicitPath ?? await currentVaultPath();
  if (!vaultPath) throw new Error("No project .awg vault found nearby. Use --path or run this inside a project.");
  const removed = await unregisterVault({ vaultPath });
  if (!removed) {
    console.log(`${explicitPath ? "Requested" : "Current"} vault was not registered.`);
    return;
  }
  console.log(`Unregistered ${removed.name} (${removed.path})`);
}
