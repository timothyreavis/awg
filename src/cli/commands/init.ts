import { promises as fs } from "node:fs";
import path from "node:path";
import { AWG_VERSION } from "../../core/constants.js";
import { schemaForFile } from "../../core/schemas.js";
import { nodeId } from "../../core/ids.js";
import { stableStringify } from "../../util/json.js";
import { nowIso, todayPathParts } from "../../util/time.js";
import { canonicalVaultPath, globalAwgDir, globalAwgExists, isPlausibleAwgDir, registerVault } from "../../global/registry.js";
import type { AwgNode } from "../../core/types.js";
import type { ParsedArgs } from "../args.js";

const schemaNames = ["node", "edge", "event", "view", "lens", "response", "policy", "operation"];

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
  ]) await fs.mkdir(path.join(root, dir), { recursive: true });

  await writeFile(path.join(root, ".awg/config.json"), stableStringify({
    awg: AWG_VERSION,
    project: { title: path.basename(root) },
    validation: { allow_unknown_node_types: true, strict_links: false },
    storage: { adapter: "file", canonical: ".awg/log/**/*.awg.jsonl" }
  }), options);
  await writeFile(path.join(root, ".awg/AGENTS.md"), agentsTemplate(), options);
  await writeRootAgentsIfMissing(root);
  await writeClaudeIfMissing(root);
  for (const name of schemaNames) await writeFile(path.join(root, ".awg/schema/core", `${name}.schema.json`), stableStringify(schemaForFile(name)), options);

  if (!parsed.flags.empty && (!options.preserveExistingFiles || !(await hasLogEntries(root)))) await writeStarterLog(root);
}

async function writeFile(file: string, body: string, options: { preserveExistingFiles: boolean }): Promise<void> {
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
  await fs.mkdir(path.dirname(file), { recursive: true });
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
  const file = path.join(root, "AGENTS.md");
  if (await exists(file)) return;
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
  const file = path.join(root, "CLAUDE.md");
  if (await exists(file)) return;
  await fs.writeFile(file, claudeTemplate());
}

function claudeTemplate(): string {
  return `# Claude Instructions

Follow the project instructions in \`AGENTS.md\`.

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

async function hasLogEntries(root: string): Promise<boolean> {
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
