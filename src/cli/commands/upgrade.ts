import { promises as fs } from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import { AWG_VERSION } from "../../core/constants.js";
import { coreSchemaNames, currentSchemaManifest, isKnownAwgManagedSchemaBody, schemaBodyForFile, schemaContentHash } from "../../core/schemas.js";
import { stableStringify } from "../../util/json.js";
import { canonicalVaultPath, globalAwgDir, readRegistry } from "../../global/registry.js";
import { installInstructionsAt, patchManagedInstructionFile, type InstructionPatchResult } from "./instructions.js";
import type { ParsedArgs } from "../args.js";

const instructionPacks = ["codex", "claude-code", "antigravity"];
const managedBegin = "<!-- BEGIN AWG MANAGED INSTRUCTIONS";
const schemaManifestFile = ".awg/schema/core/.awg-managed.json";

interface UpgradeResult {
  name: string;
  path: string;
  status: "changed" | "unchanged" | "skipped" | "failed";
  actions: string[];
  error?: string;
}

type UpgradeInstructionTarget = { pack: string; file?: string };

export async function upgradeCommand(parsed: ParsedArgs): Promise<void> {
  const dryRun = Boolean(parsed.flags["dry-run"]);
  const force = Boolean(parsed.flags.force);
  const packs = parsePacks(parsed.flags.instructions);
  const vaults = parsed.flags.all ? await registeredVaults() : [await currentVault()];
  const results: UpgradeResult[] = [];
  for (const vault of vaults) results.push(await upgradeVault(vault, { dryRun, packs, force }));
  if (parsed.flags.json) console.log(JSON.stringify({ dryRun, results }, null, 2));
  else printResults(results, dryRun);
  if (results.some((result) => result.status === "failed")) process.exitCode = 1;
}

async function currentVault(): Promise<{ name: string; path: string }> {
  const vaultPath = await currentUpgradeableVaultPath();
  if (!vaultPath) throw new Error("No AWG project vault found. Run awg init first.");
  return { name: path.basename(path.dirname(vaultPath)), path: vaultPath };
}

async function currentUpgradeableVaultPath(): Promise<string | null> {
  let current = path.resolve(process.cwd());
  while (true) {
    const vaultPath = path.join(current, ".awg");
    if (await isUpgradeableAwgDir(vaultPath)) return canonicalVaultPath(vaultPath);
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function registeredVaults(): Promise<Array<{ name: string; path: string }>> {
  const registry = await readRegistry();
  return registry.vaults.map((vault) => ({ name: vault.name, path: vault.path }));
}

async function upgradeVault(vault: { name: string; path: string }, options: { dryRun: boolean; packs: string[]; force: boolean }): Promise<UpgradeResult> {
  const actions: string[] = [];
  let changed = false;
  try {
    if (!(await isUpgradeableAwgDir(vault.path))) return { name: vault.name, path: vault.path, status: "skipped", actions, error: "Vault missing or not initialized." };
    const root = path.dirname(vault.path);
    const instructionTargets = await upgradeInstructionTargets(root, options.packs);
    if (!options.dryRun) {
      for (const target of instructionTargets) await patchUpgradeInstruction(root, target, { ...options, dryRun: true });
    }
    changed = await ensureProjectDirs(root, options, actions) || changed;
    changed = await updateConfig(root, options, actions) || changed;
    changed = await updateSchemas(root, options, actions) || changed;
    changed = await ensureVaultAgents(root, options, actions) || changed;
    for (const target of instructionTargets) changed = recordInstructionResult(await patchUpgradeInstruction(root, target, options), target.pack, root, actions) || changed;
    return { name: vault.name, path: vault.path, status: changed ? "changed" : "unchanged", actions };
  } catch (error) {
    return { name: vault.name, path: vault.path, status: "failed", actions, error: error instanceof Error ? error.message : String(error) };
  }
}

async function upgradeInstructionTargets(root: string, packs: string[]): Promise<UpgradeInstructionTarget[]> {
  if (packs.length > 0) return packs.map((pack) => ({ pack }));
  return managedInstructionFiles(root);
}

async function patchUpgradeInstruction(root: string, target: UpgradeInstructionTarget, options: { dryRun: boolean; force: boolean }): Promise<InstructionPatchResult> {
  const patchOptions = { dryRun: options.dryRun, quiet: true, force: options.force };
  if (target.file) return patchManagedInstructionFile(target.file, target.pack, { ...patchOptions, root });
  return installInstructionsAt(root, target.pack, patchOptions);
}

async function managedInstructionFiles(root: string): Promise<Array<{ pack: string; file: string }>> {
  const candidates = [
    { pack: "codex", file: path.join(root, "AGENTS.md") },
    { pack: "codex", file: path.join(root, "agents.md") },
    { pack: "claude-code", file: path.join(root, "CLAUDE.md") },
    { pack: "claude-code", file: path.join(root, "claude.md") },
    { pack: "claude-code", file: path.join(root, ".awg/instructions/claude-code.md") },
    { pack: "antigravity", file: path.join(root, ".awg/instructions/antigravity.md") }
  ];
  const installed = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!((await readText(candidate.file, { root, skipSymlink: true }))?.includes(managedBegin))) continue;
    const canonical = await canonicalVaultPath(candidate.file);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    installed.push(candidate);
  }
  return installed;
}

