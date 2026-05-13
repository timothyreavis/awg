import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAwg } from "../src/core/compiler.js";
import { decodeNodeRouteId, graphNeighborhood, kanbanColumnsFor, nodeRoute, queryNodes, renderStaticSite, unsupportedBlockFallback } from "../src/core/renderStaticSite.js";
import { currentSchemaManifest, schemaBodyForFile, schemaContentHash, schemaForFile } from "../src/core/schemas.js";
import type { AwgNode, Diagnostic } from "../src/core/types.js";
import { FileAwgStorage } from "../src/storage/FileAwgStorage.js";
import { stableStringify } from "../src/util/json.js";

const cli = path.resolve("dist/src/cli/index.js");

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "awg-test-"));
}

function run(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: tempHome(), ...env } });
}

function runFail(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  try {
    run(cwd, args, env);
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string };
    return `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
  }
  assert.fail(`Expected command to fail: ${args.join(" ")}`);
}

function tempHome(): string {
  return mkdtempSync(path.join(tmpdir(), "awg-home-"));
}

function readRegistry(home: string): { vaults: Array<{ path: string; name: string; [key: string]: unknown }> } {
  return JSON.parse(readFileSync(path.join(home, ".awg/registry.json"), "utf8"));
}

function initialV1NodeSchemaBody(): string {
  const base = {
    type: "object",
    required: ["awg", "kind"],
    properties: {
      awg: { const: "0.1" },
      kind: { enum: ["node", "edge", "event", "view", "lens", "response", "policy"] }
    },
    additionalProperties: true
  };
  return stableStringify({
    ...base,
    required: ["awg", "kind", "id", "type", "title", "summary", "status", "importance", "confidence", "created_at", "updated_at"],
    properties: {
      ...base.properties,
      kind: { const: "node" },
      id: { type: "string", pattern: "^n:.+" },
      type: { type: "string" },
      title: { type: "string", minLength: 1 },
      summary: { type: "string", minLength: 1 },
      status: { type: "string" },
      importance: { type: "number", minimum: 0, maximum: 1 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      created_at: { type: "string" },
      updated_at: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      aliases: { type: "array", items: { type: "string" } }
    }
  });
}

function node(overrides: Partial<AwgNode> & Pick<AwgNode, "id" | "type" | "title" | "summary" | "status">): AwgNode {
  return {
    awg: "0.1",
    kind: "node",
    importance: 0.5,
    confidence: 0.8,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

test("init creates expected files", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  assert.ok(readFileSync(path.join(cwd, "AGENTS.md"), "utf8").includes("durable project memory"));
  assert.ok(readFileSync(path.join(cwd, "CLAUDE.md"), "utf8").includes("Follow the project instructions in `AGENTS.md`"));
  assert.ok(readFileSync(path.join(cwd, ".awg/config.json"), "utf8").includes('"awg"'));
  assert.ok(readFileSync(path.join(cwd, ".awg/AGENTS.md"), "utf8").includes("awg run start"));
  assert.ok(readFileSync(path.join(cwd, ".awg/schema/core/node.schema.json"), "utf8").includes('"kind"'));
  assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, ".awg/schema/core/.awg-managed.json"), "utf8")), currentSchemaManifest());
});

test("packaged schemas match runtime schema source", () => {
  for (const name of ["node", "edge", "event", "view", "lens", "response", "policy", "operation"]) {
    const packaged = JSON.parse(readFileSync(path.join("schemas/core", `${name}.schema.json`), "utf8"));
    assert.deepEqual(packaged, schemaForFile(name));
  }
});

test("example compiled viewer is current", () => {
  const cwd = tmp();
  cpSync(path.resolve("examples/basic"), cwd, { recursive: true });
  const files = [
    ".awg/compiled/graph.json",
    ".awg/compiled/lenses/resume.json",
    ".awg/compiled/reports/diagnostics.json",
    ".awg/compiled/site/index.html",
    ".awg/compiled/site/app.js",
    ".awg/compiled/site/style.css",
    ".awg/compiled/views/current.json"
  ];
  const before = files.map((file) => readFileSync(path.join(cwd, file), "utf8"));
  run(cwd, ["build"]);
  const after = files.map((file) => readFileSync(path.join(cwd, file), "utf8"));
  assert.deepEqual(after, before);
});

test("packed package installs and exposes the awg bin", () => {
  const packDir = tmp();
  const installDir = tmp();
  const output = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], { cwd: path.resolve("."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const packed = JSON.parse(output) as Array<{ filename: string }>;
  const tarball = path.join(packDir, packed[0].filename);
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball], { cwd: installDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const help = execFileSync(path.join(installDir, "node_modules/.bin/awg"), ["--help"], { cwd: installDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.ok(help.includes("awg <command>"));
});

test("setup creates global config and registry in temp home", () => {
  const cwd = tmp();
  const home = tempHome();
  run(cwd, ["setup", "--yes"], { HOME: home });
  assert.ok(readFileSync(path.join(home, ".awg/config.json"), "utf8").includes('"networking": false'));
  assert.deepEqual(readRegistry(home).vaults, []);
});

test("setup is idempotent and does not clobber registry", () => {
  const cwd = tmp();
  const home = tempHome();
  run(cwd, ["setup", "--yes"], { HOME: home });
  writeFileSync(path.join(home, ".awg/registry.json"), JSON.stringify({ version: "0.1", vaults: [{ id: "vault:x", name: "Kept", path: "/tmp/kept/.awg", scope: "project", registeredAt: "a", lastSeenAt: "b", tags: ["x"], favorite: true, extra: true }] }, null, 2));
  run(cwd, ["setup", "--yes"], { HOME: home });
  const registry = readRegistry(home);
  assert.equal(registry.vaults.length, 1);
  assert.equal(registry.vaults[0].name, "Kept");
});

test("setup refuses symlinked global registry files", () => {
  const cwd = tmp();
  const home = tempHome();
  const outside = path.join(tmp(), "registry.json");
  mkdirSync(path.join(home, ".awg"), { recursive: true });
  writeFileSync(outside, JSON.stringify({ version: "0.1", vaults: [] }, null, 2));
  symlinkSync(outside, path.join(home, ".awg/registry.json"));
  const output = runFail(cwd, ["setup", "--yes"], { HOME: home });
  assert.ok(output.includes("Refusing to access symlink"));
  assert.equal(readFileSync(outside, "utf8"), JSON.stringify({ version: "0.1", vaults: [] }, null, 2));
});

test("setup --no-instructions still registers a nearby project vault", () => {
  const parent = tmp();
  const child = path.join(parent, "child");
  const home = tempHome();
  run(parent, ["init", "--empty"], { HOME: home });
  mkdirSync(child);
  run(child, ["setup", "--yes", "--no-instructions"], { HOME: home });
  assert.equal(readRegistry(home).vaults.length, 1);
});

test("setup --no-register-current skips nearby project registration", () => {
  const parent = tmp();
  const child = path.join(parent, "child");
  const home = tempHome();
  run(parent, ["init", "--empty"], { HOME: home });
  mkdirSync(child);
  run(child, ["setup", "--yes", "--no-register-current"], { HOME: home });
  assert.equal(readRegistry(home).vaults.length, 0);
});

test("init does not overwrite existing root AGENTS.md", () => {
  const cwd = tmp();
  writeFileSync(path.join(cwd, "AGENTS.md"), "# Existing\n\nKeep this.\n");
  run(cwd, ["init", "--empty"]);
  assert.equal(readFileSync(path.join(cwd, "AGENTS.md"), "utf8"), "# Existing\n\nKeep this.\n");
});

test("init does not duplicate existing lowercase agent instruction files", () => {
  const cwd = tmp();
  writeFileSync(path.join(cwd, "agents.md"), "# Existing\n\nKeep this.\n");
  writeFileSync(path.join(cwd, "claude.md"), "# Existing Claude\n\nKeep this too.\n");
  run(cwd, ["init", "--empty"]);
  assert.ok(!readdirSync(cwd).includes("AGENTS.md"));
  assert.ok(!readdirSync(cwd).includes("CLAUDE.md"));
  assert.equal(readFileSync(path.join(cwd, "agents.md"), "utf8"), "# Existing\n\nKeep this.\n");
  assert.equal(readFileSync(path.join(cwd, "claude.md"), "utf8"), "# Existing Claude\n\nKeep this too.\n");
});

test("init does not overwrite existing CLAUDE.md", () => {
  const cwd = tmp();
  writeFileSync(path.join(cwd, "CLAUDE.md"), "# Existing Claude\n\nKeep this.\n");
  run(cwd, ["init", "--empty"]);
  assert.equal(readFileSync(path.join(cwd, "CLAUDE.md"), "utf8"), "# Existing Claude\n\nKeep this.\n");
});

test("init-created CLAUDE.md points to existing lowercase agents.md", () => {
  const cwd = tmp();
  writeFileSync(path.join(cwd, "agents.md"), "# Existing\n\nKeep this.\n");
  run(cwd, ["init", "--empty"]);
  const claude = readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
  assert.ok(claude.includes("`agents.md`"));
  assert.ok(!claude.includes("`AGENTS.md`"));
});

test("init is safe to rerun on existing AWG project", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  writeFileSync(path.join(cwd, "AGENTS.md"), "# Existing\n\nKeep this.\n");
  writeFileSync(path.join(cwd, "CLAUDE.md"), "# Existing Claude\n\nKeep this.\n");
  run(cwd, ["init"]);
  assert.equal(readFileSync(path.join(cwd, "AGENTS.md"), "utf8"), "# Existing\n\nKeep this.\n");
  assert.equal(readFileSync(path.join(cwd, "CLAUDE.md"), "utf8"), "# Existing Claude\n\nKeep this.\n");
});

test("init backfills schema manifest without clobbering custom schemas", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const schemaFile = path.join(cwd, ".awg/schema/core/node.schema.json");
  const manifestFile = path.join(cwd, ".awg/schema/core/.awg-managed.json");
  rmSync(manifestFile);
  writeFileSync(schemaFile, JSON.stringify({ custom: true }, null, 2));
  run(cwd, ["init", "--empty"]);
  assert.deepEqual(JSON.parse(readFileSync(schemaFile, "utf8")), { custom: true });
  assert.deepEqual(JSON.parse(readFileSync(manifestFile, "utf8")), currentSchemaManifest());
});

test("init repairs missing schema directory in an otherwise plausible vault", () => {
  const cwd = tmp();
  mkdirSync(path.join(cwd, ".awg/log"), { recursive: true });
  writeFileSync(path.join(cwd, ".awg/config.json"), JSON.stringify({
    awg: "0.1",
    project: { title: "Partial" },
    validation: { allow_unknown_node_types: true, strict_links: false },
    storage: { adapter: "file", canonical: ".awg/log/**/*.awg.jsonl" }
  }, null, 2));
  run(cwd, ["init", "--empty"]);
  assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, ".awg/schema/core/node.schema.json"), "utf8")), schemaForFile("node"));
  assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, ".awg/schema/core/.awg-managed.json"), "utf8")), currentSchemaManifest());
});

test("init completes a partial .awg without clobbering existing instruction snippets", () => {
  const cwd = tmp();
  const home = tempHome();
  mkdirSync(path.join(cwd, ".awg/instructions"), { recursive: true });
  writeFileSync(path.join(cwd, ".awg/instructions/antigravity.md"), "# User rules\n\nKeep this.\n");
  run(cwd, ["setup", "--yes"], { HOME: home });
  run(cwd, ["init", "--empty"], { HOME: home });
  assert.ok(readFileSync(path.join(cwd, ".awg/config.json"), "utf8").includes('"awg"'));
  assert.ok(readFileSync(path.join(cwd, ".awg/AGENTS.md"), "utf8").includes("awg run start"));
  assert.equal(readFileSync(path.join(cwd, ".awg/instructions/antigravity.md"), "utf8"), "# User rules\n\nKeep this.\n");
  assert.equal(readRegistry(home).vaults.length, 1);
});

test("register adds a vault and does not duplicate same vault", () => {
  const cwd = tmp();
  const home = tempHome();
  run(cwd, ["init", "--empty"], { HOME: home });
  run(cwd, ["setup", "--yes"], { HOME: home });
  run(cwd, ["register", "--name", "One"], { HOME: home });
  run(cwd, ["register", "--name", "One"], { HOME: home });
  const registry = readRegistry(home);
  assert.equal(registry.vaults.length, 1);
  assert.equal(registry.vaults[0].name, "One");
  assert.equal(registry.vaults[0].path, realpathSync(path.join(cwd, ".awg")));
});

test("register refuses symlinked global registry files", () => {
  const cwd = tmp();
  const home = tempHome();
  const outside = path.join(tmp(), "registry.json");
  run(cwd, ["init", "--empty"], { HOME: home });
  mkdirSync(path.join(home, ".awg"), { recursive: true });
  writeFileSync(outside, JSON.stringify({ version: "0.1", vaults: [] }, null, 2));
  symlinkSync(outside, path.join(home, ".awg/registry.json"));
  const output = runFail(cwd, ["register"], { HOME: home });
  assert.ok(output.includes("Refusing to access symlink"));
  assert.deepEqual(JSON.parse(readFileSync(outside, "utf8")).vaults, []);
});

test("register and unregister work from a project subdirectory", () => {
  const cwd = tmp();
  const subdir = path.join(cwd, "src");
  const home = tempHome();
  mkdirSync(subdir);
  run(cwd, ["setup", "--yes"], { HOME: home });
  run(cwd, ["init", "--empty"], { HOME: home });
  run(subdir, ["register", "--name", "Subdir"], { HOME: home });
  let registry = readRegistry(home);
  assert.equal(registry.vaults.length, 1);
  assert.equal(registry.vaults[0].name, "Subdir");
  run(subdir, ["unregister"], { HOME: home });
  registry = readRegistry(home);
  assert.equal(registry.vaults.length, 0);
});

test("unregister removes a vault", () => {
  const cwd = tmp();
  const home = tempHome();
  run(cwd, ["setup", "--yes"], { HOME: home });
  run(cwd, ["init", "--empty"], { HOME: home });
  assert.equal(readRegistry(home).vaults.length, 1);
  run(cwd, ["unregister"], { HOME: home });
  assert.equal(readRegistry(home).vaults.length, 0);
});

test("init registers by default when global setup exists", () => {
  const cwd = tmp();
  const home = tempHome();
  run(cwd, ["setup", "--yes"], { HOME: home });
  run(cwd, ["init", "--empty"], { HOME: home });
  assert.equal(readRegistry(home).vaults.length, 1);
});

test("init --no-register does not register", () => {
  const cwd = tmp();
  const home = tempHome();
  run(cwd, ["setup", "--yes"], { HOME: home });
  run(cwd, ["init", "--empty", "--no-register"], { HOME: home });
  assert.equal(readRegistry(home).vaults.length, 0);
});

test("vault list works with registered vaults", () => {
  const cwd = tmp();
  const home = tempHome();
  run(cwd, ["setup", "--yes"], { HOME: home });
  run(cwd, ["init", "--empty"], { HOME: home });
  const output = run(cwd, ["vault", "list"], { HOME: home });
  assert.ok(output.includes(realpathSync(path.join(cwd, ".awg"))));
});

test("vault list missing and prune are isolated to temp home", () => {
  const cwd = tmp();
  const home = tempHome();
  run(cwd, ["setup", "--yes"], { HOME: home });
  run(cwd, ["init", "--empty"], { HOME: home });
  const missing = path.join(tmp(), "gone", ".awg");
  const invalid = path.join(tmp(), "invalid", ".awg");
  mkdirSync(invalid, { recursive: true });
  const registryFile = path.join(home, ".awg/registry.json");
  const registry = readRegistry(home);
  registry.vaults.push({ id: "vault:missing", name: "Missing", path: missing, scope: "project", registeredAt: "a", lastSeenAt: "b", tags: [], favorite: false });
  registry.vaults.push({ id: "vault:invalid", name: "Invalid", path: invalid, scope: "project", registeredAt: "a", lastSeenAt: "b", tags: [], favorite: false });
  writeFileSync(registryFile, JSON.stringify(registry, null, 2));
  const listed = JSON.parse(run(cwd, ["vault", "list", "--missing", "--json"], { HOME: home }));
  assert.deepEqual(listed.vaults.map((vault: { name: string }) => vault.name).sort(), ["Invalid", "Missing"]);
  run(cwd, ["vault", "prune", "--dry-run"], { HOME: home });
  assert.equal(readRegistry(home).vaults.length, 3);
  const dry = JSON.parse(run(cwd, ["vault", "prune", "--dry-run", "--json"], { HOME: home }));
  assert.equal(dry.pruned.length, 0);
  assert.equal(dry.skipped.length, 2);
  const pruned = JSON.parse(run(cwd, ["vault", "prune", "--yes", "--json"], { HOME: home }));
  assert.equal(pruned.pruned.length, 1);
  assert.equal(pruned.skipped.length, 1);
  assert.equal(readRegistry(home).vaults.length, 2);
});

test("open outside vault handles missing and empty registry", () => {
  const cwd = tmp();
  const home = tempHome();
  const output = run(cwd, ["open", "--global", "--no-launch"], { HOME: home });
  assert.ok(output.includes(path.join(home, ".awg/compiled/switcher/index.html")));
  assert.ok(existsSync(path.join(home, ".awg/compiled/switcher/index.html")));
});

test("open global refuses symlinked global compiled directories", () => {
  const cwd = tmp();
  const home = tempHome();
  const outside = tmp();
  mkdirSync(path.join(home, ".awg"), { recursive: true });
  symlinkSync(outside, path.join(home, ".awg/compiled"));
  const output = runFail(cwd, ["open", "--global", "--no-launch"], { HOME: home });
  assert.ok(output.includes("Refusing to access symlink"));
  assert.equal(existsSync(path.join(outside, "switcher")), false);
});

test("open refuses symlinked project viewer files", () => {
  const cwd = tmp();
  const outside = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["build"]);
  rmSync(path.join(cwd, ".awg/compiled/site/index.html"));
  writeFileSync(path.join(outside, "index.html"), "<!doctype html><title>outside</title>");
  symlinkSync(path.join(outside, "index.html"), path.join(cwd, ".awg/compiled/site/index.html"));
  const output = runFail(cwd, ["open", "--no-launch"]);
  assert.ok(output.includes("Refusing to access symlink"));
});

test("compiled reads refuse symlinked artifacts", async () => {
  const cwd = tmp();
  const outside = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["build"]);
  rmSync(path.join(cwd, ".awg/compiled/views/current.json"));
  writeFileSync(path.join(outside, "current.json"), "{}");
  symlinkSync(path.join(outside, "current.json"), path.join(cwd, ".awg/compiled/views/current.json"));
  await assert.rejects(() => new FileAwgStorage(cwd).readCompiledArtifact("views/current.json"), /Refusing to access symlink/);
});

test("add node writes valid JSONL", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--type", "concept", "--title", "Test concept", "--summary", "A test concept."]);
  const entries = new FileAwgStorage(cwd).readLogEntries();
  return entries.then((lines) => {
    assert.equal(lines.length, 1);
    const node = JSON.parse(lines[0].raw);
    assert.equal(node.kind, "node");
    assert.equal(node.type, "concept");
  });
});

test("add commands emit stable json", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const node = JSON.parse(run(cwd, ["add", "node", "--id", "n:json", "--type", "task", "--title", "JSON task", "--summary", "JSON task.", "--json"]));
  assert.equal(node.ok, true);
  assert.equal(node.nodeId, "n:json");
  const edge = JSON.parse(run(cwd, ["add", "edge", "--from", "n:json", "--rel", "relates_to", "--to", "n:json", "--json"]));
  assert.ok(edge.edgeId.startsWith("e:"));
  const response = JSON.parse(run(cwd, ["add", "response", "--type", "note", "--target", "n:json", "--summary", "Human response.", "--json"]));
  assert.equal(response.ok, true);
  assert.ok(runFail(cwd, ["add", "node", "--type", "task", "--title", "Bad", "--summary", "Bad.", "--status", "not-real", "--json"]).includes("--status must be one of"));
  assert.ok(runFail(cwd, ["add", "node", "--id", "bad", "--type", "task", "--title", "Bad", "--summary", "Bad.", "--json"]).includes("--id for node must start with n:"));
  assert.ok(runFail(cwd, ["add", "edge", "--from", "n:json", "--rel", "not_real", "--to", "n:json", "--json"]).includes("--rel must be one of"));
  assert.ok(runFail(cwd, ["add", "edge", "--from", "bad", "--rel", "relates_to", "--to", "n:json", "--json"]).includes("--from must be a node id starting with n:"));
  assert.ok(runFail(cwd, ["add", "edge", "--from", "n:json", "--rel", "relates_to", "--to", "bad", "--json"]).includes("--to must be a node id starting with n:"));
});

test("search finds id title summary and filters deterministically", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:upgrade-task", "--type", "task", "--title", "Implement upgrade command", "--summary", "Build the CLI upgrade command.", "--status", "in_progress", "--tag", "cli"]);
  run(cwd, ["add", "node", "--id", "n:registry-decision", "--type", "decision", "--title", "Registry strategy", "--summary", "Upgrade should prune missing vaults.", "--status", "active"]);
  let parsed = JSON.parse(run(cwd, ["search", "upgrade", "--json"]));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.results.map((item: { id: string }) => item.id), ["n:upgrade-task", "n:registry-decision"]);
  parsed = JSON.parse(run(cwd, ["search", "upgrade", "--type", "task", "--status", "in_progress", "--tag", "cli", "--json"]));
  assert.deepEqual(parsed.results.map((item: { id: string }) => item.id), ["n:upgrade-task"]);
  assert.ok(run(cwd, ["search", "n:upgrade-task"]).includes("n:upgrade-task"));
});

test("update node appends an upsert and event without touching compiled source", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:update", "--type", "task", "--title", "Update", "--summary", "Old.", "--tag", "old"]);
  run(cwd, ["build"]);
  const compiledBefore = readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8");
  const output = JSON.parse(run(cwd, ["update", "node", "n:update", "--summary", "New.", "--status", "completed", "--tag", "new", "--anchor", "url:https://example.com/a:b", "--json"]));
  assert.equal(output.ok, true);
  assert.equal(output.nodeId, "n:update");
  assert.ok(output.eventId);
  assert.equal(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"), compiledBefore);
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  const node = graph.nodes.find((item: { id: string }) => item.id === "n:update");
  assert.equal(node.summary, "New.");
  assert.equal(node.status, "completed");
  assert.deepEqual(node.tags, ["new", "old"]);
  assert.deepEqual(node.anchors, [{ kind: "url", url: "https://example.com/a:b" }]);
  assert.ok(graph.events.some((event: { type: string; target: string }) => event.type === "node_updated" && event.target === "n:update"));
  assert.ok(!graph.diagnostics.diagnostics.some((diag: { code: string; id: string }) => diag.code === "duplicate_id_upsert" && diag.id === "n:update"));
  assert.ok((await new FileAwgStorage(cwd).readLogEntries()).length >= 3);
  assert.ok(runFail(cwd, ["update", "node", "n:update", "--status", "not-real"]).includes("--status must be one of"));
  assert.ok(runFail(cwd, ["update", "node", "n:missing", "--status", "active"]).includes("Node not found"));
});

test("manual duplicate node upserts still warn unless paired with update event", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:dupe", "--type", "task", "--title", "Duplicate", "--summary", "First."]);
  run(cwd, ["add", "node", "--id", "n:dupe", "--type", "task", "--title", "Duplicate", "--summary", "Second."]);
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.ok(graph.diagnostics.diagnostics.some((diag: { code: string; id: string }) => diag.code === "duplicate_id_upsert" && diag.id === "n:dupe"));
});

test("manual duplicate node still warns after a legitimate update event", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:mixed-dupe", "--type", "task", "--title", "Mixed", "--summary", "First."]);
  run(cwd, ["update", "node", "n:mixed-dupe", "--summary", "Intentional update."]);
  run(cwd, ["add", "node", "--id", "n:mixed-dupe", "--type", "task", "--title", "Mixed", "--summary", "Manual duplicate."]);
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.ok(graph.diagnostics.diagnostics.some((diag: { code: string; id: string }) => diag.code === "duplicate_id_upsert" && diag.id === "n:mixed-dupe"));
});

test("add evidence creates evidence node edge and satisfies completed task evidence warning", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:done", "--type", "task", "--title", "Done", "--summary", "Done.", "--status", "completed"]);
  assert.ok(run(cwd, ["doctor", "--json"]).includes("completed_task_without_evidence"));
  const added = JSON.parse(run(cwd, ["add", "evidence", "--target", "n:done", "--summary", "npm test passed.", "--source", "terminal", "--command", "npm test", "--status", "passed", "--json"]));
  assert.equal(added.ok, true);
  assert.ok(added.evidenceNodeId.startsWith("n:"));
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.ok(graph.nodes.some((node: { id: string; type: string }) => node.id === added.evidenceNodeId && node.type === "evidence"));
  assert.ok(graph.edges.some((edge: { from: string; to: string; rel: string }) => edge.from === added.evidenceNodeId && edge.to === "n:done" && edge.rel === "supports"));
  assert.equal(graph.diagnostics.summary.unverified_completion_count, 0);
  assert.ok(runFail(cwd, ["add", "evidence", "--target", "n:done", "--summary", "Bad rel.", "--rel", "not_real"]).includes("--rel must be one of"));
  assert.ok(runFail(cwd, ["add", "evidence", "--target", "n:done", "--summary", "Bad source.", "--source", "network"]).includes("--source must be one of"));
  assert.ok(runFail(cwd, ["add", "evidence", "--target", "n:done", "--summary", "Bad status.", "--status", "maybe"]).includes("--status must be one of"));
  assert.ok(runFail(cwd, ["add", "evidence", "--target", "n:missing", "--summary", "Nope."]).includes("Target node not found"));
});

test("task lens and handoff include scoped context and respect budgets", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:task-a", "--type", "task", "--title", "Implement upgrade command", "--summary", "Build upgrade.", "--status", "in_progress", "--importance", "0.9"]);
  run(cwd, ["add", "node", "--id", "n:risk-a", "--type", "risk", "--title", "Upgrade risk", "--summary", "Schema compatibility risk.", "--status", "active"]);
  run(cwd, ["add", "node", "--id", "n:unrelated", "--type", "task", "--title", "Unrelated", "--summary", "Other work.", "--status", "active"]);
  run(cwd, ["add", "edge", "--from", "n:task-a", "--rel", "blocks", "--to", "n:risk-a"]);
  run(cwd, ["add", "evidence", "--target", "n:task-a", "--summary", "Focused test evidence.", "--status", "passed"]);
  const lens = JSON.parse(run(cwd, ["lens", "task", "--goal", "upgrade command", "--budget", "900", "--json"]));
  assert.equal(lens.id, "lens:task");
  assert.ok(lens.sections.find((section: { section: string }) => section.section === "matches").items.some((item: { id: string }) => item.id === "n:task-a"));
  assert.ok(JSON.stringify(lens).includes("n:risk-a"));
  assert.ok(!JSON.stringify(lens).includes("n:unrelated"));
  assert.ok(lens.sections.some((section: { omitted: number }) => typeof section.omitted === "number"));
  const handoff = JSON.parse(run(cwd, ["handoff", "--budget", "1000", "--json"]));
  assert.equal(handoff.kind, "handoff");
  assert.ok(JSON.stringify(handoff).includes("activeTasks"));
  assert.ok(JSON.stringify(handoff).includes("recentEvidence"));
  const tinyHandoff = run(cwd, ["handoff", "--budget", "200", "--json"]);
  assert.ok(tinyHandoff.length < 1800);
  const tinyParsed = JSON.parse(tinyHandoff);
  assert.ok(["activeRun", "mostRecentRun", "graphHealth"].includes(tinyParsed.sections[0].section));
  assert.ok(tinyParsed.sections.some((section: { omitted: number }) => section.omitted > 0));
  assert.ok(run(cwd, ["handoff", "--budget", "600"]).includes("AWG handoff"));
});

test("run commands track start note finish status and list with json", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const started = JSON.parse(run(cwd, ["run", "start", "--goal", "Test run loop", "--agent", "codex", "--json"]));
  assert.equal(started.ok, true);
  assert.ok(started.runId.startsWith("run:"));
  assert.equal(started.run.status, "in_progress");
  assert.ok(runFail(cwd, ["run", "start", "--goal", "Second"]).includes("Active run already exists"));
  const noted = JSON.parse(run(cwd, ["run", "note", "Created a useful note.", "--json"]));
  assert.equal(noted.runId, started.runId);
  assert.equal(noted.note.summary, "Created a useful note.");
  run(cwd, ["add", "node", "--id", "n:run-task", "--type", "task", "--title", "Run task", "--summary", "Run task.", "--status", "in_progress"]);
  run(cwd, ["update", "node", "n:run-task", "--status", "completed"]);
  run(cwd, ["add", "evidence", "--target", "n:run-task", "--summary", "Evidence during active run.", "--status", "passed"]);
  const status = JSON.parse(run(cwd, ["run", "status", "--json"]));
  assert.equal(status.activeRun.id, started.runId);
  assert.equal(status.activeRun.notes[0].summary, "Created a useful note.");
  assert.equal(status.activeRun.changed_nodes[0], "n:run-task");
  assert.equal(status.activeRun.evidence.length, 1);
  const finished = JSON.parse(run(cwd, ["run", "finish", "--status", "completed", "--summary", "Finished cleanly.", "--auto-handoff", "--json"]));
  assert.equal(finished.runId, started.runId);
  assert.equal(finished.status, "completed");
  const after = JSON.parse(run(cwd, ["run", "status", "--json"]));
  assert.equal(after.activeRun, null);
  const listed = JSON.parse(run(cwd, ["run", "list", "--json"]));
  assert.equal(listed.runs[0].id, started.runId);
  assert.equal(listed.runs[0].summary, "Finished cleanly.");
  assert.ok(runFail(cwd, ["run", "note", "No active"]).includes("No active run"));
  assert.ok(runFail(cwd, ["run", "finish", "--run", "run:missing", "--status", "completed"]).includes("Run not found"));
});

test("write commands attribute durable writes to active explicit and suppressed runs", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const started = JSON.parse(run(cwd, ["run", "start", "--goal", "Attribution", "--json"]));
  run(cwd, ["add", "node", "--id", "n:attr-task", "--type", "task", "--title", "Attr task", "--summary", "Attributed.", "--status", "in_progress"]);
  run(cwd, ["add", "edge", "--from", "n:attr-task", "--rel", "relates_to", "--to", "n:attr-task"]);
  run(cwd, ["add", "response", "--type", "note", "--target", "n:attr-task", "--summary", "Attributed response."]);
  run(cwd, ["update", "node", "n:attr-task", "--status", "completed"]);
  run(cwd, ["add", "evidence", "--target", "n:attr-task", "--summary", "Attributed evidence.", "--status", "passed"]);
  run(cwd, ["add", "node", "--id", "n:no-run", "--type", "task", "--title", "No run", "--summary", "Suppressed.", "--no-run"]);
  run(cwd, ["run", "start", "--goal", "Second active run", "--force"]);
  run(cwd, ["add", "node", "--id", "n:explicit-run", "--type", "task", "--title", "Explicit run", "--summary", "Explicit.", "--run", started.runId]);
  assert.ok(runFail(cwd, ["add", "node", "--id", "n:bad-run", "--type", "task", "--title", "Bad run", "--summary", "Bad.", "--run", "run:missing"]).includes("Run not found"));
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.equal(graph.nodes.find((node: { id: string }) => node.id === "n:attr-task").run, started.runId);
  assert.equal(graph.nodes.find((node: { id: string }) => node.id === "n:no-run").run, undefined);
  assert.equal(graph.nodes.find((node: { id: string }) => node.id === "n:explicit-run").run, started.runId);
  const summary = graph.run_summaries.find((item: { runId: string }) => item.runId === started.runId);
  assert.ok(summary.createdNodeIds.includes("n:attr-task"));
  assert.ok(summary.updatedNodeIds.includes("n:attr-task"));
  assert.ok(summary.touchedNodeIds.includes("n:attr-task"));
  assert.ok(summary.responseIds.length >= 1);
  assert.ok(summary.evidenceTargetIds.includes("n:attr-task"));
  assert.ok(summary.completedNodeIds.includes("n:attr-task"));
});

test("run finish preflight requires force for dirty completed runs and auto-handoff records quality", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const started = JSON.parse(run(cwd, ["run", "start", "--goal", "Dirty finish", "--json"]));
  run(cwd, ["add", "node", "--id", "n:dirty-task", "--type", "task", "--title", "Dirty task", "--summary", "No evidence.", "--status", "completed"]);
  const blocked = JSON.parse(runFail(cwd, ["run", "finish", "--status", "completed", "--summary", "Dirty.", "--json"]));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.forceRequired, true);
  assert.ok(blocked.preflight.warnings.some((warning: { code: string }) => warning.code === "AWG_RUN_COMPLETED_TASK_WITHOUT_EVIDENCE"));
  const forced = JSON.parse(run(cwd, ["run", "finish", "--status", "completed", "--summary", "Dirty forced.", "--auto-handoff", "--force", "--json"]));
  assert.equal(forced.ok, true);
  assert.equal(forced.runId, started.runId);
  assert.ok(forced.handoff.quality.score < 100);
  assert.equal(forced.handoff.quality.checks.find((check: { id: string }) => check.id === "doctor_clean_for_touched_nodes").ok, false);
  assert.ok(forced.handoff.sections.some((section: { section: string }) => section.section === "preflightWarnings"));
  const listed = JSON.parse(run(cwd, ["run", "list", "--json"]));
  assert.ok(listed.runs[0].handoffs.length >= 1);
});

test("doctor fix suggestions are structured conservative and non-mutating", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:needs-evidence", "--type", "task", "--title", "Needs evidence", "--summary", "Done.", "--status", "completed"]);
  const before = await new FileAwgStorage(cwd).readLogEntries();
  const doctor = JSON.parse(run(cwd, ["doctor", "--fix-suggestions", "--json"]));
  assert.ok(doctor.fixSuggestions.some((suggestion: { code: string; suggestedCommands: string[] }) => suggestion.code === "AWG_HEALTH_COMPLETED_WITHOUT_EVIDENCE" && suggestion.suggestedCommands[0].includes("awg add evidence")));
  const after = await new FileAwgStorage(cwd).readLogEntries();
  assert.equal(after.length, before.length);
});

test("handoff and recent include run context", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const started = JSON.parse(run(cwd, ["run", "start", "--goal", "Upgrade handoff", "--agent", "codex", "--json"]));
  run(cwd, ["run", "note", "Investigated handoff context."]);
  run(cwd, ["add", "node", "--id", "n:handoff-task", "--type", "task", "--title", "Upgrade handoff", "--summary", "Improve handoff.", "--status", "in_progress"]);
  const handoff = JSON.parse(run(cwd, ["handoff", "--budget", "1400", "--json"]));
  assert.equal(handoff.kind, "handoff");
  assert.ok(JSON.stringify(handoff).includes(started.runId));
  assert.ok(JSON.stringify(handoff).includes("recentRunNotes"));
  assert.ok(JSON.stringify(handoff).includes("activeTasks"));
  const recent = JSON.parse(run(cwd, ["recent", "--days", "7", "--run", started.runId, "--json"]));
  assert.equal(recent.kind, "recent");
  assert.equal(recent.runs[0].id, started.runId);
  assert.equal(recent.run_notes[0].summary, "Investigated handoff context.");
});

test("handoff json records handoff event without breaking parseable output", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const started = JSON.parse(run(cwd, ["run", "start", "--goal", "JSON handoff", "--json"]));
  run(cwd, ["run", "finish", "--status", "partial", "--summary", "Stopped after JSON handoff prep."]);
  const handoff = JSON.parse(run(cwd, ["handoff", "--json"]));
  assert.equal(handoff.kind, "handoff");
  const list = JSON.parse(run(cwd, ["run", "list", "--json"]));
  assert.equal(list.runs[0].id, started.runId);
  assert.equal(list.runs[0].handoffs.length, 1);
  run(cwd, ["run", "start", "--goal", "No record handoff", "--force"]);
  run(cwd, ["run", "finish", "--status", "partial", "--summary", "Stopped without recorded handoff."]);
  JSON.parse(run(cwd, ["handoff", "--json", "--no-record"]));
  const after = JSON.parse(run(cwd, ["run", "list", "--json"]));
  assert.equal(after.runs[0].handoffs.length, 0);
});

test("resume lens budget json remains parseable with omitted counts", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  for (let i = 0; i < 8; i += 1) run(cwd, ["add", "node", "--id", `n:item-${i}`, "--type", "task", "--title", `Item ${i}`, "--summary", "Budget item.", "--importance", "0.9"]);
  run(cwd, ["build"]);
  const lens = JSON.parse(run(cwd, ["lens", "resume", "--budget", "500", "--json"]));
  assert.equal(lens.id, "lens:resume");
  assert.ok(typeof lens.important_omitted === "number");
});

test("recent command reports recent nodes and evidence", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:recent", "--type", "task", "--title", "Recent", "--summary", "Recent.", "--status", "completed"]);
  run(cwd, ["add", "evidence", "--target", "n:recent", "--summary", "Recent evidence.", "--status", "passed"]);
  const recent = JSON.parse(run(cwd, ["recent", "--days", "7", "--json"]));
  assert.equal(recent.kind, "recent");
  assert.ok(recent.nodes.some((node: { id: string }) => node.id === "n:recent"));
  assert.ok(recent.evidence.length >= 1);
  assert.equal(run(cwd, ["recent", "--days", "7", "--json"]), run(cwd, ["recent", "--days", "7", "--json"]));
});

test("doctor reports stale active and completed runs without handoff evidence or changes", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  const old = "2026-01-01T00:00:00.000Z";
  const recent = new Date();
  const recentStart = recent.toISOString();
  const recentFinish = new Date(recent.getTime() + 1000).toISOString();
  writeFileSync(file, [
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:old:start", type: "run_started", target: "run:old", by: "agent:codex", at: old, goal: "Old run" }),
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:done:start", type: "run_started", target: "run:done", by: "agent:codex", at: recentStart, goal: "Done run" }),
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:done:finish", type: "run_finished", target: "run:done", run: "run:done", by: "agent:codex", at: recentFinish, status: "completed", summary: "Done." })
  ].join("\n") + "\n");
  const result = await buildAwg(new FileAwgStorage(cwd), { write: false });
  const codes = result.diagnostics.diagnostics.map((diag) => diag.code);
  assert.ok(codes.includes("stale_active_run"));
  assert.ok(codes.includes("unfinished_run_without_recent_note"));
  assert.ok(codes.includes("completed_run_without_evidence_or_changes"));
  assert.ok(codes.includes("finished_run_without_handoff"));
});

test("realistic agent loop fixture builds and exposes expected handoff diagnostics and search", () => {
  const cwd = tmp();
  cpSync(path.resolve("examples/realistic-agent-loop"), cwd, { recursive: true });
  run(cwd, ["build"]);
  const handoff = JSON.parse(run(cwd, ["handoff", "--budget", "1800", "--json"]));
  const handoffText = JSON.stringify(handoff);
  assert.ok(handoffText.includes("run:fixture-blocked"));
  assert.ok(handoffText.includes("activeTasks"));
  assert.ok(handoffText.includes("openDecisions"));
  assert.ok(handoffText.includes("blockersAndRisks"));
  assert.ok(handoffText.includes("recentEvidence"));
  assert.ok(handoffText.includes("graphHealth"));
  assert.ok(handoff.sections.some((section: { omitted?: number }) => typeof section.omitted === "number"));
  const lens = JSON.parse(run(cwd, ["lens", "task", "--goal", "handoff budget guardrails", "--budget", "2600", "--json"]));
  const lensText = JSON.stringify(lens);
  assert.ok(lensText.includes("n:active-task"));
  assert.ok(lensText.includes("n:fixture-goal"));
  assert.equal(lensText.includes("n:orphan-note"), false);
  const doctor = JSON.parse(run(cwd, ["doctor", "--json"]));
  const codes = doctor.diagnostics.map((diag: { code: string }) => diag.code);
  assert.ok(codes.includes("completed_task_without_evidence"));
  assert.ok(codes.includes("duplicate_alias"));
  assert.ok(codes.includes("orphan_node"));
  assert.ok(codes.includes("decision_implemented_while_proposed"));
  assert.ok(codes.includes("active_risk_with_completed_mitigation"));
  assert.ok(codes.includes("active_blocker_linked_to_resolved_work"));
  const search = JSON.parse(run(cwd, ["search", "handoff budget guardrails", "--json"]));
  assert.ok(search.results.some((item: { id: string }) => item.id === "n:active-task"));
  assert.ok(search.results.some((item: { id: string }) => item.id === "n:duplicate-one"));
  const recent = JSON.parse(run(cwd, ["recent", "--days", "7", "--json"]));
  assert.ok(Array.isArray(recent.runs));
  assert.ok(Array.isArray(recent.run_notes));
});

test("recent command does not call stale historical graph entries recent", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2020/01/2020-01-01.awg.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ awg: "0.1", kind: "node", id: "n:old", type: "task", title: "Old", summary: "Old.", status: "active", importance: 0.5, confidence: 0.8, created_at: "2020-01-01T00:00:00.000Z", updated_at: "2020-01-01T00:00:00.000Z" })}\n`);
  const recent = JSON.parse(run(cwd, ["recent", "--days", "7", "--json"]));
  assert.equal(recent.nodes.some((node: { id: string }) => node.id === "n:old"), false);
});

