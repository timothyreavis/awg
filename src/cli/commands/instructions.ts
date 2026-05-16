import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { currentVaultPath } from "../../global/registry.js";
import type { ParsedArgs } from "../args.js";

const BEGIN_PREFIX = "<!-- BEGIN AWG MANAGED INSTRUCTIONS";
const LEGACY_BEGIN = "<!-- BEGIN AWG MANAGED INSTRUCTIONS -->";
const END = "<!-- END AWG MANAGED INSTRUCTIONS -->";
const PACKS = ["codex", "claude-code", "antigravity"] as const;
type Pack = typeof PACKS[number];
export type InstructionPatchResult = { changed: boolean; file: string; action: "created" | "updated" | "unchanged" | "would-create" | "would-update" };
type InstructionPatchOptions = { dryRun: boolean; quiet?: boolean; root?: string; force?: boolean };

export async function instructionsCommand(parsed: ParsedArgs): Promise<void> {
  const [, subcommand, pack] = parsed.positionals;
  if (subcommand === "list") {
    console.log(PACKS.join("\n"));
    return;
  }
  if (subcommand !== "install" || !pack) throw new Error("Usage: awg instructions list | awg instructions install <codex|claude-code|antigravity|all> [--dry-run] [--force]");
  const packs = pack === "all" ? [...PACKS] : [parsePack(pack)];
  for (const item of packs) await installInstructions(item, { dryRun: Boolean(parsed.flags["dry-run"]), force: Boolean(parsed.flags.force) });
}

export async function installInstructions(pack: string, options: { dryRun: boolean; force?: boolean }): Promise<void> {
  const parsed = parsePack(pack);
  if (parsed === "codex") return installCodex(options);
  if (parsed === "claude-code") return installClaudeCode(options);
  await installSnippet("antigravity", "antigravity.md", antigravityTemplate(), options);
}

export async function installInstructionsAt(root: string, pack: string, options: { dryRun: boolean; quiet?: boolean; force?: boolean }): Promise<InstructionPatchResult> {
  const parsed = parsePack(pack);
  if (parsed === "codex") return patchManagedInstructionFile(await instructionFile(root, ["AGENTS.md", "agents.md"]), "codex", { ...options, root });
  if (parsed === "claude-code") {
    const nativeFile = await existingInstructionFile(root, ["CLAUDE.md", "claude.md"]);
    if (nativeFile) return patchManagedInstructionFile(nativeFile, "claude-code", { ...options, root });
    return installSnippet("claude-code", "claude-code.md", claudeCodeTemplate(), options, root);
  }
  return installSnippet("antigravity", "antigravity.md", antigravityTemplate(), options, root);
}

export async function patchManagedInstructionFile(file: string, pack: string, options: InstructionPatchOptions): Promise<InstructionPatchResult> {
  const parsed = parsePack(pack);
  const body = parsed === "codex" ? codexTemplate() : parsed === "claude-code" ? claudeCodeTemplate() : antigravityTemplate();
  return patchManagedBlock(file, parsed, body, options);
}

async function installCodex(options: { dryRun: boolean; force?: boolean }): Promise<void> {
  const root = await instructionRoot();
  const file = await instructionFile(root, ["AGENTS.md", "agents.md"]);
  await patchManagedBlock(file, "codex", codexTemplate(), { ...options, root });
}

async function installClaudeCode(options: { dryRun: boolean; force?: boolean }): Promise<void> {
  const root = await instructionRoot();
  const nativeFile = await existingInstructionFile(root, ["CLAUDE.md", "claude.md"]);
  if (nativeFile) {
    await patchManagedBlock(nativeFile, "claude-code", claudeCodeTemplate(), { ...options, root });
    return;
  }
  await installSnippet("claude-code", "claude-code.md", claudeCodeTemplate(), options, root);
}

async function installSnippet(name: Pack, fileName: string, body: string, options: { dryRun: boolean; quiet?: boolean; force?: boolean }, root?: string): Promise<InstructionPatchResult> {
  const projectRoot = root ?? await instructionRoot();
  const file = path.join(projectRoot, ".awg", "instructions", fileName);
  await assertSafeManagedTarget(file, projectRoot);
  if (!options.dryRun) await fs.mkdir(path.dirname(file), { recursive: true });
  const result = await patchManagedBlock(file, name, body, { ...options, root: projectRoot });
  if (result.changed && !options.dryRun && !options.quiet) console.log(`Installed ${name} instructions at ${file}`);
  return result;
}