async function ensureProjectDirs(root: string, options: { dryRun: boolean }, actions: string[]): Promise<boolean> {
  let changed = false;
  for (const dir of [
    ".awg/log",
    ".awg/compiled/indexes",
    ".awg/compiled/lenses",
    ".awg/compiled/views",
    ".awg/compiled/reports",
    ".awg/compiled/site",
    ".awg/schema/core"
  ]) {
    const full = path.join(root, dir);
    const stat = await assertSafeManagedDirectory(root, full);
    if (stat?.isDirectory()) continue;
    actions.push(`${options.dryRun ? "would create" : "created"} ${dir}`);
    changed = true;
    if (!options.dryRun) await fs.mkdir(full, { recursive: true });
  }
  return changed;
}

async function updateConfig(root: string, options: { dryRun: boolean }, actions: string[]): Promise<boolean> {
  const file = path.join(root, ".awg/config.json");
  const prior = await readJson(file, { root });
  const next = {
    ...prior,
    awg: AWG_VERSION,
    project: isObject(prior.project) ? prior.project : { title: path.basename(root) },
    doctor: { activeRunStaleHours: 24, runNoteStaleHours: 4, recentRunWindowDays: 7, ...(isObject(prior.doctor) ? prior.doctor : {}) },
    validation: { allow_unknown_node_types: true, strict_links: false, ...(isObject(prior.validation) ? prior.validation : {}) },
    storage: { adapter: "file", canonical: ".awg/log/**/*.awg.jsonl", ...(isObject(prior.storage) ? prior.storage : {}) }
  };
  return writeIfChanged(root, file, stableStringify(next), options, actions);
}

async function updateSchemas(root: string, options: { dryRun: boolean }, actions: string[]): Promise<boolean> {
  let changed = false;
  const manifest = await readSchemaManifest(root);
  for (const name of coreSchemaNames) {
    const file = path.join(root, ".awg/schema/core", `${name}.schema.json`);
    changed = await updateSchema(root, file, name, manifest, options, actions) || changed;
  }
  changed = await writeIfChanged(root, path.join(root, schemaManifestFile), stableStringify(currentSchemaManifest()), options, actions) || changed;
  return changed;
}

async function updateSchema(root: string, file: string, name: string, manifest: SchemaManifest | null, options: { dryRun: boolean }, actions: string[]): Promise<boolean> {
  const body = schemaBodyForFile(name);
  const prior = await readText(file, { root });
  if (prior === body) return false;
  if (prior !== null) {
    if (manifestSchemaHash(manifest, name) === schemaContentHash(prior) || isKnownAwgManagedSchemaBody(name, prior)) return writeIfChanged(root, file, body, options, actions);
    actions.push(`preserved custom schema ${path.relative(path.dirname(path.dirname(file)), file)}; review manually`);
    return false;
  }
  return writeIfChanged(root, file, body, options, actions);
}

interface SchemaManifest {
  schemas?: Record<string, { hash?: unknown }>;
}

async function readSchemaManifest(root: string): Promise<SchemaManifest | null> {
  const value = await readJson(path.join(root, schemaManifestFile), { root }).catch(() => null);
  return isObject(value) ? value : null;
}

function manifestSchemaHash(manifest: SchemaManifest | null, name: string): string | null {
  const entry = manifest?.schemas?.[name];
  return typeof entry?.hash === "string" ? entry.hash : null;
}

async function ensureVaultAgents(root: string, options: { dryRun: boolean }, actions: string[]): Promise<boolean> {
  const file = path.join(root, ".awg/AGENTS.md");
  if (await exists(file)) return false;
  return writeIfChanged(root, file, vaultAgentsTemplate(), options, actions);
}

async function writeIfChanged(root: string, file: string, body: string, options: { dryRun: boolean }, actions: string[]): Promise<boolean> {
  await assertSafeManagedTarget(root, file);
  const prior = await readText(file, { root });
  if (prior === body) return false;
  actions.push(`${options.dryRun ? "would update" : prior === null ? "created" : "updated"} ${path.relative(path.dirname(path.dirname(file)), file)}`);
  if (options.dryRun) return true;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
  return true;
}