test("current-vault commands work from a project subdirectory", () => {
  const cwd = tmp();
  const subdir = path.join(cwd, "src");
  mkdirSync(subdir);
  run(cwd, ["init", "--empty"]);
  run(subdir, ["add", "node", "--type", "concept", "--title", "From subdir", "--summary", "Written to parent vault."]);
  assert.equal(existsSync(path.join(subdir, ".awg")), false);
  const entries = new FileAwgStorage(cwd).readLogEntries();
  return entries.then((lines) => {
    assert.equal(lines.length, 1);
    run(subdir, ["build"]);
    run(subdir, ["doctor"]);
    assert.ok(run(subdir, ["lens", "resume"]).includes("1 nodes"));
    assert.ok(run(subdir, ["view", "current", "--text"]).includes("Current Review"));
    assert.equal(run(subdir, ["view", "current"]).trim(), path.join(realpathSync(cwd), ".awg/compiled/site/index.html"));
    assert.ok(existsSync(path.join(cwd, ".awg/compiled/site/index.html")));
  });
});

test("current-vault commands fail clearly outside an initialized project", () => {
  const cwd = tmp();
  const output = runFail(cwd, ["add", "node", "--type", "concept", "--title", "No vault", "--summary", "Should fail."]);
  assert.ok(output.includes("No AWG project vault found"));
  assert.equal(existsSync(path.join(cwd, ".awg")), false);
});

