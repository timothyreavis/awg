#!/usr/bin/env node
import { parseArgs } from "./args.js";
import { addCommand } from "./commands/add.js";
import { buildCommand } from "./commands/build.js";
import { doctorCommand } from "./commands/doctor.js";
import { handoffCommand } from "./commands/handoff.js";
import { initCommand } from "./commands/init.js";
import { inboxCommand } from "./commands/inbox.js";
import { instructionsCommand } from "./commands/instructions.js";
import { lensCommand } from "./commands/lens.js";
import { nodeCommand } from "./commands/node.js";
import { openCommand } from "./commands/open.js";
import { recentCommand } from "./commands/recent.js";
import { reconcileCommand } from "./commands/reconcile.js";
import { registerCommand, unregisterCommand } from "./commands/register.js";
import { searchCommand } from "./commands/search.js";
import { runCommand } from "./commands/run.js";
import { setupCommand } from "./commands/setup.js";
import { templateCommand } from "./commands/template.js";
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
  if (command === "template") return templateCommand(parsed);
  if (command === "upgrade") return upgradeCommand(parsed);
  if (command === "init") return initCommand(parsed);
  if (command === "inbox") return inboxCommand(parsed);
  if (command === "register") return registerCommand(parsed);
  if (command === "unregister") return unregisterCommand(parsed);
  if (command === "vault") return vaultCommand(parsed);
  if (command === "instructions") return instructionsCommand(parsed);
  if (command === "add") return addCommand(parsed);
  if (command === "update") return updateCommand(parsed);
  if (command === "search") return searchCommand(parsed);
  if (command === "run") return runCommand(parsed);
  if (command === "build") return buildCommand(parsed);
  if (command === "validate") return validateCommand(parsed);
  if (command === "doctor") return doctorCommand(parsed);
  if (command === "lens") return lensCommand(parsed);
  if (command === "node") return nodeCommand(parsed);
  if (command === "handoff") return handoffCommand(parsed);
  if (command === "recent") return recentCommand(parsed);
  if (command === "reconcile") return reconcileCommand(parsed);
  if (command === "view") return viewCommand(parsed);
  if (command === "open") return openCommand(parsed);
  throw new Error(`Unknown command: ${command}`);
}

function help(): void {
  console.log(`awg <command>

Commands:
  setup [--yes] [--no-instructions] [--instructions <packs>] [--register-current|--no-register-current]
  template status [--goal <goal>] [--json]
  upgrade [--all] [--dry-run] [--force] [--instructions <packs|all>] [--json]
  init [--empty] [--demo] [--force] [--register] [--no-register]
  inbox [--kind <kind>] [--limit <n>] [--json]
  inbox show <item-id> [--json]
  register [--name <name>] [--scope project|org|user]
  unregister [--path <path>]
  vault list [--missing] [--json]
  vault info [--json]
  vault prune [--dry-run] [--yes] [--json]
  vault link --to <vault> --rel <rel> [--from <vault|current>] [--summary <text>] [--confidence <0..1>] [--visibility summary|private|full] [--json]
  vault unlink --relationship <relationship-id> [--json]
  vault topology [--depth <n>] [--json]
  instructions list
  instructions install <codex|claude-code|antigravity|all> [--dry-run] [--force]
  add node --type <type> --title <title> --summary <summary> [--status <status>] [--importance <n>] [--confidence <n>] [--tag <tag>] [--evidence-required] [--body <text>] [--field <key=value>] [--field-json <json>] [--fields-json <json>] [--block-json <json>] [--blocks-json <json>] [--freshness-json <json>] [--anchor <kind:value>] [--run <run-id>|--no-run] [--json]
  add edge --from <id> --rel <rel> --to <id> [--run <run-id>|--no-run]
  add response --type <type> --target <id> --summary <summary> [--run <run-id>|--no-run]
  add evidence --target <id> --summary <summary> [--run <run-id>|--no-run]
  update node <id> [--title <title>] [--summary <summary>] [--status <status>] [--type <type>] [--importance <n>] [--confidence <n>] [--tag <tag>] [--body <text>] [--field <key=value>] [--field-json <json>] [--fields-json <json>] [--unset-field <key>] [--block-json <json>] [--blocks-json <json>] [--clear-blocks] [--freshness-json <json>] [--review-after <date>] [--anchor <kind:value>] [--anchors-json <json>] [--unset-anchor <kind:value>] [--run <run-id>|--no-run] [--json]
  search <query> [--type <type>] [--status <status>] [--tag <tag>] [--limit <n>] [--json]
  run start --goal <goal> [--agent <name>] [--force] [--json]
  run note <note> [--run <run-id>] [--json]
  run finish --status <completed|partial|blocked|failed|abandoned> [--run <run-id>] [--summary <summary>] [--auto-handoff] [--force] [--json]
  run status [--json]
  run list [--json]
  build [--json] [--strict]
  validate [--json] [--strict]
  doctor [--fix-suggestions] [--json]
  lens resume [--budget <n>] [--json]
  lens task --goal <goal> [--budget <n>] [--json]
  node show <node-id> [--json]
  handoff [--budget <n>] [--json] [--no-record]
  recent [--days <n>] [--json]
  reconcile duplicate <a> <b> --canonical <id> [--reason <text>] [--json]
  reconcile supersede <old> <new> [--reason <text>] [--json]
  reconcile contradict <a> <b> [--reason <text>] [--json]
  reconcile resolved-by <target> <resolver> [--reason <text>] [--json]
  reconcile intentionally-open <target> [--reason <text>] [--json]
  view current [--json] [--text]
  open [--global] [--no-launch]`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
