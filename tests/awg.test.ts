import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAwg } from "../src/core/compiler.js";
import { currentSchemaManifest, schemaBodyForFile, schemaContentHash, schemaForFile } from "../src/core/schemas.js";
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

test("init creates expected files", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  assert.ok(readFileSync(path.join(cwd, "AGENTS.md"), "utf8").includes("durable project memory"));
  assert.ok(readFileSync(path.join(cwd, "CLAUDE.md"), "utf8").includes("Follow the project instructions in `AGENTS.md`"));
  assert.ok(readFileSync(path.join(cwd, ".awg/config.json"), "utf8").includes('"awg"'));
  assert.ok(readFileSync(path.join(cwd, ".awg/AGENTS.md"), "utf8").includes("awg lens resume"));
  assert.ok(readFileSync(path.join(cwd, ".awg/schema/core/node.schema.json"), "utf8").includes('"kind"'));
  assert.deepEqual(JSON.parse(readFileSync(path.join(cwd, ".awg/schema/core/.awg-managed.json"), "utf8")), currentSchemaManifest());
});

test("packaged schemas match runtime schema source", () => {
  for (const name of ["node", "edge", "event", "view", "lens", "response", "policy", "operation"]) {
    const packaged = JSON.parse(readFileSync(path.join("schemas/core", `${name}.schema.json`), "utf8"));
    assert.deepEqual(packaged, schemaForFile(name));
  }
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
  assert.ok(readFileSync(path.join(cwd, ".awg/AGENTS.md"), "utf8").includes("awg lens resume"));
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
  run(cwd, ["instructions", "install", "codex"]);
  const second = readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  assert.equal((second.match(/BEGIN AWG MANAGED INSTRUCTIONS/g) ?? []).length, 1);
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
  writeFileSync(path.join(cwd, "agents.md"), "# Existing\n\n<!-- BEGIN AWG MANAGED INSTRUCTIONS -->\nold\n<!-- END AWG MANAGED INSTRUCTIONS -->\n");
  run(cwd, ["upgrade"]);
  const agents = readFileSync(path.join(cwd, "agents.md"), "utf8");
  assert.ok(agents.includes("# AWG Agent Loop"));
  assert.ok(!agents.includes("\nold\n"));
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

test("upgrade refreshes existing managed markdown blocks by default", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  writeFileSync(path.join(cwd, "AGENTS.md"), "# Existing\n\nKeep this.\n\n<!-- BEGIN AWG MANAGED INSTRUCTIONS -->\nold\n<!-- END AWG MANAGED INSTRUCTIONS -->\n");
  run(cwd, ["upgrade"]);
  const agents = readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  assert.ok(agents.includes("Keep this."));
  assert.ok(agents.includes("# AWG Agent Loop"));
  assert.ok(!agents.includes("\nold\n"));
  assert.ok(run(cwd, ["upgrade"]).includes("UNCHANGED"));
});

test("upgrade refreshes exact managed Claude snippet without patching unrelated CLAUDE.md", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  mkdirSync(path.join(cwd, ".awg/instructions"), { recursive: true });
  writeFileSync(path.join(cwd, ".awg/instructions/claude-code.md"), "# Snippet\n\n<!-- BEGIN AWG MANAGED INSTRUCTIONS -->\nold\n<!-- END AWG MANAGED INSTRUCTIONS -->\n");
  writeFileSync(path.join(cwd, "CLAUDE.md"), "# User Claude\n\nNo managed block here.\n");
  run(cwd, ["upgrade"]);
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