test("global ~/.awg is not treated as a project vault", () => {
  const home = tempHome();
  run(home, ["setup", "--yes"], { HOME: home });
  mkdirSync(path.join(home, ".awg/log"), { recursive: true });
  const output = runFail(home, ["register"], { HOME: home });
  assert.ok(output.includes("No project .awg vault found"));
});

test("init refuses to create a project vault at ~/.awg", () => {
  const home = tempHome();
  run(home, ["setup", "--yes"], { HOME: home });
  const output = runFail(home, ["init"], { HOME: home });
  assert.ok(output.includes("Refusing to initialize a project vault inside ~/.awg"));
  assert.equal(existsSync(path.join(home, ".awg/log")), false);
});

test("init refuses to create a project vault inside ~/.awg", () => {
  const home = tempHome();
  run(home, ["setup", "--yes"], { HOME: home });
  const output = runFail(path.join(home, ".awg"), ["init"], { HOME: home });
  assert.ok(output.includes("Refusing to initialize a project vault inside ~/.awg"));
  assert.equal(existsSync(path.join(home, ".awg/.awg")), false);
});

test("init refuses symlinked managed parent directories", () => {
  const cwd = tmp();
  const outside = tmp();
  mkdirSync(path.join(cwd, ".awg"), { recursive: true });
  symlinkSync(outside, path.join(cwd, ".awg/schema"));
  const output = runFail(cwd, ["init", "--empty"]);
  assert.ok(output.includes("Refusing to access symlink"));
  assert.equal(existsSync(path.join(outside, "core")), false);
});