async function patchManagedBlock(file: string, pack: Pack, block: string, options: InstructionPatchOptions): Promise<InstructionPatchResult> {
  const stat = await assertSafeManagedTarget(file, options.root ?? path.dirname(file));
  const exists = Boolean(stat?.isFile());
  const prior = exists ? await fs.readFile(file, "utf8") : "";
  const eol = detectEol(prior);
  const blockBody = block.trim();
  const managed = managedBlock(pack, blockBody, eol);
  const existing = findManagedBlock(prior);
  if (existing?.kind === "malformed") throw new Error(`${existing.message} Refusing to update ${file}; repair the AWG managed block markers before rerunning.`);
  if (existing?.kind === "found") assertCanReplaceManagedBlock(existing, pack, file, options.force ?? false);
  const next = existing?.kind === "found"
    ? `${prior.slice(0, existing.replaceStart)}${managed}${eol}${prior.slice(existing.replaceEnd)}`
    : appendManagedBlock(prior, managed, eol);
  if (next === prior) return { changed: false, file, action: "unchanged" };
  if (options.dryRun) {
    if (!options.quiet) console.log(`${exists ? "Would update" : "Would create"} ${file}`);
    return { changed: true, file, action: exists ? "would-update" : "would-create" };
  }
  await writeAtomicFile(file, next);
  if (!options.quiet) console.log(`${exists ? "Updated" : "Created"} ${file}`);
  return { changed: true, file, action: exists ? "updated" : "created" };
}

type ManagedBlockMatch =
  | { kind: "found"; begin: RegExpExecArray; beginCount: number; endCount: number; attrs: Record<string, string>; body: string; replaceStart: number; replaceEnd: number }
  | { kind: "malformed"; message: string };

function managedBlock(pack: Pack, body: string, eol: string): string {
  return `${managedBegin(pack, body)}${eol}${body}${eol}${END}`;
}

function managedBegin(pack: Pack, body: string): string {
  return `${BEGIN_PREFIX} id=${pack} hash=sha256:${hashManagedBody(body)} -->`;
}

function appendManagedBlock(prior: string, managed: string, eol: string): string {
  if (!prior) return `${managed}${eol}`;
  const separator = prior.endsWith("\n") ? eol : `${eol}${eol}`;
  return `${prior}${separator}${managed}${eol}`;
}

function findManagedBlock(text: string): ManagedBlockMatch | null {
  const rawBeginMatches = [...text.matchAll(/<!--\s*BEGIN AWG MANAGED INSTRUCTIONS/g)];
  const rawEndMatches = [...text.matchAll(/<!--\s*END AWG MANAGED INSTRUCTIONS/g)];
  const beginMatches = [...text.matchAll(/<!-- BEGIN AWG MANAGED INSTRUCTIONS(?:\s+([^>\r\n]*))? -->/g)];
  const endMatches = [...text.matchAll(/<!-- END AWG MANAGED INSTRUCTIONS -->/g)];
  if (rawBeginMatches.length === 0 && rawEndMatches.length === 0) return null;
  if (rawBeginMatches.length !== beginMatches.length || rawEndMatches.length !== endMatches.length) return { kind: "malformed", message: "Found malformed AWG managed marker text." };
  if (beginMatches.length !== 1 || endMatches.length !== 1) return { kind: "malformed", message: `Expected exactly one AWG managed block but found ${beginMatches.length} begin marker(s) and ${endMatches.length} end marker(s).` };
  const begin = beginMatches[0];
  const end = endMatches[0];
  if (begin.index === undefined || end.index === undefined || begin.index >= end.index) return { kind: "malformed", message: "AWG managed block markers are out of order." };
  const beginLineStart = lineStart(text, begin.index);
  const beginLineEnd = lineEndWithNewline(text, begin.index);
  const endLineStart = lineStart(text, end.index);
  const endLineEnd = lineEndWithNewline(text, end.index);
  const beginLine = text.slice(beginLineStart, lineEnd(text, begin.index)).replace(/\r$/, "");
  const endLine = text.slice(endLineStart, lineEnd(text, end.index)).replace(/\r$/, "");
  if (beginLine.trim() !== begin[0] || endLine.trim() !== END) return { kind: "malformed", message: "AWG managed markers must be on their own lines." };
  return {
    kind: "found",
    begin,
    beginCount: beginMatches.length,
    endCount: endMatches.length,
    attrs: parseMarkerAttrs(begin[1] ?? ""),
    body: text.slice(beginLineEnd, endLineStart),
    replaceStart: beginLineStart,
    replaceEnd: endLineEnd
  };
}

