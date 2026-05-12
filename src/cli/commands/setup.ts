import { ensureGlobalAwg, registerVault, currentVaultPath } from "../../global/registry.js";
import { installInstructions } from "./instructions.js";
import { str } from "../args.js";
import type { ParsedArgs } from "../args.js";

export async function setupCommand(parsed: ParsedArgs): Promise<void> {
  await ensureGlobalAwg();
  console.log("Created or verified ~/.awg global registry.");

  const shouldRegister = !parsed.flags["no-register-current"];
  if (shouldRegister) {
    const vaultPath = await currentVaultPath();
    if (vaultPath) {
      const result = await registerVault({ vaultPath });
      console.log(`${result.created ? "Registered" : "Updated"} current vault: ${result.entry.name}`);
    } else if (parsed.flags["register-current"]) {
      throw new Error("No project .awg vault found nearby. Run awg init first.");
    }
  }

  if (!parsed.flags["no-instructions"]) {
    const packs = parseInstructions(str(parsed.flags, "instructions"));
    for (const pack of packs) await installInstructions(pack, { dryRun: false });
    if (packs.length > 0) console.log(`Installed instruction packs: ${packs.join(", ")}`);
  }
}

function parseInstructions(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