test("build generates graph and resume lens", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:test", "--type", "concept", "--title", "Test", "--summary", "A test."]);
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  const lens = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/lenses/resume.json"), "utf8"));
  assert.equal(graph.nodes.length, 1);
  assert.equal(lens.kind, "lens-output");
});

test("build refuses symlinked compiled output directories", () => {
  const cwd = tmp();
  const outside = tmp();
  run(cwd, ["init", "--empty"]);
  rmSync(path.join(cwd, ".awg/compiled"), { recursive: true, force: true });
  symlinkSync(outside, path.join(cwd, ".awg/compiled"));
  run(cwd, ["add", "node", "--id", "n:test", "--type", "concept", "--title", "Test", "--summary", "A test."]);
  const output = runFail(cwd, ["build"]);
  assert.ok(output.includes("Refusing to access symlink"));
  assert.equal(existsSync(path.join(outside, "graph.json")), false);
});

test("current-vault commands refuse symlinked .awg vault directories", async () => {
  const cwd = tmp();
  const outside = tmp();
  run(outside, ["init", "--empty"]);
  symlinkSync(path.join(outside, ".awg"), path.join(cwd, ".awg"));
  const output = runFail(cwd, ["add", "node", "--type", "concept", "--title", "Escaped", "--summary", "Should not write outside."]);
  assert.ok(output.includes("No AWG project vault found"));
  const entries = await new FileAwgStorage(outside).readLogEntries();
  assert.equal(entries.length, 0);
});