function assertCanReplaceManagedBlock(block: Extract<ManagedBlockMatch, { kind: "found" }>, pack: Pack, file: string, force: boolean): void {
  const owner = block.attrs.id;
  if (owner && owner !== pack) throw new Error(`AWG managed block in ${file} belongs to ${owner}, not ${pack}. Refusing to update.`);
  const hash = block.attrs.hash;
  if (hash) {
    const expected = `sha256:${hashManagedBody(block.body)}`;
    if (hash !== expected) {
      if (force) return;
      throw new Error(`AWG managed block in ${file} was edited after AWG generated it. Refusing to overwrite user edits; rerun with --force to replace only the managed block.`);
    }
    if (owner || force) return;
    throw new Error(`AWG managed block in ${file} has no pack owner. Refusing to overwrite possible user edits; rerun with --force to replace only the managed block.`);
  }
  if (isKnownGeneratedInstructionBody(block.body, pack) || force) return;
  throw new Error(`Legacy AWG managed block in ${file} has no ownership hash and does not match a known AWG-generated ${pack} template. Refusing to overwrite possible user edits; rerun with --force to replace only the managed block.`);
}

function parseMarkerAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const part of raw.trim().split(/\s+/).filter(Boolean)) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    attrs[part.slice(0, index)] = part.slice(index + 1);
  }
  return attrs;
}

function isKnownGeneratedInstructionBody(body: string, pack: Pack): boolean {
  const normalized = normalizeManagedBody(body);
  return knownGeneratedInstructionBodies(pack).some((known) => normalizeManagedBody(known) === normalized);
}

function knownGeneratedInstructionBodies(pack: Pack): string[] {
  if (pack === "codex") return [codexTemplate()];
  if (pack === "claude-code") return [claudeCodeTemplate()];
  return [antigravityTemplate()];
}

function hashManagedBody(body: string): string {
  return createHash("sha256").update(normalizeManagedBody(body)).digest("hex");
}

