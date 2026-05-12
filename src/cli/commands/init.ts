import { promises as fs } from "node:fs";
import path from "node:path";
import { AWG_VERSION } from "../../core/constants.js";
import { schemaForFile } from "../../core/schemas.js";
import { nodeId } from "../../core/ids.js";
import { stableStringify } from "../../util/json.js";
import { nowIso, todayPathParts } from "../../util/time.js";
import type { AwgNode } from "../../core/types.js";
import type { ParsedArgs } from "../args.js";

const schemaNames = ["node", "edge", "event", "view", "lens", "response", "policy", "operation"];

export async function initCommand(parsed: ParsedArgs): Promise<void> {
  const root = process.cwd();
  const awg = path.join(root, ".awg");
  if (await exists(awg)) {
    if (!parsed.flags.force) throw new Error(".awg already exists. Use --force to reinitialize.");
    await fs.rm(awg, { recursive: true, force: true });
  }

  for (const dir of [
    ".awg/log",
    ".awg/compiled/indexes",
    ".awg/compiled/lenses",
    ".awg/compiled/views",
    ".awg/compiled/reports",
    ".awg/compiled/site",
    ".awg/schema/core"
  ]) await fs.mkdir(path.join(root, dir), { recursive: true });

  await fs.writeFile(path.join(root, ".awg/config.json"), stableStringify({
    awg: AWG_VERSION,
    project: { title: path.basename(root) },
    validation: { allow_unknown_node_types: true, strict_links: false },
    storage: { adapter: "file", canonical: ".awg/log/**/*.awg.jsonl" }
  }));
  await fs.writeFile(path.join(root, ".awg/AGENTS.md"), agentsTemplate());
  for (const name of schemaNames) await fs.writeFile(path.join(root, ".awg/schema/core", `${name}.schema.json`), stableStringify(schemaForFile(name)));

  if (!parsed.flags.empty) await writeStarterLog(root);
  if (await isAwgSourceRepo(root)) await writeSourceRepoDocs(root);
  console.log("Initialized AWG in .awg");
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

async function writeSourceRepoDocs(root: string): Promise<void> {
  const docs = path.join(root, "docs/spec");
  await fs.mkdir(docs, { recursive: true });
  const files: Record<string, string> = {
    "awg-core.md": "# AWG Core\n\nAWG is a local-first semantic graph format for durable agent knowledge. V1 has seven primitives: node, edge, event, view, lens, response, and policy. AWG is not a SaaS, task manager, Obsidian clone, Markdown replacement, codebase-only memory tool, or hosted service.\n\nEvery object carries `awg: \"0.1\"` and `kind`. Durable knowledge is stored as nodes, relationships as typed edges, historical facts as events, human/agent feedback as responses, and maintenance rules as policies. Unknown `x-*` extension fields are preserved. Unknown node types warn by default and can become fatal in strict validation.\n",
    "awg-jsonl.md": "# AWG JSONL\n\nThe canonical V1 backend is append-only JSONL under `.awg/log/YYYY/MM/YYYY-MM-DD.awg.jsonl`. Each non-empty line is one direct AWG object. Compiled files are generated artifacts and are never canonical input. Do not rewrite history to reorganize; append corrective, supersession, archive, or redaction events.\n",
    "awg-compiler.md": "# AWG Compiler\n\nThe compiler deterministically loads config and schemas, reads log files in sorted path order, parses and validates lines, materializes current graph state with last-write-wins upserts, builds indexes, runs diagnostics, and writes compiled artifacts. It never calls an LLM, never requires network access, and exits nonzero on fatal errors.\n",
    "awg-lenses.md": "# AWG Lenses\n\nA lens is compact agent-facing context extraction. V1 generates `.awg/compiled/lenses/resume.json` with important active nodes, open decisions, active tasks and risks, unanswered questions, recent responses, diagnostics summary, and obvious maintenance actions.\n",
    "awg-views.md": "# AWG Views\n\nA view is semantic human-facing presentation intent. V1 generates `.awg/compiled/views/current.json` and a static viewer under `.awg/compiled/site`. Views are not canonical. The renderer owns presentation; agents should not write arbitrary HTML as graph content.\n",
    "awg-diagnostics.md": "# AWG Diagnostics\n\nDiagnostics provide operational trust. V1 reports malformed JSON, schema errors, incompatible duplicate IDs, dangling edges, orphan nodes, duplicate aliases, completed tasks without evidence, stale review dates, unanswered questions, low-confidence active nodes, and related graph-health counts.\n",
    "awg-versioning.md": "# AWG Versioning\n\nV1 uses `awg: \"0.1\"`. Unsupported versions are validation errors until migrations exist. Future versions should preserve JSONL as a stable import/export and migration boundary.\n",
    "awg-future-storage-adapters.md": "# Future Storage Adapters\n\nV1 implements only local files through `AwgStorage`. Future SQLite materialization can support larger local vaults, and future Postgres/API adapters can support remote multi-agent use. Migration should remain JSONL -> database and database -> JSONL exportable. V1 intentionally ships no SQLite, Postgres, daemon, sync, server, MCP server, marketplace, vector search, or LLM calls.\n"
  };
  for (const [name, body] of Object.entries(files)) await fs.writeFile(path.join(docs, name), body);
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

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function isAwgSourceRepo(root: string): Promise<boolean> {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as { name?: string };
    return pkg.name === "agent-work-graph";
  } catch {
    return false;
  }
}