test("build refuses symlinked canonical log files", () => {
  const cwd = tmp();
  const outside = tmp();
  run(cwd, ["init", "--empty"]);
  const outsideLog = path.join(outside, "outside.awg.jsonl");
  writeFileSync(outsideLog, `${JSON.stringify({ awg: "0.1", kind: "node", id: "n:outside", type: "concept", title: "Outside", summary: "Outside.", status: "active", importance: 0.5, confidence: 0.8, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" })}\n`);
  const logDir = path.join(cwd, ".awg/log/2026/01");
  mkdirSync(logDir, { recursive: true });
  symlinkSync(outsideLog, path.join(logDir, "2026-01-01.awg.jsonl"));
  const output = runFail(cwd, ["build"]);
  assert.ok(output.includes("Refusing to access symlink"));
  assert.equal(existsSync(path.join(cwd, ".awg/compiled/graph.json")), false);
});

test("viewer generation includes route shell and theme assets", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:purpose", "--type", "concept", "--title", "Purpose", "--summary", "Project purpose."]);
  run(cwd, ["build"]);
  const html = readFileSync(path.join(cwd, ".awg/compiled/site/index.html"), "utf8");
  const js = readFileSync(path.join(cwd, ".awg/compiled/site/app.js"), "utf8");
  const css = readFileSync(path.join(cwd, ".awg/compiled/site/style.css"), "utf8");
  assert.ok(html.includes("AWG Surface"));
  for (const route of ["overview", "graph", "kanban", "nodes", "runs", "health", "views", "settings"]) assert.ok(js.includes(`"${route}"`));
  assert.ok(js.includes('"attention-required"'));
  assert.ok(js.includes("query.tags"));
  assert.ok(js.includes("graph-type"));
  assert.ok(js.includes("renderRunsRoute"));
  assert.ok(js.includes("graph.run_summaries"));
  assert.ok(js.includes("Object.prototype.hasOwnProperty.call"));
  assert.ok(js.includes('<article class="node-card">'));
  assert.ok(js.includes("metric-state"));
  assert.ok(js.includes("block-metrics"));
  assert.ok(js.includes("block-compact"));
  assert.ok(js.includes('layout === "compact"'));
  assert.ok(js.includes('"Needs Attention"'));
  assert.ok(js.includes('"Active Work"'));
  assert.ok(js.includes('!["node-list", "summary", "diagnostics", "diagnostic-list"].includes(block.type)'));
  assert.ok(!js.includes('<a class="node-card"'));
  assert.ok(css.includes("--sidebar-bg"));
  assert.ok(css.includes("--nav-active-bg"));
  assert.ok(css.includes("--surface-filter"));
  assert.ok(css.includes("--box-grid-bg"));
  assert.ok(css.includes(".metric-row{display:grid"));
  assert.ok(css.includes(".top-summary{align-self:stretch;display:grid"));
  assert.ok(css.includes(".top-summary .metric{min-height:100%"));
  assert.ok(css.includes(".block-metrics"));
  assert.ok(css.includes(".block{grid-column:1 / -1}"));
  assert.ok(css.includes(".block-compact{grid-column:span 1"));
  assert.ok(css.includes(".column-blocked"));
  assert.ok(css.includes("@media(max-width:640px){.route-root"));
  assert.ok(!css.includes("\n(max-width:640px)"));
  assert.ok(css.includes(':root[data-theme="dark"]'));
});

test("viewer route helpers encode node ids with special characters", () => {
  const id = "n:task/with spaces?x=1";
  const route = nodeRoute(id);
  assert.equal(route, "#/node/n%3Atask%2Fwith%20spaces%3Fx%3D1");
  assert.equal(decodeNodeRouteId(route.replace("#/node/", "")), id);
  assert.equal(decodeNodeRouteId("%"), "%");
});

test("viewer query helper filters by type status and diagnostics", () => {
  const nodes = [
    node({ id: "n:a", type: "task", title: "A", summary: "A.", status: "blocked", importance: 0.9, tags: ["urgent"] }),
    node({ id: "n:b", type: "risk", title: "B", summary: "B.", status: "active", importance: 0.7, tags: ["later"] }),
    node({ id: "n:c", type: "task", title: "C", summary: "C.", status: "completed", importance: 0.4 })
  ];
  const diagnostics: Diagnostic[] = [{ severity: "warning", code: "stale_node", message: "stale", id: "n:a" }];
  assert.deepEqual(queryNodes(nodes, diagnostics, { type: "task", status: "blocked", hasDiagnostics: true }).map((n) => n.id), ["n:a"]);
  assert.deepEqual(queryNodes(nodes, diagnostics, { tags: ["urgent"] }).map((n) => n.id), ["n:a"]);
  assert.deepEqual(queryNodes(nodes, diagnostics, { needsAttention: true }).map((n) => n.id), ["n:a"]);
  assert.deepEqual(queryNodes(nodes, diagnostics, { type: "task", open: true }).map((n) => n.id), ["n:a"]);
  assert.deepEqual(queryNodes(nodes, diagnostics, { statuses: ["blocked", "completed"] }).map((n) => n.id), ["n:a", "n:c"]);
});

test("viewer overview fallback handles missing current view data", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const result = await buildAwg(new FileAwgStorage(cwd), { write: false });
  const site = renderStaticSite(result.graph, { ...result.currentView, blocks: [] }, result.diagnostics);
  assert.ok(site.js.includes("No graph yet"));
  assert.ok(site.html.includes("route-root"));
});

test("unsupported viewer block renders a safe fallback", () => {
  assert.equal(unsupportedBlockFallback({ type: "future-plugin-block", html: "<script>" }), "Unsupported block type: future-plugin-block");
});

