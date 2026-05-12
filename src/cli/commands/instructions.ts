import { promises as fs } from "node:fs";
import path from "node:path";
import { currentVaultPath } from "../../global/registry.js";
import type { ParsedArgs } from "../args.js";

const BEGIN = "<!-- BEGIN AWG MANAGED INSTRUCTIONS -->";
const END = "<!-- END AWG MANAGED INSTRUCTIONS -->";
const PACKS = ["codex", "claude-code", "antigravity"] as const;
type Pack = typeof PACKS[number];
export type InstructionPatchResult = { changed: boolean; file: string; action: "created" | "updated" | "unchanged" | "would-create" | "would-update" };

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
  await installSnippet("antigravity", "antigravity.md", antigravityTemplate(), options);
}

export async function installInstructionsAt(root: string, pack: string, options: { dryRun: boolean; quiet?: boolean }): Promise<InstructionPatchResult> {
  const parsed = parsePack(pack);
  if (parsed === "codex") return patchManagedInstructionFile(await instructionFile(root, ["AGENTS.md", "agents.md"]), "codex", { ...options, root });
  if (parsed === "claude-code") {
    const nativeFile = await existingInstructionFile(root, ["CLAUDE.md", "claude.md"]);
    if (nativeFile) return patchManagedInstructionFile(nativeFile, "claude-code", { ...options, root });
    return installSnippet("claude-code", "claude-code.md", claudeCodeTemplate(), options, root);
  }
  return installSnippet("antigravity", "antigravity.md", antigravityTemplate(), options, root);
}

export async function patchManagedInstructionFile(file: string, pack: string, options: { dryRun: boolean; quiet?: boolean; root?: string }): Promise<InstructionPatchResult> {
  const parsed = parsePack(pack);
  const body = parsed === "codex" ? codexTemplate() : parsed === "claude-code" ? claudeCodeTemplate() : antigravityTemplate();
  return patchManagedBlock(file, body, options);
}

async function installCodex(options: { dryRun: boolean }): Promise<void> {
  const root = await instructionRoot();
  const file = await instructionFile(root, ["AGENTS.md", "agents.md"]);
  await patchManagedBlock(file, codexTemplate(), { ...options, root });
}

async function installClaudeCode(options: { dryRun: boolean }): Promise<void> {
  const root = await instructionRoot();
  const nativeFile = await existingInstructionFile(root, ["CLAUDE.md", "claude.md"]);
  if (nativeFile) {
    await patchManagedBlock(nativeFile, claudeCodeTemplate(), { ...options, root });
    return;
  }
  await installSnippet("claude-code", "claude-code.md", claudeCodeTemplate(), options, root);
}

async function installSnippet(name: string, fileName: string, body: string, options: { dryRun: boolean; quiet?: boolean }, root?: string): Promise<InstructionPatchResult> {
  const projectRoot = root ?? await instructionRoot();
  const file = path.join(projectRoot, ".awg", "instructions", fileName);
  await assertSafeManagedTarget(file, projectRoot);
  if (!options.dryRun) await fs.mkdir(path.dirname(file), { recursive: true });
  const result = await patchManagedBlock(file, body, { ...options, root: projectRoot });
  if (result.changed && !options.dryRun && !options.quiet) console.log(`Installed ${name} instructions at ${file}`);
  return result;
}

async function patchManagedBlock(file: string, block: string, options: { dryRun: boolean; quiet?: boolean; root?: string }): Promise<InstructionPatchResult> {
  const stat = await assertSafeManagedTarget(file, options.root ?? path.dirname(file));
  const exists = Boolean(stat?.isFile());
  const prior = exists ? await fs.readFile(file, "utf8") : "";
  const managed = `${BEGIN}\n${block.trim()}\n${END}`;
  const next = prior.includes(BEGIN) && prior.includes(END)
    ? prior.replace(new RegExp(`${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}`), managed)
    : `${prior.trimEnd()}${prior.trim() ? "\n\n" : ""}${managed}\n`;
  if (next === prior) return { changed: false, file, action: "unchanged" };
  if (options.dryRun) {
    if (!options.quiet) console.log(`${exists ? "Would update" : "Would create"} ${file}`);
    return { changed: true, file, action: exists ? "would-update" : "would-create" };
  }
  await fs.writeFile(file, next);
  if (!options.quiet) console.log(`${exists ? "Updated" : "Created"} ${file}`);
  return { changed: true, file, action: exists ? "updated" : "created" };
}

async function instructionRoot(): Promise<string> {
  const vaultPath = await currentVaultPath();
  return vaultPath ? path.dirname(vaultPath) : process.cwd();
}

async function instructionFile(root: string, names: string[]): Promise<string> {
  return await existingInstructionFile(root, names) ?? path.join(root, names[0]);
}

async function existingInstructionFile(root: string, names: string[]): Promise<string | null> {
  const entries = await fs.readdir(root).catch(() => []);
  for (const name of names) {
    const exact = entries.find((entry) => entry === name);
    if (exact) return path.join(root, exact);
  }
  for (const name of names) {
    const lower = name.toLowerCase();
    const match = entries.find((entry) => entry.toLowerCase() === lower);
    if (match) return path.join(root, match);
  }
  return null;
}

async function assertSafeManagedTarget(file: string, root: string): Promise<import("node:fs").Stats | null> {
  const rootAbs = path.resolve(root);
  const fileAbs = path.resolve(file);
  const relative = path.relative(rootAbs, fileAbs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing to write outside project root: ${file}`);
  let current = rootAbs;
  let stat: import("node:fs").Stats | null = null;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Refusing to write through symlink: ${current}`);
  }
  if (stat && !stat.isFile()) throw new Error(`Refusing to write non-file path: ${file}`);
  return stat;
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
