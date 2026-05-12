import { promises as fs } from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import { AWG_VERSION } from "../../core/constants.js";
import { coreSchemaNames, currentSchemaManifest, schemaBodyForFile } from "../../core/schemas.js";
import { nodeId } from "../../core/ids.js";
import { stableStringify } from "../../util/json.js";
import { nowIso, todayPathParts } from "../../util/time.js";
import { canonicalVaultPath, globalAwgDir, globalAwgExists, isPlausibleAwgDir, registerVault } from "../../global/registry.js";
import type { AwgNode } from "../../core/types.js";
import type { ParsedArgs } from "../args.js";

export async function initCommand(parsed: ParsedArgs): Promise<void> {
  const root = process.cwd();
  const awg = path.join(root, ".awg");
  if (await isInsideGlobalAwg(root, awg)) {
    throw new Error("Refusing to initialize a project vault inside ~/.awg. Run awg init inside a project directory.");
  }
  if (await exists(awg)) {
    if (!parsed.flags.force) {
      if (!(await isPlausibleAwgDir(awg))) {
        await writeProjectVault(root, parsed, { preserveExistingFiles: true });
        await maybeRegister(root, parsed);
        console.log("Initialized AWG in existing .awg directory.");
        return;
      }
      await writeRootAgentsIfMissing(root);
      await writeClaudeIfMissing(root);
      await writeSchemasIfMissing(root);
      await maybeRegister(root, parsed);
      console.log("AWG already initialized. Verified root agent instruction files.");
      return;
    }
    await fs.rm(awg, { recursive: true, force: true });
  }

  await writeProjectVault(root, parsed, { preserveExistingFiles: false });
  await maybeRegister(root, parsed);
  console.log("Initialized AWG in .awg");
}

async function isInsideGlobalAwg(root: string, awg: string): Promise<boolean> {
  const global = await canonicalVaultPath(globalAwgDir());
  const projectRoot = await canonicalVaultPath(root);
  const projectVault = await canonicalVaultPath(awg);
  return projectVault === global || projectRoot === global || projectRoot.startsWith(`${global}${path.sep}`);
}

async function writeProjectVault(root: string, parsed: ParsedArgs, options: { preserveExistingFiles: boolean }): Promise<void> {
  for (const dir of [
    ".awg/log",
    ".awg/compiled/indexes",
    ".awg/compiled/lenses",
    ".awg/compiled/views",
    ".awg/compiled/reports",
    ".awg/compiled/site",
    ".awg/schema/core"
  ]) await ensureProjectDir(root, path.join(root, dir));

  await writeFile(root, path.join(root, ".awg/config.json"), stableStringify({
    awg: AWG_VERSION,
    project: { title: path.basename(root) },
    validation: { allow_unknown_node_types: true, strict_links: false },
    storage: { adapter: "file", canonical: ".awg/log/**/*.awg.jsonl" }
  }), options);
  await writeFile(root, path.join(root, ".awg/AGENTS.md"), agentsTemplate(), options);
  await writeRootAgentsIfMissing(root);
  await writeClaudeIfMissing(root);
  for (const name of coreSchemaNames) await writeFile(root, path.join(root, ".awg/schema/core", `${name}.schema.json`), schemaBodyForFile(name), options);
  await writeFile(root, path.join(root, ".awg/schema/core/.awg-managed.json"), stableStringify(currentSchemaManifest()), options);

  if (!parsed.flags.empty && (!options.preserveExistingFiles || !(await hasLogEntries(root)))) await writeStarterLog(root);
}

async function ensureProjectDir(root: string, dir: string): Promise<void> {
  await assertSafeProjectPath(root, dir, "directory");
  await fs.mkdir(dir, { recursive: true });
}

async function writeFile(root: string, file: string, body: string, options: { preserveExistingFiles: boolean }): Promise<void> {
  await assertSafeProjectPath(root, file, "file");
  if (options.preserveExistingFiles && await exists(file)) return;
  await fs.writeFile(file, body);
}

async function maybeRegister(root: string, parsed: ParsedArgs): Promise<void> {
  if (parsed.flags["no-register"]) return;
  if (parsed.flags.register || await globalAwgExists()) {
    const result = await registerVault({ vaultPath: path.join(root, ".awg") });
    console.log(`${result.created ? "Registered" : "Updated"} AWG vault in global registry.`);
  }
}

async function writeStarterLog(root: string): Promise<void> {
  const at = nowIso();
  const node: AwgNode = {
    awg: AWG_VERSION,
    kind: "node",
    id: nodeId("Example durable knowledge"),
    type: "concept",
    title: "Example durable knowledge",
    summary: "A starter AWG node showing the append-only JSONL format.",
    status: "active",
    importance: 0.5,
    confidence: 0.8,
    created_at: at,
    updated_at: at,
    tags: ["example"],
    provenance: { created_by: "agent:codex", updated_by: "agent:codex", source: "init", human_approved: false },
    freshness: { state: "current", last_verified: at.slice(0, 10) }
  };
  const { year, month, date } = todayPathParts();
  const file = path.join(root, ".awg/log", year, month, `${date}.awg.jsonl`);
  await ensureProjectDir(root, path.dirname(file));
  await assertSafeProjectPath(root, file, "file");
  await fs.writeFile(file, `${JSON.stringify(node)}\n`);
}