test("kanban column mapping groups workflow statuses", () => {
  const columns = kanbanColumnsFor([
    node({ id: "n:a", type: "task", title: "A", summary: "A.", status: "proposed" }),
    node({ id: "n:b", type: "risk", title: "B", summary: "B.", status: "blocked" }),
    node({ id: "n:c", type: "concept", title: "C", summary: "C.", status: "blocked" }),
    node({ id: "n:d", type: "task", title: "D", summary: "D.", status: "archived" })
  ]);
  assert.deepEqual(columns.find((column) => column.id === "proposed")?.nodes.map((n) => n.id), ["n:a"]);
  assert.deepEqual(columns.find((column) => column.id === "blocked")?.nodes.map((n) => n.id), ["n:b"]);
  assert.equal(columns.some((column) => column.id === "archived"), false);
});

test("graph neighborhood generation is deterministic and bounded", () => {
  const nodes = [
    node({ id: "n:a", type: "task", title: "A", summary: "A.", status: "active" }),
    node({ id: "n:b", type: "risk", title: "B", summary: "B.", status: "active" }),
    node({ id: "n:c", type: "decision", title: "C", summary: "C.", status: "active" }),
    node({ id: "n:d", type: "task", title: "D", summary: "D.", status: "archived" })
  ];
  const graph = {
    nodes,
    edges: [
      { awg: "0.1", kind: "edge" as const, id: "e:1", from: "n:a", rel: "blocks", to: "n:b", created_at: "2026-01-01T00:00:00.000Z" },
      { awg: "0.1", kind: "edge" as const, id: "e:2", from: "n:b", rel: "relates_to", to: "n:c", created_at: "2026-01-01T00:00:00.000Z" },
      { awg: "0.1", kind: "edge" as const, id: "e:3", from: "n:a", rel: "relates_to", to: "n:d", created_at: "2026-01-01T00:00:00.000Z" }
    ]
  };
  assert.deepEqual(graphNeighborhood(graph, "n:a", { depth: 2 }).nodes.map((n) => n.id), ["n:a", "n:b", "n:c"]);
  assert.deepEqual(graphNeighborhood(graph, "n:a", { depth: 2, rels: ["blocks"] }).edges.map((e) => e.id), ["e:1"]);
  assert.deepEqual(graphNeighborhood(graph, "n:a", { depth: 2, statuses: ["active"], types: ["risk"] }).nodes.map((n) => n.id), ["n:b"]);
  assert.equal(graphNeighborhood(graph, "n:missing", { depth: 2 }).missingFocus, true);
});

test("viewer generated node detail handles missing nodes and health diagnostics link to nodes", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:special/id", "--type", "task", "--title", "Special", "--summary", "Special node.", "--status", "blocked"]);
  run(cwd, ["build"]);
  const js = readFileSync(path.join(cwd, ".awg/compiled/site/app.js"), "utf8");
  assert.ok(js.includes("Missing node"));
  assert.ok(js.includes("diagnosticTarget"));
  assert.ok(js.includes("Run attribution"));
  assert.ok(js.includes("#/node/"));
});

test("viewer runtime guards malformed routes and malformed view blocks", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  const at = "2026-01-01T00:00:00.000Z";
  writeFileSync(file, [
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:a", type: "task", title: "A", summary: "A.", status: "stale", importance: 0.5, confidence: 0.8, created_at: at, updated_at: at }),
    JSON.stringify({ awg: "0.1", kind: "view", id: "v:bad", title: "Bad", audience: "human", blocks: [{ type: "diagnostic-list", items: "not-array" }, { type: "constructor" }] })
  ].join("\n") + "\n");
  run(cwd, ["build"]);
  const js = readFileSync(path.join(cwd, ".awg/compiled/site/app.js"), "utf8");
  assert.ok(js.includes("safeDecodeURIComponent"));
  assert.ok(js.includes("Array.isArray(block.items)"));
  assert.ok(js.includes("safeItems"));
  assert.ok(js.includes('sortBy === "staleFirst"'));
  assert.ok(js.includes("firstGraphFocus"));
  assert.ok(js.includes("typeof parsed === \"object\""));
});

test("build reports malformed JSON line", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(file), { recursive: true }));
  writeFileSync(file, "{bad\n");
  const result = await buildAwg(new FileAwgStorage(cwd), { write: false });
  assert.equal(result.diagnostics.summary.fatal_error_count, 1);
  assert.equal(result.diagnostics.diagnostics[0].code, "invalid_json");
});

test("doctor --json exits nonzero on fatal diagnostics", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "{bad\n");
  const output = runFail(cwd, ["doctor", "--json"]);
  assert.ok(output.includes("invalid_json"));
});

test("fatal builds refresh diagnostics and replace stale viewer", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--type", "concept", "--title", "Clean", "--summary", "Clean node."]);
  run(cwd, ["build"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "{bad\n");
  runFail(cwd, ["build"]);
  const diagnostics = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/reports/diagnostics.json"), "utf8"));
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.equal(diagnostics.summary.fatal_error_count, 1);
  assert.equal(graph.diagnostics.summary.fatal_error_count, 1);
  assert.ok(readFileSync(path.join(cwd, ".awg/compiled/site/index.html"), "utf8").includes("AWG Build Failed"));
  assert.ok(readFileSync(path.join(cwd, ".awg/compiled/lenses/resume.json"), "utf8").includes("1 fatal"));
});

test("dangling edge warns by default and is fatal in strict mode", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "edge", "--from", "n:missing-a", "--rel", "relates_to", "--to", "n:missing-b"]);
  const loose = await buildAwg(new FileAwgStorage(cwd), { write: false });
  const strict = await buildAwg(new FileAwgStorage(cwd), { strict: true, write: false });
  assert.equal(loose.diagnostics.summary.dangling_edge_count, 1);
  assert.equal(loose.diagnostics.summary.fatal_error_count, 0);
  assert.equal(strict.diagnostics.summary.fatal_error_count, 1);
});

test("duplicate edge id with different relationship is fatal", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  const base = { awg: "0.1", created_at: "2026-01-01T00:00:00.000Z" };
  writeFileSync(file, [
    JSON.stringify({ ...base, kind: "node", id: "n:a", type: "concept", title: "A", summary: "A.", status: "active", importance: 0.5, confidence: 0.8, updated_at: base.created_at }),
    JSON.stringify({ ...base, kind: "node", id: "n:b", type: "concept", title: "B", summary: "B.", status: "active", importance: 0.5, confidence: 0.8, updated_at: base.created_at }),
    JSON.stringify({ ...base, kind: "node", id: "n:c", type: "concept", title: "C", summary: "C.", status: "active", importance: 0.5, confidence: 0.8, updated_at: base.created_at }),
    JSON.stringify({ ...base, kind: "edge", id: "e:collision", from: "n:a", rel: "relates_to", to: "n:b" }),
    JSON.stringify({ ...base, kind: "edge", id: "e:collision", from: "n:a", rel: "depends_on", to: "n:c" })
  ].join("\n") + "\n");
  const result = await buildAwg(new FileAwgStorage(cwd), { write: false });
  assert.ok(result.diagnostics.diagnostics.some((d) => d.code === "duplicate_edge_id_conflict"));
  assert.equal(result.diagnostics.summary.fatal_error_count, 1);
});

test("invalid status and edge relation fail validation", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  const at = "2026-01-01T00:00:00.000Z";
  writeFileSync(file, [
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:a", type: "concept", title: "A", summary: "A.", status: "in-progress", importance: 0.5, confidence: 0.8, created_at: at, updated_at: at }),
    JSON.stringify({ awg: "0.1", kind: "edge", id: "e:badrel", from: "n:a", rel: "depend_on", to: "n:b", created_at: at })
  ].join("\n") + "\n");
  const result = await buildAwg(new FileAwgStorage(cwd), { write: false });
  assert.equal(result.diagnostics.summary.fatal_error_count, 2);
});

test("project schema overrides are used for validation", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const schemaFile = path.join(cwd, ".awg/schema/core/node.schema.json");
  const schema = JSON.parse(readFileSync(schemaFile, "utf8"));
  schema.properties.title = { const: "Only allowed title" };
  writeFileSync(schemaFile, JSON.stringify(schema, null, 2));
  run(cwd, ["add", "node", "--type", "concept", "--title", "Other title", "--summary", "Schema override should reject this."]);
  const result = await buildAwg(new FileAwgStorage(cwd), { write: false });
  assert.ok(result.diagnostics.diagnostics.some((d) => d.code === "schema_error"));
  assert.equal(result.diagnostics.summary.fatal_error_count, 1);
});

test("compiled output is deterministic for unchanged source", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:stable", "--type", "concept", "--title", "Stable", "--summary", "Stable node."]);
  run(cwd, ["build"]);
  const first = readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8");
  run(cwd, ["build"]);
  const second = readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8");
  assert.equal(second, first);
});

test("completed task without evidence and stale review_after warn", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(file), { recursive: true }));
  writeFileSync(file, `${JSON.stringify({ awg: "0.1", kind: "node", id: "n:task", type: "task", title: "Task", summary: "Task.", status: "completed", importance: 0.5, confidence: 0.8, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", review_after: "2020-01-01" })}\n`);
  const result = await buildAwg(new FileAwgStorage(cwd), { write: false });
  assert.ok(result.diagnostics.diagnostics.some((d) => d.code === "completed_task_without_evidence"));
  assert.ok(result.diagnostics.diagnostics.some((d) => d.code === "stale_node"));
});

test("unknown extension fields are preserved", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(file), { recursive: true }));
  writeFileSync(file, `${JSON.stringify({ awg: "0.1", kind: "node", id: "n:x", type: "concept", title: "X", summary: "X.", status: "active", importance: 0.5, confidence: 0.8, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", "x-custom": { kept: true } })}\n`);
  const result = await buildAwg(new FileAwgStorage(cwd), { write: false });
  assert.deepEqual(result.graph.nodes[0]["x-custom"], { kept: true });
});

test("compiled files are not treated as canonical input", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  await import("node:fs/promises").then((fs) => fs.mkdir(path.join(cwd, ".awg/compiled"), { recursive: true }));
  writeFileSync(path.join(cwd, ".awg/compiled/fake.awg.jsonl"), "{bad\n");
  const result = await buildAwg(new FileAwgStorage(cwd), { write: false });
  assert.equal(result.diagnostics.summary.fatal_error_count, 0);
});

test("invalid numeric add flags fail before writing JSONL", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  let output = runFail(cwd, ["add", "node", "--type", "concept", "--title", "Bad", "--summary", "Bad.", "--importance", "nope"]);
  assert.ok(output.includes("--importance must be a number between 0 and 1"));
  output = runFail(cwd, ["add", "edge", "--from", "n:a", "--rel", "relates_to", "--to", "n:b", "--confidence", "2"]);
  assert.ok(output.includes("--confidence must be a number between 0 and 1"));
  return new FileAwgStorage(cwd).readLogEntries().then((lines) => assert.equal(lines.length, 0));
});

