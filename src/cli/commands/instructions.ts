import { promises as fs } from "node:fs";
import path from "node:path";
import { currentVaultPath } from "../../global/registry.js";
import type { ParsedArgs } from "../args.js";

const BEGIN = "<!-- BEGIN AWG MANAGED INSTRUCTIONS -->";
const END = "<!-- END AWG MANAGED INSTRUCTIONS -->";
const PACKS = ["codex", "claude-code", "antigravity"] as const;
type Pack = typeof PACKS[number];

export async function instructionsCommand(parsed: ParsedArgs): Promise<void> {
  const [, subcommand, pack] = parsed.positionals;
  if (subcommand === "list") {
    console.log(PACKS.join("\n"));
    return;
  }
  if (subcommand !== "install" || !pack) throw new Error("Usage: awg instructions list | awg instructions install <codex|claude-code|antigravity|all> [--dry-run]");
  const packs = pack === "all" ? [...PACKS] : [parsePack(pack)];
  for (const item of packs) await installInstructions(item, { dryRun: Boolean(parsed.flags["dry-run"]) });
}

export async function installInstructions(pack: string, options: { dryRun: boolean }): Promise<void> {
  const parsed = parsePack(pack);
  if (parsed === "codex") return installCodex(options);
  if (parsed === "claude-code") return installClaudeCode(options);
  return installSnippet("antigravity", "antigravity.md", antigravityTemplate(), options);
}

async function installCodex(options: { dryRun: boolean }): Promise<void> {
  const root = await instructionRoot();
  const file = path.join(root, "AGENTS.md");
  await patchManagedBlock(file, codexTemplate(), options);
}

async function installClaudeCode(options: { dryRun: boolean }): Promise<void> {
  const root = await instructionRoot();
  const nativeFile = path.join(root, "CLAUDE.md");
  if (await fileExists(nativeFile)) return patchManagedBlock(nativeFile, claudeCodeTemplate(), options);
  return installSnippet("claude-code", "claude-code.md", claudeCodeTemplate(), options, root);
}

async function installSnippet(name: string, fileName: string, body: string, options: { dryRun: boolean }, root?: string): Promise<void> {
  const projectRoot = root ?? await instructionRoot();
  const file = path.join(projectRoot, ".awg", "instructions", fileName);
  if (!options.dryRun) await fs.mkdir(path.dirname(file), { recursive: true });
  await patchManagedBlock(file, body, options);
  if (!options.dryRun) console.log(`Installed ${name} instructions at ${file}`);
}

async function patchManagedBlock(file: string, block: string, options: { dryRun: boolean }): Promise<void> {
  const exists = await fileExists(file);
  const prior = exists ? await fs.readFile(file, "utf8") : "";
  const managed = `${BEGIN}\n${block.trim()}\n${END}`;
  const next = prior.includes(BEGIN) && prior.includes(END)
    ? prior.replace(new RegExp(`${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}`), managed)
    : `${prior.trimEnd()}${prior.trim() ? "\n\n" : ""}${managed}\n`;
  if (options.dryRun) {
    console.log(`${exists ? "Would update" : "Would create"} ${file}`);
    return;
  }
  await fs.writeFile(file, next);
  console.log(`${exists ? "Updated" : "Created"} ${file}`);
}

async function instructionRoot(): Promise<string> {
  const vaultPath = await currentVaultPath();
  return vaultPath ? path.dirname(vaultPath) : process.cwd();
}

function parsePack(value: string): Pack {
  if (PACKS.includes(value as Pack)) return value as Pack;
  throw new Error(`Unknown instruction pack: ${value}`);
}

function codexTemplate(): string {
  return `# AWG Agent Loop

- Start by running \`awg lens resume\`.
- If the lens is missing or stale, run \`awg build\`, then rerun \`awg lens resume\`.
- Add durable knowledge as AWG nodes, edges, responses, or events.
- Prefer \`awg add node\`, \`awg add edge\`, and \`awg add response\` over manual JSONL edits.
- Keep stale blockers, risks, decisions, partial work, and evidence current.
- Before finishing, run \`awg build\` and \`awg doctor\`.
- Fix validation errors before stopping.
- Ensure \`awg lens resume\` reflects the current project state.`;
}

function claudeCodeTemplate(): string {
  return `# AWG Claude Code Snippet

This project uses AWG as local durable project memory. Start with \`awg lens resume\`, record durable facts/decisions/risks/tasks with AWG commands, then run \`awg build\` and \`awg doctor\` before finishing.
`;
}

function antigravityTemplate(): string {
  return `# AWG Antigravity Snippet

Use the project-local .awg vault only. Start with \`awg lens resume\`, add durable knowledge through AWG commands, run \`awg build\` and \`awg doctor\`, and fix validation errors before finishing.
`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fileExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}
