#!/usr/bin/env node
import { parseArgs } from "./args.js";
import { addCommand } from "./commands/add.js";
import { buildCommand } from "./commands/build.js";
import { doctorCommand } from "./commands/doctor.js";
import { handoffCommand } from "./commands/handoff.js";
import { initCommand } from "./commands/init.js";
import { instructionsCommand } from "./commands/instructions.js";
import { lensCommand } from "./commands/lens.js";
import { openCommand } from "./commands/open.js";
import { recentCommand } from "./commands/recent.js";
import { registerCommand, unregisterCommand } from "./commands/register.js";
import { searchCommand } from "./commands/search.js";
import { setupCommand } from "./commands/setup.js";
import { updateCommand } from "./commands/update.js";
import { upgradeCommand } from "./commands/upgrade.js";
import { validateCommand } from "./commands/validate.js";
import { vaultCommand } from "./commands/vault.js";
import { viewCommand } from "./commands/view.js";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const [command] = parsed.positionals;
  if (!command || command === "help" || parsed.flags.help) return help();
  if (command === "setup") return setupCommand(parsed);
  if (command === "upgrade") return upgradeCommand(parsed);
  if (command === "init") return initCommand(parsed);
  if (command === "register") return registerCommand(parsed);
  if (command === "unregister") return unregisterCommand(parsed);
  if (command === "vault") return vaultCommand(parsed);
  if (command === "instructions") return instructionsCommand(parsed);
  if (command === "add") return addCommand(parsed);
  if (command === "update") return updateCommand(parsed);
  if (command === "search") return searchCommand(parsed);
  if (command === "build") return buildCommand(parsed);
  if (command === "validate") return validateCommand(parsed);
  if (command === "doctor") return doctorCommand(parsed);
  if (command === "lens") return lensCommand(parsed);
  if (command === "handoff") return handoffCommand(parsed);
  if (command === "recent") return recentCommand(parsed);
  if (command === "view") return viewCommand(parsed);
  if (command === "open") return openCommand(parsed);
  throw new Error(`Unknown command: ${command}`);
}

function help(): void {
  console.log(`awg <command>

Commands:
  setup [--yes] [--no-instructions] [--instructions <packs>] [--register-current|--no-register-current]
  upgrade [--all] [--dry-run] [--instructions <packs|all>] [--json]
  init [--empty] [--force] [--register] [--no-register]
  register [--name <name>] [--scope project|org|user]
  unregister [--path <path>]
  vault list [--missing] [--json]
  vault info [--json]
  vault prune [--dry-run] [--yes] [--json]
  instructions list
  instructions install <codex|claude-code|antigravity|all> [--dry-run]
  add node --type <type> --title <title> --summary <summary>
  add edge --from <id> --rel <rel> --to <id>
  add response --type <type> --target <id> --summary <summary>
  add evidence --target <id> --summary <summary>
  update node <id> [--title <title>] [--summary <summary>] [--status <status>] [--json]
  search <query> [--type <type>] [--status <status>] [--tag <tag>] [--limit <n>] [--json]
  build [--json] [--strict]
  validate [--json] [--strict]
  doctor [--json]
  lens resume [--budget <n>] [--json]
  lens task --goal <goal> [--budget <n>] [--json]
  handoff [--budget <n>] [--json]
  recent [--days <n>] [--json]
  view current [--json] [--text]
  open [--global] [--no-launch]`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