test("instructions install codex creates and patches AGENTS.md without clobbering", () => {
  const cwd = tmp();
  writeFileSync(path.join(cwd, "AGENTS.md"), "# Existing\n\nKeep this.\n");
  run(cwd, ["instructions", "install", "codex"]);
  const first = readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  assert.ok(first.includes("Keep this."));
  assert.ok(first.includes("BEGIN AWG MANAGED INSTRUCTIONS"));
  assert.ok(first.includes("id=codex hash=sha256:"));
  run(cwd, ["instructions", "install", "codex"]);
  const second = readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  assert.equal((second.match(/BEGIN AWG MANAGED INSTRUCTIONS/g) ?? []).length, 1);
});

test("instructions install refuses edited managed blocks unless forced", () => {
  const cwd = tmp();
  writeFileSync(path.join(cwd, "AGENTS.md"), "# Existing\n\nKeep this.\n");
  run(cwd, ["instructions", "install", "codex"]);
  const file = path.join(cwd, "AGENTS.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("Start of session", "CUSTOM Start of session"));
  const output = runFail(cwd, ["instructions", "install", "codex"]);
  assert.ok(output.includes("was edited after AWG generated it"));
  assert.ok(readFileSync(file, "utf8").includes("CUSTOM Start of session"));
  run(cwd, ["instructions", "install", "codex", "--force"]);
  assert.ok(!readFileSync(file, "utf8").includes("CUSTOM Start of session"));
});

test("instructions install refuses hash-only blocks from another instruction pack", () => {
  const cwd = tmp();
  writeFileSync(path.join(cwd, "CLAUDE.md"), "# Claude\n\nKeep this.\n");
  run(cwd, ["instructions", "install", "claude-code"]);
  const claude = readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
  const claudeBlock = claude
    .slice(claude.indexOf("<!-- BEGIN AWG MANAGED INSTRUCTIONS"))
    .replace("BEGIN AWG MANAGED INSTRUCTIONS id=claude-code hash=", "BEGIN AWG MANAGED INSTRUCTIONS hash=");
  const agentsFile = path.join(cwd, "AGENTS.md");
  writeFileSync(agentsFile, `# Existing\n\nKeep this.\n\n${claudeBlock}`);
  const output = runFail(cwd, ["instructions", "install", "codex"]);
  assert.ok(output.includes("has no pack owner"));
  assert.ok(readFileSync(agentsFile, "utf8").includes("# AWG Claude Code Snippet"));
});

test("instructions install refuses incomplete managed marker text without appending", () => {
  const cwd = tmp();
  const file = path.join(cwd, "AGENTS.md");
  const prior = "# Existing\n\nKeep this.\n\n<!-- BEGIN AWG MANAGED INSTRUCTIONS id=codex hash=sha256:abc\nold\n";
  writeFileSync(file, prior);
  const output = runFail(cwd, ["instructions", "install", "codex"]);
  assert.ok(output.includes("Found malformed AWG managed marker text"));
  assert.equal(readFileSync(file, "utf8"), prior);
});

test("instructions install refuses malformed managed markers without modifying user text", () => {
  const cwd = tmp();
  const file = path.join(cwd, "AGENTS.md");
  const prior = "# Existing\n\nKeep this.\n\n<!-- BEGIN AWG MANAGED INSTRUCTIONS -->\nold\n";
  writeFileSync(file, prior);
  const output = runFail(cwd, ["instructions", "install", "codex"]);
  assert.ok(output.includes("Expected exactly one AWG managed block"));
  assert.equal(readFileSync(file, "utf8"), prior);
});

test("instructions install preserves crlf user content outside managed block", () => {
  const cwd = tmp();
  const file = path.join(cwd, "AGENTS.md");
  writeFileSync(file, "# Existing\r\n\r\nKeep this.\r\n");
  run(cwd, ["instructions", "install", "codex"]);
  const text = readFileSync(file, "utf8");
  assert.ok(text.startsWith("# Existing\r\n\r\nKeep this.\r\n"));
  assert.ok(text.includes("\r\n<!-- BEGIN AWG MANAGED INSTRUCTIONS id=codex hash=sha256:"));
});

test("instructions install patches existing lowercase instruction files", () => {
  const cwd = tmp();
  writeFileSync(path.join(cwd, "agents.md"), "# Existing\n\nKeep this.\n");
  writeFileSync(path.join(cwd, "claude.md"), "# Existing Claude\n\nKeep this too.\n");
  run(cwd, ["instructions", "install", "codex"]);
  run(cwd, ["instructions", "install", "claude-code"]);
  const agents = readFileSync(path.join(cwd, "agents.md"), "utf8");
  const claude = readFileSync(path.join(cwd, "claude.md"), "utf8");
  assert.ok(agents.includes("Keep this."));
  assert.ok(agents.includes("BEGIN AWG MANAGED INSTRUCTIONS"));
  assert.ok(claude.includes("Keep this too."));
  assert.ok(claude.includes("BEGIN AWG MANAGED INSTRUCTIONS"));
  assert.ok(!readdirSync(cwd).includes("AGENTS.md"));
  assert.ok(!readdirSync(cwd).includes("CLAUDE.md"));
});

test("instructions install refuses symlinked root instruction files", () => {
  const cwd = tmp();
  const outside = path.join(tmp(), "outside.md");
  writeFileSync(outside, "# Outside\n\nDo not patch.\n");
  symlinkSync(outside, path.join(cwd, "AGENTS.md"));
  const output = runFail(cwd, ["instructions", "install", "codex"]);
  assert.ok(output.includes("Refusing to write through symlink"));
  assert.equal(readFileSync(outside, "utf8"), "# Outside\n\nDo not patch.\n");
});

test("upgrade refreshes lowercase managed instruction files by default", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  rmSync(path.join(cwd, "AGENTS.md"));
  writeFileSync(path.join(cwd, "agents.md"), "# Existing\n\nKeep this.\n");
  run(cwd, ["instructions", "install", "codex"]);
  const agentsFile = path.join(cwd, "agents.md");
  writeFileSync(agentsFile, readFileSync(agentsFile, "utf8").replace(/<!-- BEGIN AWG MANAGED INSTRUCTIONS[^\r\n]* -->/, "<!-- BEGIN AWG MANAGED INSTRUCTIONS -->"));
  run(cwd, ["upgrade"]);
  const agents = readFileSync(path.join(cwd, "agents.md"), "utf8");
  assert.ok(agents.includes("# AWG Agent Loop"));
  assert.ok(agents.includes("id=codex hash=sha256:"));
  assert.ok(!readdirSync(cwd).includes("AGENTS.md"));
});

test("upgrade ignores symlinked managed instruction files by default", () => {
  const cwd = tmp();
  const outside = path.join(tmp(), "outside-agents.md");
  run(cwd, ["init", "--empty"]);
  rmSync(path.join(cwd, "AGENTS.md"));
  writeFileSync(outside, "# Outside\n\n<!-- BEGIN AWG MANAGED INSTRUCTIONS -->\nold\n<!-- END AWG MANAGED INSTRUCTIONS -->\n");
  symlinkSync(outside, path.join(cwd, "AGENTS.md"));
  run(cwd, ["upgrade"]);
  assert.ok(readFileSync(outside, "utf8").includes("\nold\n"));
});

test("instructions install from subdirectory targets project root", () => {
  const cwd = tmp();
  const subdir = path.join(cwd, "src");
  mkdirSync(subdir);
  run(cwd, ["init", "--empty"]);
  run(subdir, ["instructions", "install", "codex"]);
  assert.ok(readFileSync(path.join(cwd, "AGENTS.md"), "utf8").includes("BEGIN AWG MANAGED INSTRUCTIONS"));
  assert.equal(existsSync(path.join(subdir, "AGENTS.md")), false);
  run(subdir, ["instructions", "install", "antigravity"]);
  assert.ok(readFileSync(path.join(cwd, ".awg/instructions/antigravity.md"), "utf8").includes("BEGIN AWG MANAGED INSTRUCTIONS"));
  assert.equal(existsSync(path.join(subdir, ".awg")), false);
});

test("instructions install --dry-run does not modify files", () => {
  const cwd = tmp();
  const output = run(cwd, ["instructions", "install", "codex", "--dry-run"]);
  assert.ok(output.includes("Would create"));
  assert.equal(existsSync(path.join(cwd, "AGENTS.md")), false);
});

test("instructions install claude-code patches existing CLAUDE.md", () => {
  const cwd = tmp();
  writeFileSync(path.join(cwd, "CLAUDE.md"), "# Existing Claude\n\nKeep this.\n");
  run(cwd, ["instructions", "install", "claude-code"]);
  const text = readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
  assert.ok(text.includes("Keep this."));
  assert.ok(text.includes("BEGIN AWG MANAGED INSTRUCTIONS"));
  assert.equal(existsSync(path.join(cwd, ".awg/instructions/claude-code.md")), false);
});

test("instructions install snippets preserve existing user-authored content", () => {
  const cwd = tmp();
  mkdirSync(path.join(cwd, ".awg/instructions"), { recursive: true });
  writeFileSync(path.join(cwd, ".awg/instructions/claude-code.md"), "# Claude user notes\n\nKeep this.\n");
  writeFileSync(path.join(cwd, ".awg/instructions/antigravity.md"), "# Antigravity user notes\n\nKeep this too.\n");
  run(cwd, ["instructions", "install", "claude-code"]);
  run(cwd, ["instructions", "install", "antigravity"]);
  const claude = readFileSync(path.join(cwd, ".awg/instructions/claude-code.md"), "utf8");
  const antigravity = readFileSync(path.join(cwd, ".awg/instructions/antigravity.md"), "utf8");
  assert.ok(claude.includes("Keep this."));
  assert.ok(antigravity.includes("Keep this too."));
  assert.equal((claude.match(/BEGIN AWG MANAGED INSTRUCTIONS/g) ?? []).length, 1);
  assert.equal((antigravity.match(/BEGIN AWG MANAGED INSTRUCTIONS/g) ?? []).length, 1);
});

test("instructions install snippet --dry-run does not create .awg", () => {
  const cwd = tmp();
  const output = run(cwd, ["instructions", "install", "antigravity", "--dry-run"]);
  assert.ok(output.includes("Would create"));
  assert.equal(existsSync(path.join(cwd, ".awg")), false);
});