async function readText(file: string, options: { root?: string; skipSymlink?: boolean } = {}): Promise<string | null> {
  try {
    if (options.root) await assertSafeManagedTarget(options.root, file);
    else if ((await fs.lstat(file)).isSymbolicLink()) {
      if (options.skipSymlink) return null;
      throw new Error(`Refusing to read symlink: ${file}`);
    }
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (options.skipSymlink && error instanceof Error && error.message.includes("symlink")) return null;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readJson(file: string, options: { root?: string; skipSymlink?: boolean } = {}): Promise<Record<string, unknown>> {
  const text = await readText(file, options);
  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

async function assertSafeManagedTarget(root: string, file: string): Promise<Stats | null> {
  return assertSafeManagedPath(root, file, "file");
}

async function assertSafeManagedDirectory(root: string, dir: string): Promise<Stats | null> {
  return assertSafeManagedPath(root, dir, "directory");
}

async function assertSafeManagedPath(root: string, file: string, kind: "file" | "directory"): Promise<Stats | null> {
  const rootAbs = path.resolve(root);
  const fileAbs = path.resolve(file);
  const relative = path.relative(rootAbs, fileAbs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing to access path outside project root: ${file}`);
  let current = rootAbs;
  let stat: Stats | null = null;
  const parts = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const isFinal = index === parts.length - 1;
    current = path.join(current, part);
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Refusing to access symlink: ${current}`);
    if (!isFinal && !stat.isDirectory()) throw new Error(`Refusing to access path through non-directory: ${current}`);
    if (isFinal && kind === "file" && !stat.isFile()) throw new Error(`Refusing to access non-file path: ${file}`);
    if (isFinal && kind === "directory" && !stat.isDirectory()) throw new Error(`Refusing to access non-directory path: ${file}`);
  }
  return stat;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function isUpgradeableAwgDir(vaultPath: string): Promise<boolean> {
  const canonical = await canonicalVaultPath(vaultPath);
  const global = await canonicalVaultPath(globalAwgDir());
  if (canonical === global || canonical.startsWith(`${global}${path.sep}`)) return false;
  if (!(await exists(vaultPath))) return false;
  if (!(await exists(path.join(vaultPath, "config.json")))) return false;
  const config = await readJson(path.join(vaultPath, "config.json"), { root: path.dirname(vaultPath), skipSymlink: true }).catch(() => null);
  if (!config) return false;
  if (typeof config.awg === "string") return true;
  return isObject(config.storage) || await exists(path.join(vaultPath, "schema")) || await exists(path.join(vaultPath, "log"));
}

function parsePacks(value: ParsedArgs["flags"][string]): string[] {
  if (Array.isArray(value)) value = value[value.length - 1];
  if (value === undefined) return [];
  if (typeof value !== "string" || !value.trim()) throw new Error("--instructions requires a comma-separated pack list or all.");
  if (value === "all") return instructionPacks;
  const packs = value.split(",").map((item) => item.trim()).filter(Boolean);
  for (const pack of packs) {
    if (!instructionPacks.includes(pack)) throw new Error(`Unknown instruction pack: ${pack}`);
  }
  return packs;
}

function recordInstructionResult(result: InstructionPatchResult, pack: string, root: string, actions: string[]): boolean {
  if (!result.changed) return false;
  const label = result.action === "would-create" ? "would create" : result.action === "would-update" ? "would update" : result.action;
  actions.push(`${label} instructions:${pack} ${path.relative(root, result.file)}`);
  return true;
}

function printResults(results: UpgradeResult[], dryRun: boolean): void {
  console.log(`AWG upgrade ${dryRun ? "dry run" : "complete"}: ${results.length} vault(s).`);
  for (const result of results) {
    console.log(`${result.status.toUpperCase()} ${result.name} ${result.path}`);
    for (const action of result.actions) console.log(`- ${action}`);
    if (result.error) console.log(`- ${result.error}`);
  }
}

function vaultAgentsTemplate(): string {
  return `# AWG Agent Instructions

Start of session:
- Run \`awg handoff\`.
- Run \`awg run start --goal "<goal>"\`.
- Use \`awg search <query>\` before creating durable nodes.
- Use \`awg lens task --goal "<goal>"\` for scoped context.

During work:
- Update existing nodes instead of creating duplicates.
- Attach durable knowledge as nodes, edges, responses, and evidence.
- Link related nodes by AWG node ID, not by file path.
- Add run notes for meaningful progress or blockers.
- Add evidence for completed work or verification claims.

Before finishing:
- Update task, risk, blocker, and decision statuses.
- Add evidence for completed work.
- Run \`awg build\`.
- Run \`awg doctor\`.
- Fix fatal validation errors and review warnings.
- Run \`awg run finish --status completed|partial|blocked|failed --summary "..."\`.
- Run \`awg handoff\`.

Anti-patterns:
- Do not create duplicate nodes without searching.
- Do not mark work complete without evidence.
- Do not ignore stale risks or blockers.
- Do not leave orphan durable knowledge.
- Do not write only to chat when knowledge should persist.
- Do not edit \`.awg/compiled/*\` as source.
`;
}