function agentsTemplate(): string {
  return `# AWG Agent Instructions

- Before starting work, run \`awg lens resume\` or read \`.awg/compiled/lenses/resume.json\`.
- If the lens is missing or stale, run \`awg build\`.
- Store durable knowledge as AWG nodes/edges/responses/events.
- Prefer \`awg add\` commands over manually editing JSONL.
- Do not edit \`.awg/compiled/*\` manually.
- Do not link by file path when linking knowledge. Link by AWG node ID.
- Do not delete nodes to reorganize. Supersede, archive, merge later, or create corrective events.
- When making a durable decision, create or update a decision node.
- When identifying a risk/blocker, create a risk/task node with review metadata if possible.
- When completing work, update/add task status and add evidence.
- After writing AWG data, run \`awg build\`.
- Fix fatal validation errors before stopping.
- Review \`awg doctor\` warnings and resolve obvious stale items.
- End by ensuring \`.awg/compiled/lenses/resume.json\` reflects the current state.
`;
}

async function writeRootAgentsIfMissing(root: string): Promise<void> {
  if (await existingRootInstructionFile(root, ["AGENTS.md", "agents.md"])) return;
  const file = path.join(root, "AGENTS.md");
  await assertSafeProjectPath(root, file, "file");
  await fs.writeFile(file, rootAgentsTemplate());
}

function rootAgentsTemplate(): string {
  return `# Agent Instructions

This project uses AWG as its durable project memory.

Before starting work:
- Run \`awg lens resume\`.
- If the lens is missing or stale, run \`awg build\`, then rerun \`awg lens resume\`.
- Read \`.awg/AGENTS.md\`.

During work:
- Record durable facts, decisions, risks, tasks, questions, constraints, and preferences in AWG.
- Prefer \`awg add node\`, \`awg add edge\`, and \`awg add response\` over manual JSONL edits.
- Link knowledge by AWG node ID, not by file path.
- Do not edit \`.awg/compiled/*\`.

Before stopping:
- Run \`awg build\`.
- Run \`awg doctor\`.
- Fix fatal validation errors.
- Ensure \`awg lens resume\` reflects the current project state.
`;
}

async function writeClaudeIfMissing(root: string): Promise<void> {
  if (await existingRootInstructionFile(root, ["CLAUDE.md", "claude.md"])) return;
  const agentsFile = await existingRootInstructionFile(root, ["AGENTS.md", "agents.md"]) ?? path.join(root, "AGENTS.md");
  const file = path.join(root, "CLAUDE.md");
  await assertSafeProjectPath(root, file, "file");
  await fs.writeFile(file, claudeTemplate(path.basename(agentsFile)));
}

async function writeSchemaManifestIfMissing(root: string): Promise<void> {
  const file = path.join(root, ".awg/schema/core/.awg-managed.json");
  await assertSafeProjectPath(root, file, "file");
  if (await exists(file)) return;
  await ensureProjectDir(root, path.dirname(file));
  await fs.writeFile(file, stableStringify(currentSchemaManifest()));
}

async function writeSchemasIfMissing(root: string): Promise<void> {
  await ensureProjectDir(root, path.join(root, ".awg/schema/core"));
  for (const name of coreSchemaNames) {
    const file = path.join(root, ".awg/schema/core", `${name}.schema.json`);
    await assertSafeProjectPath(root, file, "file");
    if (!(await exists(file))) await fs.writeFile(file, schemaBodyForFile(name));
  }
  await writeSchemaManifestIfMissing(root);
}

function claudeTemplate(agentsFile = "AGENTS.md"): string {
  return `# Claude Instructions

Follow the project instructions in \`${agentsFile}\`.

This project uses AWG as its durable project memory. Before starting work, run \`awg lens resume\`. If the lens is missing or stale, run \`awg build\`, then rerun \`awg lens resume\`.

Read \`.awg/AGENTS.md\` for AWG-specific operating rules. Prefer \`awg add node\`, \`awg add edge\`, and \`awg add response\` over manual JSONL edits. Do not edit \`.awg/compiled/*\`.

Before stopping, run \`awg build\` and \`awg doctor\`, fix fatal validation errors, and ensure \`awg lens resume\` reflects the current project state.
`;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function existingRootInstructionFile(root: string, names: string[]): Promise<string | null> {
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

async function assertSafeProjectPath(root: string, target: string, kind: "file" | "directory"): Promise<Stats | null> {
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(target);
  const relative = path.relative(rootAbs, targetAbs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing to access path outside project root: ${target}`);
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
    if (isFinal && kind === "file" && !stat.isFile()) throw new Error(`Refusing to access non-file path: ${target}`);
    if (isFinal && kind === "directory" && !stat.isDirectory()) throw new Error(`Refusing to access non-directory path: ${target}`);
  }
  return stat;
}

async function hasLogEntries(root: string): Promise<boolean> {
  await assertSafeProjectPath(root, path.join(root, ".awg/log"), "directory");
  const files = await walk(path.join(root, ".awg/log"));
  return files.some((file) => file.endsWith(".awg.jsonl"));
}

async function walk(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const found = await Promise.all(entries.map(async (entry) => {
      const full = path.join(root, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    }));
    return found.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