test("upgrade dry-run reports changes without modifying project files", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const schemaFile = path.join(cwd, ".awg/schema/core/node.schema.json");
  const prior = readFileSync(schemaFile, "utf8");
  writeFileSync(schemaFile, JSON.stringify({ stale: true }, null, 2));
  const stale = readFileSync(schemaFile, "utf8");
  const output = run(cwd, ["upgrade", "--dry-run"]);
  assert.ok(output.includes("AWG upgrade dry run"));
  assert.equal(readFileSync(schemaFile, "utf8"), stale);
  assert.notEqual(stale, prior);
});

test("upgrade creates missing schemas and preserves config fields", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const configFile = path.join(cwd, ".awg/config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config["x-user"] = { kept: true };
  config.validation.strict_links = true;
  writeFileSync(configFile, JSON.stringify(config, null, 2));
  rmSync(path.join(cwd, ".awg/schema/core/node.schema.json"));
  run(cwd, ["upgrade"]);
  const nextConfig = JSON.parse(readFileSync(configFile, "utf8"));
  const nodeSchema = JSON.parse(readFileSync(path.join(cwd, ".awg/schema/core/node.schema.json"), "utf8"));
  assert.deepEqual(nextConfig["x-user"], { kept: true });
  assert.equal(nextConfig.validation.strict_links, true);
  assert.deepEqual(nodeSchema, schemaForFile("node"));
});

test("upgrade preserves customized project schemas", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const schemaFile = path.join(cwd, ".awg/schema/core/node.schema.json");
  writeFileSync(schemaFile, JSON.stringify({ custom: true }, null, 2));
  const output = run(cwd, ["upgrade"]);
  assert.ok(output.includes("preserved custom schema"));
  assert.deepEqual(JSON.parse(readFileSync(schemaFile, "utf8")), { custom: true });
});

test("upgrade updates schemas that match the AWG-managed manifest", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const schemaFile = path.join(cwd, ".awg/schema/core/node.schema.json");
  const staleBody = `${JSON.stringify({ type: "object", properties: { stale: true } }, null, 2)}\n`;
  writeFileSync(schemaFile, staleBody);
  writeFileSync(path.join(cwd, ".awg/schema/core/.awg-managed.json"), JSON.stringify({
    version: "0.0",
    managedBy: "awg",
    hashAlgorithm: "sha256",
    schemas: { node: { hash: schemaContentHash(staleBody) } }
  }, null, 2));
  run(cwd, ["upgrade"]);
  assert.deepEqual(JSON.parse(readFileSync(schemaFile, "utf8")), schemaForFile("node"));
  const manifest = JSON.parse(readFileSync(path.join(cwd, ".awg/schema/core/.awg-managed.json"), "utf8"));
  assert.equal(manifest.schemas.node.hash, schemaContentHash(schemaBodyForFile("node")));
});

test("upgrade updates pre-manifest V1 generated schemas", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const schemaFile = path.join(cwd, ".awg/schema/core/node.schema.json");
  rmSync(path.join(cwd, ".awg/schema/core/.awg-managed.json"));
  writeFileSync(schemaFile, initialV1NodeSchemaBody());
  run(cwd, ["upgrade"]);
  assert.deepEqual(JSON.parse(readFileSync(schemaFile, "utf8")), schemaForFile("node"));
  assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, ".awg/schema/core/.awg-managed.json"), "utf8")), currentSchemaManifest());
});

test("upgrade refuses symlinked schema files", () => {
  const cwd = tmp();
  const outside = path.join(tmp(), "node.schema.json");
  run(cwd, ["init", "--empty"]);
  writeFileSync(outside, initialV1NodeSchemaBody());
  rmSync(path.join(cwd, ".awg/schema/core/node.schema.json"));
  symlinkSync(outside, path.join(cwd, ".awg/schema/core/node.schema.json"));
  const output = runFail(cwd, ["upgrade"]);
  assert.ok(output.includes("Refusing to access symlink"));
  assert.equal(readFileSync(outside, "utf8"), initialV1NodeSchemaBody());
});

test("upgrade refuses symlinked managed parent directories", () => {
  const cwd = tmp();
  const outside = tmp();
  run(cwd, ["init", "--empty"]);
  rmSync(path.join(cwd, ".awg/schema"), { recursive: true, force: true });
  symlinkSync(outside, path.join(cwd, ".awg/schema"));
  const output = runFail(cwd, ["upgrade"]);
  assert.ok(output.includes("Refusing to access symlink"));
  assert.equal(existsSync(path.join(outside, "core")), false);
});

test("upgrade instructions preserves user-authored markdown", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  writeFileSync(path.join(cwd, "AGENTS.md"), "# Existing\n\nKeep this.\n");
  writeFileSync(path.join(cwd, "CLAUDE.md"), "# Claude\n\nKeep this too.\n");
  run(cwd, ["upgrade", "--instructions", "codex,claude-code"]);
  const agents = readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  const claude = readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
  assert.ok(agents.includes("Keep this."));
  assert.ok(claude.includes("Keep this too."));
  assert.equal((agents.match(/BEGIN AWG MANAGED INSTRUCTIONS/g) ?? []).length, 1);
  assert.equal((claude.match(/BEGIN AWG MANAGED INSTRUCTIONS/g) ?? []).length, 1);
});

test("upgrade refuses ambiguous legacy managed markdown blocks by default", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  writeFileSync(path.join(cwd, "AGENTS.md"), "# Existing\n\nKeep this.\n\n<!-- BEGIN AWG MANAGED INSTRUCTIONS -->\nold\n<!-- END AWG MANAGED INSTRUCTIONS -->\n");
  const output = runFail(cwd, ["upgrade"]);
  assert.ok(output.includes("has no ownership hash"));
  const agents = readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  assert.ok(agents.includes("Keep this."));
  assert.ok(agents.includes("\nold\n"));
  run(cwd, ["upgrade", "--force"]);
  const forced = readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  assert.ok(forced.includes("# AWG Agent Loop"));
  assert.ok(!forced.includes("\nold\n"));
});

test("upgrade preflights instruction conflicts before modifying vault files", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const configFile = path.join(cwd, ".awg/config.json");
  const oldConfig = JSON.stringify({ awg: "0.0", project: { title: "Old" }, "x-user": true }, null, 2);
  writeFileSync(configFile, oldConfig);
  writeFileSync(path.join(cwd, "AGENTS.md"), "# Existing\n\nKeep this.\n\n<!-- BEGIN AWG MANAGED INSTRUCTIONS -->\nold\n<!-- END AWG MANAGED INSTRUCTIONS -->\n");
  const output = runFail(cwd, ["upgrade"]);
  assert.ok(output.includes("has no ownership hash"));
  assert.equal(readFileSync(configFile, "utf8"), oldConfig);
});

test("upgrade force refreshes edited managed Claude snippet without patching unrelated CLAUDE.md", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  mkdirSync(path.join(cwd, ".awg/instructions"), { recursive: true });
  writeFileSync(path.join(cwd, ".awg/instructions/claude-code.md"), "# Snippet\n\n<!-- BEGIN AWG MANAGED INSTRUCTIONS -->\nold\n<!-- END AWG MANAGED INSTRUCTIONS -->\n");
  writeFileSync(path.join(cwd, "CLAUDE.md"), "# User Claude\n\nNo managed block here.\n");
  run(cwd, ["upgrade", "--force"]);
  const snippet = readFileSync(path.join(cwd, ".awg/instructions/claude-code.md"), "utf8");
  const claude = readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
  assert.ok(snippet.includes("# AWG Claude Code Snippet"));
  assert.ok(!snippet.includes("\nold\n"));
  assert.ok(!claude.includes("BEGIN AWG MANAGED INSTRUCTIONS"));
});

test("upgrade --json stays machine-readable when installing instructions", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const output = run(cwd, ["upgrade", "--json", "--instructions", "codex"]);
  const parsed = JSON.parse(output);
  assert.equal(parsed.results[0].status, "changed");
  assert.ok(parsed.results[0].actions.some((action: string) => action.includes("instructions:codex")));
});

test("upgrade rejects --instructions without a pack list", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const output = runFail(cwd, ["upgrade", "--instructions"]);
  assert.ok(output.includes("--instructions requires a comma-separated pack list or all."));
});

test("upgrade repairs older project config shapes", () => {
  const cwd = tmp();
  mkdirSync(path.join(cwd, ".awg/log"), { recursive: true });
  writeFileSync(path.join(cwd, ".awg/config.json"), JSON.stringify({ awg: "0.0", project: { title: "Old" }, "x-user": true }, null, 2));
  run(cwd, ["upgrade"]);
  const config = JSON.parse(readFileSync(path.join(cwd, ".awg/config.json"), "utf8"));
  assert.equal(config.awg, "0.1");
  assert.equal(config.project.title, "Old");
  assert.equal(config["x-user"], true);
  assert.equal(config.storage.canonical, ".awg/log/**/*.awg.jsonl");
});

test("upgrade --all updates registered vaults and reports skipped missing vaults", () => {
  const home = tempHome();
  const one = tmp();
  const two = tmp();
  const missing = path.join(tmp(), ".awg");
  run(one, ["setup", "--yes", "--no-register-current"], { HOME: home });
  run(one, ["init", "--empty"], { HOME: home });
  run(two, ["init", "--empty"], { HOME: home });
  run(one, ["register", "--name", "One"], { HOME: home });
  run(two, ["register", "--name", "Two"], { HOME: home });
  const registry = readRegistry(home);
  registry.vaults.push({ id: "vault:missing", name: "Missing", path: missing });
  writeFileSync(path.join(home, ".awg/registry.json"), JSON.stringify(registry, null, 2));
  rmSync(path.join(one, ".awg/schema/core/node.schema.json"));
  rmSync(path.join(two, ".awg/schema/core/node.schema.json"));
  const output = run(one, ["upgrade", "--all"], { HOME: home });
  assert.ok(output.includes("CHANGED One"));
  assert.ok(output.includes("CHANGED Two"));
  assert.ok(output.includes("SKIPPED Missing"));
  assert.deepEqual(JSON.parse(readFileSync(path.join(one, ".awg/schema/core/node.schema.json"), "utf8")), schemaForFile("node"));
  assert.deepEqual(JSON.parse(readFileSync(path.join(two, ".awg/schema/core/node.schema.json"), "utf8")), schemaForFile("node"));
});
