import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildAwg } from "../src/core/compiler.js";
import { FileAwgStorage } from "../src/storage/FileAwgStorage.js";

const cli = path.resolve("dist/src/cli/index.js");

function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "awg-test-"));
}

function run(cwd: string, args: string[]): string {
  return execFileSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

test("init creates expected files", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  assert.ok(readFileSync(path.join(cwd, "AGENTS.md"), "utf8").includes("durable project memory"));
  assert.ok(readFileSync(path.join(cwd, "CLAUDE.md"), "utf8").includes("Follow the project instructions in `AGENTS.md`"));
  assert.ok(readFileSync(path.join(cwd, ".awg/config.json"), "utf8").includes('"awg"'));
  assert.ok(readFileSync(path.join(cwd, ".awg/AGENTS.md"), "utf8").includes("awg lens resume"));
  assert.ok(readFileSync(path.join(cwd, ".awg/schema/core/node.schema.json"), "utf8").includes('"kind"'));
});

test("init does not overwrite existing root AGENTS.md", () => {
  const cwd = tmp();
  writeFileSync(path.join(cwd, "AGENTS.md"), "# Existing\n\nKeep this.\n");
  run(cwd, ["init", "--empty"]);
  assert.equal(readFileSync(path.join(cwd, "AGENTS.md"), "utf8"), "# Existing\n\nKeep this.\n");
});

test("init does not overwrite existing CLAUDE.md", () => {
  const cwd = tmp();
  writeFileSync(path.join(cwd, "CLAUDE.md"), "# Existing Claude\n\nKeep this.\n");
  run(cwd, ["init", "--empty"]);
  assert.equal(readFileSync(path.join(cwd, "CLAUDE.md"), "utf8"), "# Existing Claude\n\nKeep this.\n");
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
