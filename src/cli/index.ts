#!/usr/bin/env node
import { parseArgs } from "./args.js";
import { addCommand } from "./commands/add.js";
import { buildCommand } from "./commands/build.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { lensCommand } from "./commands/lens.js";
import { openCommand } from "./commands/open.js";
import { validateCommand } from "./commands/validate.js";
import { viewCommand } from "./commands/view.js";

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const [command] = parsed.positionals;
  if (!command || command === "help" || parsed.flags.help) return help();
  if (command === "init") return initCommand(parsed);
  if (command === "add") return addCommand(parsed);
  if (command === "build") return buildCommand(parsed);
  if (command === "validate") return validateCommand(parsed);
  if (command === "doctor") return doctorCommand(parsed);
  if (command === "lens") return lensCommand(parsed);
  if (command === "view") return viewCommand(parsed);
  if (command === "open") return openCommand();
  throw new Error(`Unknown command: ${command}`);
}

function help(): void {
  console.log(`awg <command>

Commands:
  init [--empty] [--force]
  add node --type <type> --title <title> --summary <summary>
  add edge --from <id> --rel <rel> --to <id>
  add response --type <type> --target <id> --summary <summary>
  build [--json] [--strict]
  validate [--json] [--strict]
  doctor [--json]
  lens resume [--json]
  view current [--json] [--text]
  open`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