function normalizeManagedBody(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function detectEol(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function lineStart(text: string, index: number): number {
  const prior = text.lastIndexOf("\n", Math.max(0, index - 1));
  return prior === -1 ? 0 : prior + 1;
}

function lineEnd(text: string, index: number): number {
  const next = text.indexOf("\n", index);
  return next === -1 ? text.length : next;
}

function lineEndWithNewline(text: string, index: number): number {
  const next = text.indexOf("\n", index);
  return next === -1 ? text.length : next + 1;
}

async function writeAtomicFile(file: string, body: string): Promise<void> {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(tmp, body);
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.unlink(tmp).catch(() => undefined);
    throw error;
  }
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

Start of session:
- Run \`awg handoff\`.
- Run \`awg release current\` after install or upgrade to discover current local capabilities.
- Run \`awg vault topology --json\` before cross-project work.
- Run \`awg run start --goal "<goal>"\`.
- Use \`awg search <query>\` before creating durable nodes.
- Run \`awg template status --goal "<goal>" --json\` to understand local operating rules.
- Use \`awg lens task --goal "<goal>"\` for scoped context.
- Use \`awg lens list --goal "<goal>"\` and \`awg lens run <lens-id> --goal "<goal>"\` only when a reviewed vault-local lens fits better than built-in task/handoff context.
- Use \`awg node show <node-id> --json\` when a surfaced node's full body, fields, blocks, evidence, or run attribution matter.

During work:
- Use AWG for durable project knowledge, not transcript storage. Capture the consequence, not the conversation.
- Search first, then update the canonical node or create the smallest useful node.
- Capture decisions, requirements, accepted plans, reusable constraints, risks, blockers, tasks, evidence, source-of-truth boundaries, and actionable feedback once they affect future work.
- Use \`awg add claim\` for assertions that may guide future work, \`awg verify <node-id> --summary "..."\` before treating claims as proven, and \`awg claim status <node-id> --json\` before relying on stale, external, metric, policy, pricing, or implementation claims.
- During brainstorming, wait or capture only as a \`needs_review\` note/question; use a \`hypothesis\` tag when useful. Follow the vault template for stricter or more exploratory capture thresholds.
- Use \`awg quick note|task|risk|question|decision "summary"\` for low-ceremony durable captures.
- Update existing nodes instead of creating duplicates.
- Attach durable knowledge as nodes, edges, responses, and evidence.
- Write only to the current explicit target vault; switch cwd into a related vault or leave a cross-vault handoff task when another vault needs updates.
- Durable writes automatically attach to the active run. Use \`--run <run-id>\` for an explicit active run or \`--no-run\` to suppress attribution.
- Use \`body\` for narrative detail, \`fields\` for structured operational data, safe node-local \`blocks\` for presentation, authored \`view\` records for recurring multi-node human review surfaces, \`freshness\` for currentness, and \`anchors\` for references.
- Create configurable \`lens\` records for repeated agent context shapes; start new lenses as \`needs_review\` unless the vault template allows activation, update near-duplicates instead of creating more, and keep lenses compact, query-backed, and read-only.
- Link related nodes by AWG node ID.
- Add run notes for meaningful progress or blockers.
- Add evidence for completed work or verification claims.
- Use contradictions explicitly with evidence instead of silently replacing old claims, and keep sensitive evidence redacted.

Before finishing:
- Update task, risk, blocker, and decision statuses.
- Run \`awg build\`.
- Run \`awg doctor --fix-suggestions --json\`.
- Fix fatal validation errors and relevant warnings.
- Run \`awg run finish --status completed|partial|blocked|failed --summary "..." --auto-handoff\`.
- If finishing with \`--force\`, document why in the summary or a run note.

Anti-patterns:
- Do not create duplicate nodes without searching.
- Do not mark work complete without evidence.
- Do not ignore stale risks or blockers.
- Do not leave orphan durable knowledge.
- Do not write only to chat when knowledge should persist.
- Do not edit \`.awg/compiled/*\` as source.`;
}

function claudeCodeTemplate(): string {
  return `# AWG Claude Code Snippet

This project uses AWG as local durable project memory. Start with \`awg handoff\`, run \`awg release current\` after install or upgrade, check \`awg vault topology --json\` before cross-project work, then \`awg run start --goal "<goal>"\`. Use \`awg search\`, \`awg template status --goal "<goal>" --json\`, and \`awg lens task --goal "<goal>"\` before adding context; use \`awg lens list --goal "<goal>"\` and \`awg lens run <lens-id> --goal "<goal>"\` only when a reviewed vault-local lens fits a repeated context shape. Use \`awg node show <node-id> --json\` when you need a surfaced node's full detail, and \`awg claim status <node-id> --json\` before relying on stale, external, metric, policy, pricing, or implementation claims. Capture the consequence, not the conversation: persist decisions, requirements, accepted plans, reusable constraints, risks, blockers, tasks, claims, evidence, source-of-truth boundaries, and actionable feedback once they affect future work; during brainstorming, wait or capture only as a \`needs_review\` note/question or claim, using a \`hypothesis\` tag when useful. Use \`awg quick note|task|risk|question|decision "summary"\` for low-ceremony durable captures and \`awg add claim\` for reviewable assertions. Durable writes automatically attach to the active run; use fields, safe node-local blocks, freshness, and anchors when helpful; use authored views for recurring multi-node human review surfaces and configurable lens records for repeated agent retrieval recipes rather than duplicating graph content. Add run notes and evidence for completed work, use \`awg verify\` before treating claims as proven, keep contradictions explicit, and redact sensitive evidence. Write only to the current explicit target vault; switch cwd into a related vault or leave a cross-vault handoff task when another vault needs updates. Before finishing, update stale statuses, run \`awg build\` and \`awg doctor --fix-suggestions --json\`, then finish with \`awg run finish --status completed|partial|blocked|failed --summary "..." --auto-handoff\`. If forced, document why.
`;
}

function antigravityTemplate(): string {
  return `# AWG Antigravity Snippet

Use the project-local .awg vault only. Start with \`awg handoff\`, run \`awg release current\` after install or upgrade, check \`awg vault topology --json\` before cross-project work, then \`awg run start --goal "<goal>"\`. Use \`awg search\` before creating nodes, inspect \`awg template status --goal "<goal>" --json\`, scope work with \`awg lens task --goal "<goal>"\`, and inspect full surfaced nodes with \`awg node show <node-id> --json\` when needed. Use \`awg claim status <node-id> --json\` before relying on stale, external, metric, policy, pricing, or implementation claims. Use configurable lenses only for repeated context shapes: list/show them first, run reviewed lenses read-only, and update near-duplicates instead of adding more. Capture the consequence, not the conversation; preserve durable decisions, requirements, accepted plans, constraints, risks, blockers, tasks, claims, evidence, source-of-truth boundaries, and actionable feedback, while leaving brainstorming in chat or capturing it only as a \`needs_review\` note/question/claim with a \`hypothesis\` tag when useful. Use \`awg quick note|task|risk|question|decision "summary"\` for small durable captures and \`awg add claim\` for reviewable assertions. Update existing nodes, use structured fields/safe node-local blocks/freshness/anchors when useful, use authored views for recurring multi-node human review surfaces and configurable lenses for recurring agent retrieval recipes, add run notes, attach evidence for completed work, use \`awg verify\` before treating claims as proven, keep contradictions explicit, redact sensitive evidence, write only to the current explicit target vault, then run \`awg build\`, \`awg doctor --fix-suggestions --json\`, and \`awg run finish --status completed|partial|blocked|failed --summary "..." --auto-handoff\`. If forced, document why.
`;
}
