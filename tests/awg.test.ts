import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { MVP_BLOCK_TYPES, VIEW_BLOCK_TYPES, validatePresentationBlock, validateViewBlock } from "../src/core/blocks.js";
import { buildAwg } from "../src/core/compiler.js";
import { buildNodeDetail } from "../src/core/nodeDetail.js";
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

function readRegistry(home: string): { vaults: Array<{ id: string; path: string; name: string; [key: string]: unknown }>; relationships?: Array<Record<string, unknown>>; [key: string]: unknown } {
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

function initialV1EdgeSchemaBody(): string {
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
    required: ["awg", "kind", "id", "from", "rel", "to", "created_at"],
    properties: {
      ...base.properties,
      kind: { const: "edge" },
      id: { type: "string", pattern: "^e:.+" },
      from: { type: "string", pattern: "^n:.+" },
      rel: { enum: ["relates_to", "depends_on", "blocks", "supports", "contradicts", "answers", "asks", "implements", "affects", "supersedes", "derived_from", "part_of", "caused_by", "requires", "recommends", "references", "owned_by", "applies_to"] },
      to: { type: "string", pattern: "^n:.+" },
      created_at: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 }
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

function canonicalLogSnapshot(cwd: string): string {
  const root = path.join(cwd, ".awg/log");
  const files = walk(root).filter((file) => file.endsWith(".awg.jsonl")).sort();
  return files.map((file) => `${path.relative(root, file)}\n${readFileSync(file, "utf8")}`).join("\n");
}

function compiledSnapshot(cwd: string): string {
  const root = path.join(cwd, ".awg/compiled");
  const files = walk(root).sort();
  return files.map((file) => `${path.relative(root, file)}\n${readFileSync(file, "utf8")}`).join("\n");
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

test("init creates expected files", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const agents = readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  const claude = readFileSync(path.join(cwd, "CLAUDE.md"), "utf8");
  const vaultAgents = readFileSync(path.join(cwd, ".awg/AGENTS.md"), "utf8");
  assert.ok(agents.includes("durable project memory"));
  assert.ok(agents.includes("awg doctor --fix-suggestions --json"));
  assert.ok(agents.includes("--auto-handoff"));
  assert.ok(agents.includes("awg node show <node-id> --json"));
  assert.ok(agents.includes("awg queue next --json"));
  assert.ok(agents.includes("awg coord status --json"));
  assert.ok(agents.includes("never treat coordination as a hard lock"));
  assert.ok(claude.includes("Follow the project instructions in `AGENTS.md`"));
  assert.ok(claude.includes("awg doctor --fix-suggestions --json"));
  assert.ok(claude.includes("--auto-handoff"));
  assert.ok(claude.includes("awg node show <node-id> --json"));
  assert.ok(readFileSync(path.join(cwd, ".awg/config.json"), "utf8").includes('"awg"'));
  assert.ok(vaultAgents.includes("awg run start"));
  assert.ok(vaultAgents.includes("awg doctor --fix-suggestions --json"));
  assert.ok(vaultAgents.includes("--auto-handoff"));
  assert.ok(vaultAgents.includes("awg node show <node-id> --json"));
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

test("packed package exposes the awg bin and runs offline smoke", () => {
  const packDir = tmp();
  const extractDir = tmp();
  const npmHome = tempHome();
  const output = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], {
    cwd: path.resolve("."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, HOME: npmHome, npm_config_cache: path.join(npmHome, ".npm-cache"), npm_config_logs_dir: path.join(npmHome, ".npm-logs") }
  });
  const packed = JSON.parse(output) as Array<{ filename: string }>;
  const tarball = path.join(packDir, packed[0].filename);
  execFileSync("tar", ["-xzf", tarball, "-C", extractDir], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const packageDir = path.join(extractDir, "package");
  const pkg = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
  assert.equal(pkg.bin.awg.replace(/^\.\//, ""), "dist/src/cli/index.js");
  symlinkSync(path.resolve("node_modules"), path.join(packageDir, "node_modules"), "dir");
  const bin = path.join(packageDir, pkg.bin.awg);
  const help = execFileSync(process.execPath, [bin, "--help"], { cwd: packageDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.ok(help.includes("awg <command>"));
  assert.ok(help.includes("--block-json"));
  assert.ok(help.includes("--freshness-json"));
  assert.ok(help.includes("--evidence-required"));
  assert.ok(help.includes("node show <node-id> [--json]"));
  const vault = tmp();
  const home = tempHome();
  execFileSync(process.execPath, [bin, "init", "--empty", "--no-register"], { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: home } });
  execFileSync(process.execPath, [bin,
    "add", "node",
    "--id", "n:package-template",
    "--type", "process",
    "--title", "Package template",
    "--summary", "Package smoke template.",
    "--status", "active",
    "--tag", "template:operating",
    "--fields-json", "{\"scope\":\"project\",\"purpose\":\"Package smoke.\",\"taxonomy\":{\"types\":[\"process\"]},\"freshness_rules\":\"Review on material change.\",\"agent_rules\":\"Search before writing.\",\"review_state\":\"reviewed\"}",
    "--block-json", "{\"schemaVersion\":1,\"type\":\"brief\",\"data\":{\"items\":[{\"label\":\"Purpose\",\"text\":\"Packaged block.\"}]}}",
    "--freshness-json", "{\"state\":\"current\",\"last_verified\":\"2026-05-13\"}",
    "--json"
  ], { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: home } });
  const templateStatus = JSON.parse(execFileSync(process.execPath, [bin, "template", "status", "--json"], { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: home } }));
  assert.equal(templateStatus.activeTemplateId, "n:package-template");
  const build = JSON.parse(execFileSync(process.execPath, [bin, "build", "--json"], { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: home } }));
  assert.equal(build.fatal_error_count, 0);
  const nodeDetail = JSON.parse(execFileSync(process.execPath, [bin, "node", "show", "n:package-template", "--json"], { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: home } }));
  assert.equal(nodeDetail.ok, true);
  assert.equal(nodeDetail.node.id, "n:package-template");
  assert.equal(nodeDetail.node.blocks[0].type, "brief");
  const doctor = JSON.parse(execFileSync(process.execPath, [bin, "doctor", "--fix-suggestions", "--json"], { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, HOME: home } }));
  assert.equal(doctor.summary.fatal_error_count, 0);
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

test("claims evidence verification commands derive trust indexes and surface issues", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty", "--no-register"]);
  const addClaim = JSON.parse(run(cwd, ["add", "claim", "--title", "Claims smoke", "--claim", "Claims smoke is implemented.", "--kind", "implementation_fact", "--evidence-required", "--json"]));
  assert.equal(addClaim.ok, true);
  const claimId = addClaim.claimId;
  const initialStatus = JSON.parse(run(cwd, ["claim", "status", claimId, "--json"]));
  assert.equal(initialStatus.claim.verificationStatus, "unverified");
  const verify = JSON.parse(run(cwd, ["verify", claimId, "--summary", "Manual smoke passed.", "--source", "terminal", "--command", "npm test", "--status", "passed", "--url", "https://example.test/evidence", "--reliability", "high", "--redacted", "--json"]));
  assert.equal(verify.ok, true);
  assert.equal(verify.verificationStatus, "verified");
  const status = JSON.parse(run(cwd, ["claim", "status", claimId, "--json"]));
  assert.equal(status.claim.verificationStatus, "verified");
  assert.deepEqual(status.claim.supportingEvidenceIds, [verify.evidenceNodeId]);
  const claims = JSON.parse(run(cwd, ["claims", "--status", "verified", "--json"]));
  assert.equal(claims.kind, "claim-index");
  assert.equal(claims.claims.length, 1);
  run(cwd, ["build", "--json"]);
  const evidence = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/indexes/evidence.json"), "utf8"));
  assert.equal(evidence.evidence[0].source, "terminal");
  assert.equal(evidence.evidence[0].supportsIds[0], claimId);
  const contradicted = JSON.parse(run(cwd, ["add", "evidence", "--target", claimId, "--summary", "A later check failed.", "--source", "system", "--status", "failed", "--rel", "contradicts", "--expires-at", "2000-01-01T00:00:00.000Z", "--json"]));
  assert.equal(contradicted.verificationStatus, "contradicted");
  const built = JSON.parse(run(cwd, ["build", "--json"]));
  assert.equal(built.fatal_error_count, 0);
  const inbox = JSON.parse(run(cwd, ["inbox", "--json"]));
  assert.ok(inbox.items.some((item: { code: string }) => item.code === "AWG_INBOX_CLAIM_CONTRADICTED"));
  assert.ok(inbox.items.some((item: { code: string }) => item.code === "AWG_INBOX_EVIDENCE_EXPIRED"));
  assert.ok(runFail(cwd, ["verify", claimId, "--summary", "Bad rel.", "--rel", "verified_by"]).includes("--rel for awg verify"));
  assert.ok(runFail(cwd, ["add", "evidence", "--target", claimId, "--summary", "Bad status.", "--status", "maybe"]).includes("--status must be one of"));
  assert.ok(JSON.parse(run(cwd, ["add", "evidence", "--target", claimId, "--summary", "Old evidence was superseded.", "--status", "superseded", "--json"])).ok);
  const lens = JSON.parse(run(cwd, ["lens", "task", "--goal", "claims smoke", "--json"]));
  assert.ok(lens.sections.some((section: { section: string; items: unknown[] }) => section.section === "claimTrustIssues" && section.items.length));
  const handoff = JSON.parse(run(cwd, ["handoff", "--json", "--no-record"]));
  assert.ok(handoff.sections.some((section: { section: string; items: unknown[] }) => section.section === "claimTrustIssues" && section.items.length));
  const addVerifiedBy = JSON.parse(run(cwd, ["add", "evidence", "--target", claimId, "--summary", "Verified by normalized direction.", "--rel", "verified_by", "--status", "passed", "--json"]));
  run(cwd, ["build", "--json"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  const edge = graph.edges.find((item: { id: string }) => item.id === addVerifiedBy.edgeId);
  assert.equal(edge.from, claimId);
  assert.equal(edge.to, addVerifiedBy.evidenceNodeId);
});

test("claim index preserves inline evidence compatibility and avoids task evidence pollution", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty", "--no-register"]);
  run(cwd, ["add", "node", "--id", "n:inline-proof", "--type", "evidence", "--title", "Inline proof", "--summary", "Inline proof passed.", "--field", "source=manual", "--field", "evidence_status=passed"]);
  const logDir = path.join(cwd, ".awg/log/2026/01");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(path.join(logDir, "2026-01-02.awg.jsonl"), JSON.stringify(node({
    id: "n:inline-claim",
    type: "claim",
    title: "Inline claim",
    summary: "Inline evidence works.",
    status: "active",
    fields: { claim: "Inline evidence works.", claim_kind: "fact" },
    evidence_required: true,
    evidence: [{ id: "n:inline-proof", summary: "Inline proof passed.", source: "manual", status: "passed" }]
  })) + "\n");
  run(cwd, ["add", "node", "--id", "n:done-task", "--type", "task", "--title", "Done task", "--summary", "Done.", "--status", "completed"]);
  run(cwd, ["add", "evidence", "--target", "n:done-task", "--summary", "Task evidence passed.", "--status", "passed"]);
  run(cwd, ["build", "--json"]);
  const claims = JSON.parse(run(cwd, ["claims", "--json"]));
  assert.ok(claims.claims.some((claim: { id: string; verificationStatus: string; supportingEvidenceIds: string[] }) => claim.id === "n:inline-claim" && claim.verificationStatus === "verified" && claim.supportingEvidenceIds.includes("n:inline-proof")));
  assert.ok(!claims.claims.some((claim: { id: string }) => claim.id === "n:done-task"));
  const evidenceIndex = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/indexes/evidence.json"), "utf8"));
  assert.ok(evidenceIndex.evidence.some((evidence: { id: string; supportsIds: string[] }) => evidence.id === "n:inline-proof" && evidence.supportsIds.includes("n:inline-claim")));
});

test("claim index accepts compact inline evidence objects without separate evidence nodes", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty", "--no-register"]);
  const logDir = path.join(cwd, ".awg/log/2026/01");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(path.join(logDir, "2026-01-02.awg.jsonl"), JSON.stringify(node({
    id: "n:compact-inline-claim",
    type: "claim",
    title: "Compact inline claim",
    summary: "Compact inline evidence works.",
    status: "active",
    fields: { claim: "Compact inline evidence works.", claim_kind: "fact" },
    evidence_required: true,
    evidence: [{ summary: "Compact inline proof.", source: "manual", status: "passed", at: "2026-01-02T00:00:00.000Z" }]
  })) + "\n");
  run(cwd, ["build", "--json"]);
  const claims = JSON.parse(run(cwd, ["claims", "--json"]));
  assert.ok(claims.claims.some((claim: { id: string; verificationStatus: string; supportingEvidenceIds: string[] }) => claim.id === "n:compact-inline-claim" && claim.verificationStatus === "verified" && claim.supportingEvidenceIds.includes("n:compact-inline-claim:inline-evidence:1")));
  const evidenceIndex = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/indexes/evidence.json"), "utf8"));
  assert.ok(evidenceIndex.evidence.some((evidence: { id: string; supportsIds: string[] }) => evidence.id === "n:compact-inline-claim:inline-evidence:1" && evidence.supportsIds.includes("n:compact-inline-claim")));
});

test("claim diagnostics cover missing source of truth and evidence status", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty", "--no-register"]);
  run(cwd, ["add", "claim", "--id", "n:sot-claim", "--title", "SOT claim", "--claim", "Source exists.", "--source-of-truth", "n:missing-source"]);
  run(cwd, ["add", "node", "--id", "n:no-status-evidence", "--type", "evidence", "--title", "No status evidence", "--summary", "No status.", "--field", "source=manual"]);
  const doctor = JSON.parse(run(cwd, ["doctor", "--fix-suggestions", "--json"]));
  assert.ok(doctor.diagnostics.some((diag: { code: string; id: string }) => diag.code === "source_of_truth_missing" && diag.id === "n:sot-claim"));
  assert.ok(doctor.diagnostics.some((diag: { code: string; id: string }) => diag.code === "evidence_missing_status" && diag.id === "n:no-status-evidence"));
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

test("register refuses symlinked project config before identity backfill", () => {
  const cwd = tmp();
  const home = tempHome();
  const outside = tmp();
  const outsideConfig = path.join(outside, "config.json");
  mkdirSync(path.join(cwd, ".awg/log"), { recursive: true });
  writeFileSync(outsideConfig, JSON.stringify({
    awg: "0.1",
    project: { title: "Unsafe" },
    storage: { adapter: "file", canonical: ".awg/log/**/*.awg.jsonl" }
  }, null, 2));
  symlinkSync(outsideConfig, path.join(cwd, ".awg/config.json"));
  const before = readFileSync(outsideConfig, "utf8");
  const output = runFail(cwd, ["register", "--name", "Unsafe"], { HOME: home });
  assert.ok(output.includes("Refusing to access symlink"));
  assert.equal(readFileSync(outsideConfig, "utf8"), before);
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

test("maintenance inbox emits deterministic parseable json with filters and limits", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:root", "--type", "concept", "--title", "Root", "--summary", "Root.", "--status", "active"]);
  run(cwd, ["add", "node", "--id", "n:stale", "--type", "task", "--title", "Stale task", "--summary", "Needs review.", "--status", "active", "--freshness-json", "{\"review_after\":\"2020-01-01\"}"]);
  run(cwd, ["add", "node", "--id", "n:review", "--type", "task", "--title", "Review task", "--summary", "Review.", "--status", "needs_review"]);
  run(cwd, ["add", "node", "--id", "n:done", "--type", "task", "--title", "Done task", "--summary", "Done.", "--status", "completed"]);
  run(cwd, ["add", "node", "--id", "n:question", "--type", "question", "--title", "Open question", "--summary", "Open?", "--status", "active"]);
  run(cwd, ["add", "node", "--id", "n:risk", "--type", "risk", "--title", "Active risk", "--summary", "Risk.", "--status", "active"]);
  run(cwd, ["add", "node", "--id", "n:review-risk", "--type", "risk", "--title", "Review risk", "--summary", "Review risk.", "--status", "needs_review"]);
  run(cwd, ["add", "node", "--id", "n:decision", "--type", "decision", "--title", "Proposed decision", "--summary", "Decision.", "--status", "proposed"]);
  run(cwd, ["add", "node", "--id", "n:dupe-a", "--type", "concept", "--title", "Duplicate title", "--summary", "A.", "--status", "active"]);
  run(cwd, ["add", "node", "--id", "n:dupe-b", "--type", "concept", "--title", "Duplicate title", "--summary", "B.", "--status", "active"]);
  for (const id of ["n:stale", "n:review", "n:done", "n:question", "n:risk", "n:review-risk", "n:decision", "n:dupe-a", "n:dupe-b"]) {
    run(cwd, ["add", "edge", "--from", "n:root", "--rel", "relates_to", "--to", id]);
  }
  run(cwd, ["add", "edge", "--from", "n:done", "--rel", "implements", "--to", "n:decision"]);
  const first = JSON.parse(run(cwd, ["inbox", "--json"]));
  const second = JSON.parse(run(cwd, ["inbox", "--json"]));
  assert.deepEqual(second.items.map((item: { id: string }) => item.id), first.items.map((item: { id: string }) => item.id));
  assert.ok(first.items.some((item: { kind: string; code: string; nodeIds: string[] }) => item.kind === "stale" && item.nodeIds.includes("n:stale")));
  assert.ok(first.items.some((item: { kind: string; code: string; nodeIds: string[] }) => item.kind === "needs_review" && item.nodeIds.includes("n:review")));
  assert.ok(first.items.some((item: { kind: string; code: string; nodeIds: string[] }) => item.kind === "evidence" && item.nodeIds.includes("n:done")));
  assert.ok(first.items.some((item: { kind: string; nodeIds: string[] }) => item.kind === "questions" && item.nodeIds.includes("n:question")));
  assert.ok(first.items.some((item: { kind: string; nodeIds: string[] }) => item.kind === "risks" && item.nodeIds.includes("n:risk")));
  assert.ok(first.items.some((item: { kind: string; nodeIds: string[] }) => item.kind === "needs_review" && item.nodeIds.includes("n:review-risk")));
  assert.ok(!first.items.some((item: { kind: string; nodeIds: string[]; suggestedCommands: string[] }) => item.kind === "risks" && item.nodeIds.includes("n:review-risk") && item.suggestedCommands.includes("awg update node n:review-risk --status needs_review")));
  assert.ok(first.items.some((item: { kind: string; nodeIds: string[] }) => item.kind === "decisions" && item.nodeIds.includes("n:decision")));
  assert.ok(first.items.some((item: { kind: string; nodeIds: string[] }) => item.kind === "duplicates" && item.nodeIds.includes("n:dupe-a") && item.nodeIds.includes("n:dupe-b")));
  const limited = JSON.parse(run(cwd, ["inbox", "--kind", "risks", "--limit", "1", "--json"]));
  assert.equal(limited.items.length, 1);
  assert.equal(limited.items[0].kind, "risks");
  const shown = JSON.parse(run(cwd, ["inbox", "show", first.items[0].id, "--json"]));
  assert.equal(shown.item.id, first.items[0].id);
  assert.ok(run(cwd, ["inbox", "--limit", "2"]).includes("suggestion:"));
});

test("doctor shares maintenance inbox suggestions without mutating logs", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:done", "--type", "task", "--title", "Done task", "--summary", "Done.", "--status", "completed"]);
  const before = new FileAwgStorage(cwd).readLogEntries();
  return before.then(async (entriesBefore) => {
    const doctor = JSON.parse(run(cwd, ["doctor", "--fix-suggestions", "--json"]));
    assert.ok(doctor.maintenanceInbox.items.some((item: { code: string }) => item.code === "AWG_INBOX_COMPLETED_TASK_WITHOUT_EVIDENCE"));
    assert.ok(doctor.fixSuggestions.some((item: { itemId?: string; suggestedCommands: string[]; autonomousSafe?: boolean; needsHumanReview?: boolean }) => item.itemId && item.autonomousSafe === false && item.needsHumanReview === true && item.suggestedCommands.some((command) => command.includes("awg add evidence"))));
    const entriesAfter = await new FileAwgStorage(cwd).readLogEntries();
    assert.equal(entriesAfter.length, entriesBefore.length);
  });
});

test("reconcile commands append edges and preserve run attribution", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:a", "--type", "concept", "--title", "A", "--summary", "A."]);
  run(cwd, ["add", "node", "--id", "n:b", "--type", "concept", "--title", "B", "--summary", "B."]);
  run(cwd, ["run", "start", "--goal", "Reconcile test", "--agent", "tester"]);
  const output = JSON.parse(run(cwd, ["reconcile", "duplicate", "n:a", "n:b", "--canonical", "n:a", "--reason", "Same thing.", "--json"]));
  assert.equal(output.ok, true);
  assert.equal(output.runId.startsWith("run:"), true);
  run(cwd, ["build"]);
  const compiledBefore = compiledSnapshot(cwd);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  const rels = graph.edges.filter((edge: { rel: string }) => ["duplicate_of", "canonical_for"].includes(edge.rel));
  assert.equal(rels.length, 2);
  assert.ok(rels.every((edge: { runId?: string }) => edge.runId === output.runId));
  assert.ok(graph.events.some((event: { type: string; action?: string; runId?: string }) => event.type === "reconciliation_added" && event.action === "duplicate" && event.runId === output.runId));
  const inbox = JSON.parse(run(cwd, ["inbox", "--kind", "duplicates", "--json"]));
  assert.ok(!inbox.items.some((item: { nodeIds: string[] }) => item.nodeIds.includes("n:a") || item.nodeIds.includes("n:b")));
  assert.ok(runFail(cwd, ["reconcile", "duplicate", "n:a", "n:a", "--canonical", "n:a"]).includes("distinct node IDs"));
  assert.ok(runFail(cwd, ["reconcile", "intentionally-open", "n:a"]).includes("--reason is required"));
  assert.ok(runFail(cwd, ["reconcile", "supersede", "n:a", "n:missing"]).includes("Node not found: n:missing"));
});

test("init refreshes managed edge schema for reconciliation relations", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const schema = path.join(cwd, ".awg/schema/core/edge.schema.json");
  writeFileSync(schema, initialV1EdgeSchemaBody());
  run(cwd, ["init", "--empty"]);
  const parsed = JSON.parse(readFileSync(schema, "utf8"));
  const manifest = JSON.parse(readFileSync(path.join(cwd, ".awg/schema/core/.awg-managed.json"), "utf8"));
  assert.ok(parsed.properties.rel.enum.includes("duplicate_of"));
  assert.ok(parsed.properties.rel.enum.includes("resolved_by"));
  assert.equal(manifest.schemas.edge.hash, schemaContentHash(readFileSync(schema, "utf8")));
});

test("intentionally-open acknowledgements suppress active risk inbox and preflight only when current", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:risk", "--type", "risk", "--title", "Carry risk", "--summary", "Risk.", "--status", "active"]);
  run(cwd, ["run", "start", "--goal", "Carry risk", "--agent", "tester"]);
  let inbox = JSON.parse(run(cwd, ["inbox", "--kind", "risks", "--json"]));
  assert.ok(inbox.items.some((item: { nodeIds: string[] }) => item.nodeIds.includes("n:risk")));
  run(cwd, ["reconcile", "intentionally-open", "n:risk", "--reason", "Known carry-forward for this run."]);
  inbox = JSON.parse(run(cwd, ["inbox", "--kind", "risks", "--json"]));
  assert.ok(!inbox.items.some((item: { nodeIds: string[] }) => item.nodeIds.includes("n:risk")));
  let status = JSON.parse(run(cwd, ["run", "finish", "--status", "completed", "--summary", "Done.", "--force", "--json"]));
  assert.ok(!status.preflight.warnings.some((warning: { code: string; nodeIds?: string[] }) => warning.code === "AWG_RUN_ACTIVE_RISK_TOUCHED" && warning.nodeIds?.includes("n:risk")));
  run(cwd, ["update", "node", "n:risk", "--summary", "Risk changed."]);
  inbox = JSON.parse(run(cwd, ["inbox", "--kind", "risks", "--json"]));
  assert.ok(inbox.items.some((item: { nodeIds: string[] }) => item.nodeIds.includes("n:risk")));
});

test("intentionally-open acknowledgements do not hide orphan nodes", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:orphan-risk", "--type", "risk", "--title", "Orphan risk", "--summary", "Risk.", "--status", "active"]);
  run(cwd, ["reconcile", "intentionally-open", "n:orphan-risk", "--reason", "Known carry-forward."]);
  const doctor = JSON.parse(run(cwd, ["doctor", "--json"]));
  assert.ok(doctor.diagnostics.some((diag: { code: string; id?: string }) => diag.code === "orphan_node" && diag.id === "n:orphan-risk"));
  const inbox = JSON.parse(run(cwd, ["inbox", "--kind", "orphans", "--json"]));
  assert.ok(inbox.items.some((item: { nodeIds: string[] }) => item.nodeIds.includes("n:orphan-risk")));
});

test("run preflight only surfaces inbox items for touched nodes", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:risk", "--type", "risk", "--title", "Unrelated risk", "--summary", "Risk.", "--status", "active"]);
  run(cwd, ["run", "start", "--goal", "Empty run", "--agent", "tester"]);
  const status = JSON.parse(run(cwd, ["run", "finish", "--status", "completed", "--summary", "Done.", "--force", "--json"]));
  assert.ok(!status.preflight.warnings.some((warning: { code: string }) => warning.code === "AWG_RUN_INBOX_ITEM_TOUCHED"));
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

test("node show returns full node detail without mutating logs", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const started = JSON.parse(run(cwd, ["run", "start", "--goal", "Inspect node detail", "--agent", "tester", "--json"]));
  run(cwd, [
    "add", "node",
    "--id", "n:detail",
    "--type", "task",
    "--title", "Detail task",
    "--summary", "Detail summary.",
    "--status", "in_progress",
    "--body", "Full body.\nSecond line.",
    "--fields-json", "{\"owner\":\"agent\",\"crossVaultRefs\":[{\"vaultId\":\"vault:other\",\"rel\":\"affects\",\"reason\":\"Demo impact.\",\"status\":\"open\"}]}",
    "--block-json", "{\"schemaVersion\":1,\"type\":\"brief\",\"data\":{\"items\":[{\"label\":\"Need\",\"text\":\"Show full detail.\"}]}}",
    "--freshness-json", "{\"state\":\"current\",\"last_verified\":\"2026-05-13\"}",
    "--anchor", "file:src/core/nodeDetail.ts"
  ]);
  run(cwd, ["add", "node", "--id", "n:neighbor", "--type", "concept", "--title", "Neighbor", "--summary", "Related neighbor."]);
  run(cwd, ["add", "edge", "--from", "n:detail", "--rel", "relates_to", "--to", "n:neighbor"]);
  run(cwd, ["add", "response", "--type", "note", "--target", "n:detail", "--summary", "Human note."]);
  const evidence = JSON.parse(run(cwd, ["add", "evidence", "--target", "n:detail", "--summary", "Detail verified.", "--source", "terminal", "--command", "npm test", "--status", "passed", "--json"]));
  run(cwd, ["build"]);
  const compiledFiles = [".awg/compiled/graph.json", ".awg/compiled/views/current.json", ".awg/compiled/lenses/resume.json"];
  const compiledBefore = compiledFiles.map((file) => readFileSync(path.join(cwd, file), "utf8"));
  const before = (await new FileAwgStorage(cwd).readLogEntries()).length;
  const detail = JSON.parse(run(cwd, ["node", "show", "n:detail", "--json"]));
  const text = run(cwd, ["node", "show", "n:detail"]);
  const after = (await new FileAwgStorage(cwd).readLogEntries()).length;
  assert.equal(after, before);
  assert.deepEqual(compiledFiles.map((file) => readFileSync(path.join(cwd, file), "utf8")), compiledBefore);
  assert.equal(detail.ok, true);
  assert.equal(detail.nodeId, "n:detail");
  assert.equal(detail.node.body, "Full body.\nSecond line.");
  assert.equal(detail.node.fields.owner, "agent");
  assert.equal(detail.node.fields.crossVaultRefs[0].vaultId, "vault:other");
  assert.equal(detail.node.blocks[0].type, "brief");
  assert.equal(detail.node.freshness.state, "current");
  assert.deepEqual(detail.node.anchors, [{ kind: "file", path: "src/core/nodeDetail.ts", label: "src/core/nodeDetail.ts" }]);
  assert.ok(detail.edges.outgoing.some((edge: { to: string; rel: string }) => edge.to === "n:neighbor" && edge.rel === "relates_to"));
  assert.ok(detail.edges.incoming.some((edge: { from: string; to: string }) => edge.from === evidence.evidenceNodeId && edge.to === "n:detail"));
  assert.equal(detail.responses[0].summary, "Human note.");
  assert.equal(detail.evidence.nodes[0].id, evidence.evidenceNodeId);
  assert.ok(detail.history.snapshotCount >= 2);
  assert.ok(detail.history.snapshots.some((snapshot: { node: { summary: string } }) => snapshot.node.summary === "Detail summary."));
  assert.equal(detail.runAttribution.directRunId, started.runId);
  const runAttribution = detail.runAttribution.runs.find((item: { runId: string }) => item.runId === started.runId);
  assert.ok(runAttribution.roles.includes("created_node"));
  assert.ok(runAttribution.roles.includes("response_target"));
  assert.ok(runAttribution.roles.includes("evidence_target"));
  assert.ok(text.includes("Body:"));
  assert.ok(text.includes("Full body."));
  assert.ok(text.includes("Additional Fields:"));
  assert.ok(text.includes("evidence_required") || text.includes("evidence"));
  assert.ok(text.includes("Run Attribution:"));
  const missingJson = JSON.parse(runFail(cwd, ["node", "show", "n:missing", "--json"]));
  assert.equal(missingJson.ok, false);
  assert.equal(missingJson.code, "node_not_found");
  assert.ok(runFail(cwd, ["node", "show", "n:missing"]).includes("Node not found: n:missing"));
  const built = await buildAwg(new FileAwgStorage(cwd), { write: false });
  assert.equal(buildNodeDetail({ ...built.graph, run_summaries: [{ runId: "run:partial" }] }, "n:detail")?.runAttribution.runs.length, 0);
});

test("node show keeps diagnostic run attribution scoped to the inspected node", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const runA = JSON.parse(run(cwd, ["run", "start", "--goal", "Create orphan A", "--json"]));
  run(cwd, ["add", "node", "--id", "n:orphan-a", "--type", "task", "--title", "Orphan A", "--summary", "Orphan A."]);
  run(cwd, ["run", "finish", "--status", "partial", "--summary", "Left orphan A."]);
  const runB = JSON.parse(run(cwd, ["run", "start", "--goal", "Create orphan B", "--json"]));
  run(cwd, ["add", "node", "--id", "n:orphan-b", "--type", "task", "--title", "Orphan B", "--summary", "Orphan B."]);
  run(cwd, ["run", "finish", "--status", "partial", "--summary", "Left orphan B."]);
  const detail = JSON.parse(run(cwd, ["node", "show", "n:orphan-a", "--json"]));
  const attributedRunIds = detail.runAttribution.runs.map((item: { runId: string }) => item.runId);
  assert.ok(attributedRunIds.includes(runA.runId));
  assert.ok(!attributedRunIds.includes(runB.runId));
});

test("edge-only evidence is consistent across node detail diagnostics and run summaries", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(file), { recursive: true }));
  const at = new Date().toISOString();
  const finishedAt = new Date(Date.now() + 1000).toISOString();
  writeFileSync(file, [
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:edge-evidence:start", type: "run_started", target: "run:edge-evidence", run: "run:edge-evidence", by: "agent:codex", at, goal: "Edge evidence" }),
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:done", type: "task", title: "Done", summary: "Done.", status: "completed", importance: 0.5, confidence: 0.8, created_at: at, updated_at: at, run: "run:edge-evidence" }),
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:proof", type: "evidence", title: "Proof", summary: "Proof.", status: "active", importance: 0.5, confidence: 0.8, created_at: at, updated_at: at, run: "run:edge-evidence" }),
    JSON.stringify({ awg: "0.1", kind: "edge", id: "e:proof-supports-done", from: "n:proof", rel: "supports", to: "n:done", created_at: at, run: "run:edge-evidence" }),
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:edge-evidence:finish", type: "run_finished", target: "run:edge-evidence", run: "run:edge-evidence", by: "agent:codex", at: finishedAt, status: "completed", summary: "Finished with edge evidence." })
  ].join("\n") + "\n");
  const result = await buildAwg(new FileAwgStorage(cwd), { write: false });
  assert.ok(!result.diagnostics.diagnostics.some((diag) => diag.code === "completed_task_without_evidence" && diag.id === "n:done"));
  assert.ok(!result.diagnostics.diagnostics.some((diag) => diag.code === "completed_run_without_evidence_or_changes" && diag.id === "run:edge-evidence"));
  const summary = (result.graph.run_summaries as Array<{ runId: string; completedTasksMissingEvidence: string[] }>).find((item) => item.runId === "run:edge-evidence");
  assert.ok(summary);
  assert.ok(!summary.completedTasksMissingEvidence.includes("n:done"));
  const detail = buildNodeDetail(result.graph, "n:done");
  assert.equal(detail?.evidence.nodes[0].id, "n:proof");
});

test("malformed inline evidence does not satisfy evidence gates", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(file), { recursive: true }));
  const at = "2026-01-01T00:00:00.000Z";
  writeFileSync(file, `${JSON.stringify({ awg: "0.1", kind: "node", id: "n:bad-evidence", type: "task", title: "Bad evidence", summary: "Malformed evidence.", status: "completed", importance: 0.5, confidence: 0.8, created_at: at, updated_at: at, evidence: [{}], run: "run:bad-evidence" })}\n`);
  const result = await buildAwg(new FileAwgStorage(cwd), { write: false });
  assert.ok(result.diagnostics.diagnostics.some((diag) => diag.code === "completed_task_without_evidence" && diag.id === "n:bad-evidence"));
  const summary = (result.graph.run_summaries as Array<{ runId: string; completedTasksMissingEvidence: string[] }>).find((item) => item.runId === "run:bad-evidence");
  assert.ok(summary?.completedTasksMissingEvidence.includes("n:bad-evidence"));
  const detail = buildNodeDetail(result.graph, "n:bad-evidence");
  assert.deepEqual(detail?.evidence.nodes, []);
});

test("unresolved inline evidence ids do not satisfy evidence gates", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(file), { recursive: true }));
  const at = "2026-01-01T00:00:00.000Z";
  writeFileSync(file, `${JSON.stringify({ awg: "0.1", kind: "node", id: "n:missing-evidence-ref", type: "task", title: "Missing evidence ref", summary: "Broken evidence reference.", status: "completed", importance: 0.5, confidence: 0.8, created_at: at, updated_at: at, evidence: [{ id: "n:missing-proof" }], run: "run:missing-evidence-ref" })}\n`);
  const result = await buildAwg(new FileAwgStorage(cwd), { write: false });
  assert.ok(result.diagnostics.diagnostics.some((diag) => diag.code === "completed_task_without_evidence" && diag.id === "n:missing-evidence-ref"));
  const detail = buildNodeDetail(result.graph, "n:missing-evidence-ref");
  assert.deepEqual(detail?.evidence.nodes, []);
});

test("node show exposes duplicate node snapshots without raw jsonl inspection", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(file), { recursive: true }));
  writeFileSync(file, [
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:dup", type: "task", title: "Dup", summary: "Original.", status: "active", importance: 0.5, confidence: 0.8, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", fields: { version: 1 } }),
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:dup", type: "task", title: "Dup", summary: "Replacement.", status: "active", importance: 0.5, confidence: 0.8, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T00:00:00.000Z", fields: { version: 2 } })
  ].join("\n") + "\n");
  const detail = JSON.parse(run(cwd, ["node", "show", "n:dup", "--json"]));
  assert.equal(detail.node.summary, "Replacement.");
  assert.equal(detail.history.snapshotCount, 2);
  assert.deepEqual(detail.history.snapshots.map((snapshot: { node: { fields: { version: number } } }) => snapshot.node.fields.version), [1, 2]);
  assert.ok(detail.diagnostics.some((diag: { code: string }) => diag.code === "duplicate_id_upsert"));
  const inbox = JSON.parse(run(cwd, ["inbox", "--json"]));
  assert.ok(inbox.items.some((item: { kind: string; code: string; nodeIds: string[]; suggestedCommands: string[] }) => item.kind === "hygiene" && item.code === "AWG_INBOX_DUPLICATE_ID_UPSERT" && item.nodeIds.includes("n:dup") && item.suggestedCommands.includes("awg node show n:dup --json")));
  assert.ok(!inbox.items.some((item: { kind: string; code: string; nodeIds: string[] }) => item.kind === "duplicates" && item.code === "AWG_INBOX_DUPLICATE_SIGNAL" && item.nodeIds.includes("n:dup")));
});

test("maintenance inbox treats duplicate non-node ids as hygiene without reconciliation commands", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(file), { recursive: true }));
  const event = { awg: "0.1", kind: "event", id: "ev:dup", type: "note", target: "n:missing", by: "agent:test", at: "2026-01-01T00:00:00.000Z" };
  writeFileSync(file, `${JSON.stringify(event)}\n${JSON.stringify(event)}\n`);
  const inbox = JSON.parse(run(cwd, ["inbox", "--json"]));
  const item = inbox.items.find((candidate: { code: string }) => candidate.code === "AWG_INBOX_DUPLICATE_ID_UPSERT");
  assert.equal(item.kind, "hygiene");
  assert.deepEqual(item.nodeIds, []);
  assert.deepEqual(item.suggestedCommands, []);
  assert.ok(!inbox.items.some((candidate: { kind: string; code: string }) => candidate.kind === "duplicates" && candidate.code === "AWG_INBOX_DUPLICATE_SIGNAL"));
});

test("update node appends an upsert and event without touching compiled source", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:update", "--type", "task", "--title", "Update", "--summary", "Old.", "--tag", "old"]);
  run(cwd, ["build"]);
  const compiledBefore = readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8");
  const output = JSON.parse(run(cwd, ["update", "node", "n:update", "--summary", "New.", "--status", "completed", "--type", "client-record", "--tag", "new", "--anchor", "url:https://example.com/a:b", "--json"]));
  assert.equal(output.ok, true);
  assert.equal(output.nodeId, "n:update");
  assert.ok(output.eventId);
  assert.equal(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"), compiledBefore);
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  const node = graph.nodes.find((item: { id: string }) => item.id === "n:update");
  assert.equal(node.summary, "New.");
  assert.equal(node.status, "completed");
  assert.equal(node.type, "client-record");
  assert.deepEqual(node.tags, ["new", "old"]);
  assert.deepEqual(node.anchors, [{ kind: "url", url: "https://example.com/a:b" }]);
  assert.ok(graph.events.some((event: { type: string; target: string }) => event.type === "node_updated" && event.target === "n:update"));
  assert.ok(!graph.diagnostics.diagnostics.some((diag: { code: string; id: string }) => diag.code === "duplicate_id_upsert" && diag.id === "n:update"));
  assert.ok(graph.diagnostics.diagnostics.some((diag: { code: string; id: string; severity: string }) => diag.code === "unknown_node_type" && diag.id === "n:update" && diag.severity === "warning"));
  assert.ok((await new FileAwgStorage(cwd).readLogEntries()).length >= 3);
  assert.ok(runFail(cwd, ["update", "node", "n:update", "--status", "not-real"]).includes("--status must be one of"));
  assert.ok(runFail(cwd, ["update", "node", "n:missing", "--status", "active"]).includes("Node not found"));
});

test("rich node writes support body fields blocks freshness anchors and fail before append on malformed JSON", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const created = JSON.parse(run(cwd, [
    "add", "node",
    "--id", "n:rich",
    "--type", "task",
    "--title", "Rich",
    "--summary", "Concise retrieval text.",
    "--body", "Narrative detail.",
    "--field", "priority=2",
    "--field-json", "{\"owner\":\"codex\"}",
    "--block-json", "{\"schemaVersion\":1,\"type\":\"brief\",\"data\":{\"items\":[{\"label\":\"Summary\",\"text\":\"Block text.\"}]}}",
    "--freshness-json", "{\"state\":\"current\",\"last_verified\":\"2026-05-13\"}",
    "--anchor", "file:src/core/types.ts",
    "--json"
  ]));
  assert.equal(created.ok, true);
  assert.deepEqual(created.node.fields, { owner: "codex", priority: 2 });
  assert.equal(created.node.blocks[0].type, "brief");
  assert.equal(created.node.freshness.state, "current");
  const beforeFail = (await new FileAwgStorage(cwd).readLogEntries()).length;
  assert.ok(runFail(cwd, ["update", "node", "n:rich", "--field-json", "{bad"]).includes("--field-json contains malformed JSON"));
  assert.ok(runFail(cwd, ["update", "node", "n:rich", "--blocks-json"]).includes("--blocks-json requires a JSON value or @file"));
  assert.ok(runFail(cwd, ["update", "node", "n:rich", "--anchors-json"]).includes("--anchors-json requires a JSON value or @file"));
  assert.ok(runFail(cwd, ["update", "node", "n:rich", "--freshness-json", "{\"state\":\"bogus\"}"]).includes("--freshness-json state must be one of"));
  assert.ok(runFail(cwd, ["update", "node", "n:rich", "--anchors-json", "[{\"kind\":\"bogus\"}]"]).includes("--anchors-json[0].kind must be one of"));
  assert.ok(runFail(cwd, ["update", "node", "n:rich", "--block-json", "{\"schemaVersion\":1,\"type\":\"brief\",\"data\":{\"text\":\"Bad refs.\"},\"sourceNodeIds\":[1]}"]).includes("invalid block"));
  assert.equal((await new FileAwgStorage(cwd).readLogEntries()).length, beforeFail);
  const updated = JSON.parse(run(cwd, [
    "update", "node", "n:rich",
    "--field", "priority=3",
    "--unset-field", "owner",
    "--block-json", "{\"schemaVersion\":1,\"type\":\"callout\",\"tone\":\"warning\",\"data\":{\"text\":\"Check this.\"}}",
    "--review-after", "2020-01-01",
    "--unset-anchor", "file:src/core/types.ts",
    "--json"
  ]));
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.node.fields, { priority: 3 });
  assert.equal(updated.node.blocks.length, 2);
  assert.deepEqual(updated.node.anchors, []);
  const replaced = JSON.parse(run(cwd, [
    "update", "node", "n:rich",
    "--clear-blocks",
    "--block-json", "{\"schemaVersion\":1,\"type\":\"brief\",\"data\":{\"text\":\"Replacement only.\"}}",
    "--json"
  ]));
  assert.equal(replaced.ok, true);
  assert.equal(replaced.node.blocks.length, 1);
  assert.equal(replaced.node.blocks[0].data.text, "Replacement only.");
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  const node = graph.nodes.find((item: { id: string }) => item.id === "n:rich");
  assert.equal(node.body, "Narrative detail.");
  assert.equal(node.freshness.review_after, "2020-01-01");
  assert.ok(graph.diagnostics.diagnostics.some((diag: { code: string; id: string }) => diag.code === "stale_node" && diag.id === "n:rich"));
});

test("block diagnostics and viewer fallbacks are safe for unsupported blocks", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  assert.ok(runFail(cwd, ["add", "node", "--id", "n:blocky", "--type", "task", "--title", "Blocky", "--summary", "Blocky.", "--blocks-json", "[{\"schemaVersion\":1,\"type\":\"chart\",\"data\":{}}]"]).toLowerCase().includes("unsupported"));
  const hugeBlockFile = path.join(cwd, "huge-block.json");
  writeFileSync(hugeBlockFile, JSON.stringify({ schemaVersion: 1, type: "brief", data: { text: "A".repeat(100_001) } }));
  assert.ok(runFail(cwd, ["add", "node", "--id", "n:huge-block", "--type", "task", "--title", "Huge block", "--summary", "Huge.", "--blocks-json", `@${hugeBlockFile}`]).includes("Block data is too large"));
  run(cwd, ["add", "node", "--id", "n:blocky", "--type", "task", "--title", "Blocky", "--summary", "Blocky.", "--blocks-json", "[{\"schemaVersion\":1,\"type\":\"checklist\",\"data\":{\"items\":[{\"label\":\"Done\",\"status\":\"done\"}]}},{\"schemaVersion\":1,\"type\":\"timeline\",\"data\":{\"items\":[{\"label\":\"Fallback\",\"summary\":\"Fallback\"}]}}]"]);
  run(cwd, ["add", "node", "--id", "n:list-block", "--type", "task", "--title", "List block", "--summary", "List block.", "--blocks-json", "{\"schemaVersion\":1,\"type\":\"node-list\",\"title\":\"Tasks\",\"data\":{\"query\":{\"type\":\"task\"}}}"]);
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.ok(!graph.diagnostics.diagnostics.some((diag: { code: string; id: string }) => diag.code === "unsupported_block_type" && diag.id === "n:blocky"));
  const html = readFileSync(path.join(cwd, ".awg/compiled/site/app.js"), "utf8");
  assert.ok(html.includes("Unsupported block type"));
  assert.ok(html.includes("block.data?.query"));
  assert.equal(unsupportedBlockFallback({ type: "chart" }), "Unsupported block type: chart");
  const strictCwd = tmp();
  run(strictCwd, ["init", "--empty"]);
  const file = path.join(strictCwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, [
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:bad-block", type: "task", title: "Bad block", summary: "Bad block.", status: "active", importance: 0.5, confidence: 0.8, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", blocks: [{ schemaVersion: 1, type: "chart", data: {} }] }),
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:related", type: "concept", title: "Related", summary: "Related.", status: "active", importance: 0.5, confidence: 0.8, created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z" }),
    JSON.stringify({ awg: "0.1", kind: "edge", id: "e:bad-block-related", from: "n:bad-block", rel: "relates_to", to: "n:related", created_at: "2026-01-01T00:00:00.000Z" })
  ].join("\n") + "\n");
  const strictOutput = JSON.parse(runFail(strictCwd, ["build", "--strict", "--json"]));
  assert.ok(strictOutput.fatal_error_count >= 1);
  assert.ok(JSON.parse(readFileSync(path.join(strictCwd, ".awg/compiled/reports/diagnostics.json"), "utf8")).diagnostics.some((diag: { code: string; severity: string }) => diag.code === "unsupported_block_type" && diag.severity === "fatal"));
});

test("V1.7 presentation block contract accepts only safe authored MVP primitives", () => {
  for (const type of ["brief", "callout", "metric-row", "table", "checklist", "node-list", "timeline"]) {
    assert.ok((MVP_BLOCK_TYPES as readonly string[]).includes(type));
  }
  for (const type of ["task-queue", "risk-list", "decision-list", "evidence-list", "run-summary"]) {
    assert.ok(!(MVP_BLOCK_TYPES as readonly string[]).includes(type));
    assert.ok(validatePresentationBlock({ schemaVersion: 1, type, data: { query: { type: "task" } } }).some((diag) => diag.code === "unsupported_block_type"));
  }
  const blocks = [
    { schemaVersion: 1, type: "brief", data: { items: [{ label: "One", text: "Summary." }] } },
    { schemaVersion: 1, type: "callout", data: { text: "Review this." } },
    { schemaVersion: 1, type: "metric-row", data: { items: [{ label: "Changed", value: 2 }] } },
    { schemaVersion: 1, type: "table", data: { columns: [{ key: "status", label: "Status" }, "owner"], rows: [{ status: "active", owner: "codex" }] } },
    { schemaVersion: 1, type: "checklist", data: { items: [{ label: "Done item", status: "done" }] } },
    { schemaVersion: 1, type: "node-list", data: { nodeIds: ["n:decision"] } },
    { schemaVersion: 1, type: "timeline", data: { items: [{ label: "Started", at: "2026-05-13" }] } }
  ];
  for (const block of blocks) assert.deepEqual(validatePresentationBlock(block), []);
  assert.ok(validatePresentationBlock({ schemaVersion: 1, type: "table", data: { columns: [{ label: "Missing key" }], rows: [] } }).some((diag) => diag.code === "invalid_block_data"));
});

test("authored views compile, list, show, route, and validate safe query blocks", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["run", "start", "--goal", "View surface smoke", "--agent", "test"]);
  run(cwd, ["add", "node", "--id", "n:view-task", "--type", "task", "--title", "View task", "--summary", "Appears in the view.", "--status", "active"]);
  const view = JSON.parse(run(cwd, [
    "add", "view",
    "--id", "v:ops-review",
    "--title", "Ops Review",
    "--summary", "Active work and risks.",
    "--audience", "human",
    "--tag", "review",
    "--blocks-json", "[{\"schemaVersion\":1,\"type\":\"node-table\",\"title\":\"Active Work\",\"data\":{\"query\":{\"types\":[\"task\"],\"statuses\":[\"active\"],\"limit\":20,\"sortBy\":\"updated\"},\"columns\":[\"status\",\"title\",\"updated_at\"]}},{\"schemaVersion\":1,\"type\":\"callout\",\"title\":\"Safety\",\"data\":{\"text\":\"<script>alert(1)</script> renders as text.\"}}]",
    "--json"
  ]));
  assert.equal(view.ok, true);
  assert.ok(view.view.run.startsWith("run:"));
  run(cwd, ["run", "finish", "--status", "completed", "--summary", "Created initial authored view.", "--auto-handoff", "--force"]);
  const updateRun = JSON.parse(run(cwd, ["run", "start", "--goal", "Update authored view", "--agent", "test", "--json"]));
  const updated = JSON.parse(run(cwd, ["update", "view", "v:ops-review", "--summary", "Updated surface.", "--block-json", "{\"schemaVersion\":1,\"type\":\"risk-list\",\"title\":\"Risks\",\"data\":{\"query\":{\"type\":\"risk\",\"limit\":5}}}", "--json"]));
  assert.equal(updated.ok, true);
  assert.equal(updated.view.run, updateRun.run.id);
  assert.equal(updated.updatedKeys.includes("summary"), true);
  run(cwd, ["run", "finish", "--status", "completed", "--summary", "Updated authored view.", "--auto-handoff", "--force"]);
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.equal(graph.views.length, 1);
  assert.equal(graph.authored_views[0].id, "v:ops-review");
  assert.equal(graph.authored_views[0].diagnostics.length, 0);
  assert.ok(existsSync(path.join(cwd, ".awg/compiled/views/djpvcHMtcmV2aWV3.json")));
  const compiledView = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/views/djpvcHMtcmV2aWV3.json"), "utf8"));
  assert.equal(compiledView.kind, "view-output");
  assert.equal(compiledView.blocks[0].type, "node-table");
  assert.equal(compiledView.blocks[2].type, "risk-list");
  assert.ok((graph.run_summaries as Array<{ viewIds?: string[] }>).some((summary) => summary.viewIds?.includes("v:ops-review")));
  assert.ok(!graph.diagnostics.diagnostics.some((diag: { code: string; id: string }) => diag.code === "completed_run_without_evidence_or_changes" && diag.id === updateRun.run.id));
  const listed = JSON.parse(run(cwd, ["view", "list", "--json"]));
  assert.ok(listed.views.some((item: { id: string; diagnostics: number; audience: string }) => item.id === "v:ops-review" && item.diagnostics === 0 && item.audience === "human"));
  const shown = JSON.parse(run(cwd, ["view", "show", "v:ops-review", "--json"]));
  assert.equal(shown.view.id, "v:ops-review");
  const app = readFileSync(path.join(cwd, ".awg/compiled/site/app.js"), "utf8");
  assert.ok(app.includes("graph.authored_views"));
  assert.ok(app.includes("#/views/"));
  const html = readFileSync(path.join(cwd, ".awg/compiled/site/index.html"), "utf8");
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("\\u003cscript>alert(1)\\u003c/script>"));
});

test("authored view invalid blocks fail before append and warn in historical logs", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  assert.ok(runFail(cwd, ["add", "view", "--id", "v:", "--title", "Bad", "--summary", "Bad.", "--audience", "human", "--blocks-json", "[{\"schemaVersion\":1,\"type\":\"brief\",\"data\":\"Bad\"}]"]).includes("non-empty slug"));
  assert.ok(runFail(cwd, ["add", "view", "--id", "v:bad", "--title", "Bad", "--summary", "Bad.", "--audience", "human", "--blocks-json", "[{\"schemaVersion\":1,\"type\":\"node-table\",\"data\":{\"query\":{\"regex\":\"nope\"}}}]"]).includes("Unsupported view query key"));
  assert.ok((VIEW_BLOCK_TYPES as readonly string[]).includes("task-queue"));
  assert.deepEqual(validateViewBlock({ schemaVersion: 1, type: "task-queue", data: { query: { type: "task", needsReview: true } } }), []);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, [
    JSON.stringify({ awg: "0.1", kind: "view", id: "v:legacy", title: "Legacy View" }),
    JSON.stringify({ awg: "0.1", kind: "view", id: "v:historic-bad", title: "Historic Bad", audience: "human", blocks: [{ schemaVersion: 1, type: "raw-json", data: { html: "<script>bad()</script>" } }] }),
    JSON.stringify({ awg: "0.1", kind: "view", id: "v:a/b", title: "Slash", audience: "human", blocks: [{ schemaVersion: 1, type: "brief", data: "Slash" }] }),
    JSON.stringify({ awg: "0.1", kind: "view", id: "v:a?b", title: "Question", audience: "human", blocks: [{ schemaVersion: 1, type: "brief", data: "Question" }] }),
    JSON.stringify({ awg: "0.1", kind: "view", id: "v:a~2Fb", title: "Tilde", audience: "human", blocks: [{ schemaVersion: 1, type: "diagnostic-list", data: { query: { severity: "warning", limit: 1 } } }] })
  ].join("\n") + "\n");
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.ok(graph.diagnostics.diagnostics.some((diag: { code: string; id: string }) => diag.code === "unsupported_block_type" && diag.id === "v:historic-bad"));
  assert.ok(graph.authored_views.some((view: { id: string; audience: string; blocks: unknown[] }) => view.id === "v:legacy" && view.audience === "human" && view.blocks.length === 0));
  const artifactNames = readdirSync(path.join(cwd, ".awg/compiled/views"));
  assert.ok(artifactNames.includes("djphL2I.json"));
  assert.ok(artifactNames.includes("djphP2I.json"));
  assert.ok(artifactNames.includes("djphfjJGYg.json"));
  const app = readFileSync(path.join(cwd, ".awg/compiled/site/app.js"), "utf8");
  assert.ok(app.includes("Unsupported block type"));
  assert.ok(app.includes("authoredViewBlockTypes"));
});

test("configurable vault lenses add, update, list, show, run, and compile index", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const started = JSON.parse(run(cwd, ["run", "start", "--goal", "Lens config smoke", "--agent", "test", "--json"]));
  run(cwd, ["add", "node", "--id", "n:lens-task", "--type", "task", "--title", "Lens task", "--summary", "Task selected by configurable lens.", "--status", "active", "--tag", "lens-smoke"]);
  run(cwd, ["add", "node", "--id", "n:lens-evidence", "--type", "evidence", "--title", "Lens evidence", "--summary", "Evidence selected by configurable lens.", "--status", "active", "--tag", "lens-smoke"]);
  const sections = JSON.stringify([
    { id: "search", title: "Search", source: "search", query: { text: "$goal" }, limit: 10 },
    { id: "nodes", source: "nodes", query: { tags: ["lens-smoke"] }, limit: 10 },
    { id: "evidence", source: "evidence", query: { tags: ["lens-smoke"] }, limit: 10 },
    { id: "runs", source: "runs", limit: 5 },
    { id: "inbox", source: "maintenanceInbox", limit: 5 },
    { id: "diagnostics", source: "diagnostics", limit: 5 },
    { id: "template", source: "templateContext", limit: 1 },
    { id: "topology", source: "topology", limit: 1 },
    { id: "anchors", source: "anchors", limit: 5 },
    { id: "static", source: "static", items: [{ id: "static-note", summary: "Static local guidance." }] }
  ]);
  const added = JSON.parse(run(cwd, [
    "add", "lens",
    "--id", "lens:ops-review",
    "--title", "Ops Review Lens",
    "--purpose", "Retrieve repeated ops review context.",
    "--scope", "vault",
    "--audience", "agent",
    "--sections-json", sections,
    "--selector-json", "{\"goalTerms\":[\"lens\"]}",
    "--budget-json", "{\"default\":1200}",
    "--tag", "lens-smoke",
    "--json"
  ]));
  assert.equal(added.ok, true);
  assert.equal(added.lens.run, started.run.id);
  const updated = JSON.parse(run(cwd, ["update", "lens", "lens:ops-review", "--status", "active", "--section-json", "{\"id\":\"view\",\"source\":\"view\",\"limit\":5}", "--tag", "reviewed", "--json"]));
  assert.equal(updated.ok, true);
  assert.equal(updated.lens.status, "active");
  assert.ok(updated.updatedKeys.includes("status"));
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.equal(graph.lenses.length, 1);
  assert.equal(graph.lens_index.lenses[0].id, "lens:ops-review");
  assert.ok(existsSync(path.join(cwd, ".awg/compiled/lenses/index.json")));
  assert.ok((graph.run_summaries as Array<{ lensIds?: string[] }>).some((summary) => summary.lensIds?.includes("lens:ops-review")));
  const listed = JSON.parse(run(cwd, ["lens", "list", "--goal", "Lens task", "--json"]));
  assert.ok(listed.lenses.some((lens: { id: string }) => lens.id === "lens:ops-review"));
  const shown = JSON.parse(run(cwd, ["lens", "show", "lens:ops-review", "--json"]));
  assert.equal(shown.lens.id, "lens:ops-review");
  const before = canonicalLogSnapshot(cwd);
  const output = JSON.parse(run(cwd, ["lens", "run", "lens:ops-review", "--goal", "Lens task", "--json"]));
  assert.equal(output.kind, "lens-output");
  assert.equal(output.budget, 1200);
  assert.equal(output.lensId, "lens:ops-review");
  assert.ok(output.sections.some((section: { section: string; items: unknown[] }) => section.section === "nodes" && JSON.stringify(section.items).includes("n:lens-task")));
  assert.equal(JSON.stringify(output.sections).includes("Task selected by configurable lens."), true);
  assert.equal(JSON.stringify(output.sections).includes("\"body\""), false);
  assert.ok(output.sections.some((section: { source: string }) => section.source === "maintenanceInbox"));
  assert.ok(output.sections.some((section: { source: string }) => section.source === "templateContext"));
  assert.ok(output.sections.some((section: { source: string }) => section.source === "topology"));
  assert.ok(output.sections.some((section: { source: string }) => section.source === "anchors"));
  assert.ok(output.sections.some((section: { source: string }) => section.source === "view"));
  const after = canonicalLogSnapshot(cwd);
  assert.equal(after, before);
  assert.equal(graph.diagnostics.diagnostics.some((diag: { code: string; id: string }) => diag.code === "duplicate_id_upsert" && diag.id === "lens:ops-review"), false);
});

test("configurable lens compatibility, run flags, and validation failures", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ awg: "0.1", kind: "lens", id: "lens:legacy", title: "Legacy Lens", include: ["nodes", { id: "legacy-active", source: "active_tasks" }] })}\n`);
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.equal(graph.lenses[0].id, "lens:legacy");
  assert.equal(graph.lens_index.lenses[0].sectionCount, 2);
  assert.ok(run(cwd, ["lens", "show", "lens:legacy"]).includes("legacy-active: nodes"));
  const legacyUpdated = JSON.parse(run(cwd, ["update", "lens", "lens:legacy", "--section-json", "{\"id\":\"extra\",\"source\":\"static\",\"items\":[{\"summary\":\"extra\"}]}", "--json"]));
  assert.equal(legacyUpdated.lens.sections.length, 3);
  run(cwd, ["build"]);
  const legacyGraph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.equal(legacyGraph.lens_index.lenses.find((lens: { id: string }) => lens.id === "lens:legacy").sectionCount, 3);
  assert.ok(runFail(cwd, ["add", "lens", "--id", "bad", "--title", "Bad", "--purpose", "Bad.", "--sections-json", "[]"]).includes("Lens id must be"));
  assert.ok(runFail(cwd, ["add", "lens", "--id", "lens:bad-status", "--title", "Bad", "--purpose", "Bad.", "--status", "done", "--sections-json", "[]"]).includes("status must be"));
  assert.ok(runFail(cwd, ["add", "lens", "--id", "lens:bad-json", "--title", "Bad", "--purpose", "Bad.", "--sections-json", "{"]).includes("malformed JSON"));
  assert.ok(runFail(cwd, ["add", "lens", "--id", "lens:bad-source", "--title", "Bad", "--purpose", "Bad.", "--sections-json", "[{\"id\":\"x\",\"source\":\"shell\"}]"]).includes("Unsupported lens section source"));
  assert.ok(runFail(cwd, ["add", "lens", "--id", "lens:bad-query", "--title", "Bad", "--purpose", "Bad.", "--sections-json", "[{\"id\":\"x\",\"source\":\"nodes\",\"query\":{\"regex\":\"nope\"}}]"]).includes("Unsupported lens query keys"));
  const activeRun = JSON.parse(run(cwd, ["run", "start", "--goal", "Lens run flag smoke", "--agent", "test", "--json"]));
  const withRun = JSON.parse(run(cwd, ["add", "lens", "--id", "lens:with-run", "--title", "With Run", "--purpose", "Run attached.", "--sections-json", "[{\"id\":\"static\",\"source\":\"static\",\"items\":[{\"summary\":\"ok\"}]}]", "--json"]));
  assert.equal(withRun.lens.run, activeRun.run.id);
  const noRun = JSON.parse(run(cwd, ["add", "lens", "--id", "lens:no-run", "--title", "No Run", "--purpose", "Run suppressed.", "--sections-json", "[{\"id\":\"static\",\"source\":\"static\",\"items\":[{\"summary\":\"ok\"}]}]", "--no-run", "--json"]));
  assert.equal(noRun.lens.run, undefined);
  run(cwd, ["add", "lens", "--id", "lens:selector-a", "--title", "Selector A", "--purpose", "Selector warning.", "--status", "active", "--selector-json", "{\"goalTerms\":[\"same\"]}", "--sections-json", "[{\"id\":\"static\",\"source\":\"static\",\"items\":[{\"summary\":\"ok\"}]}]"]);
  run(cwd, ["add", "lens", "--id", "lens:selector-b", "--title", "Selector B", "--purpose", "Selector warning.", "--status", "active", "--selector-json", "{\"goalTerms\":[\"same\"]}", "--sections-json", "[{\"id\":\"static\",\"source\":\"static\",\"items\":[{\"summary\":\"ok\"}]}]"]);
  run(cwd, ["build"]);
  const runGraph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  const summary = (runGraph.run_summaries as Array<{ runId: string; lensIds?: string[]; diagnostics?: Array<{ code: string }> }>).find((item) => item.runId === activeRun.run.id);
  assert.ok(summary?.lensIds?.includes("lens:selector-a"));
  assert.ok(summary?.diagnostics?.some((diag) => diag.code === "duplicate_active_lens_selector"));
});

test("template status is read only and emits deterministic json", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:ordinary", "--type", "concept", "--title", "Ordinary", "--summary", "Ordinary node."]);
  const noTemplate = JSON.parse(run(cwd, ["template", "status", "--json"]));
  assert.equal(noTemplate.ok, false);
  const noTemplateDoctor = JSON.parse(run(cwd, ["doctor", "--fix-suggestions", "--json"]));
  assert.ok(noTemplateDoctor.diagnostics.some((diag: { code: string }) => diag.code === "template_no_active_template"));
  assert.ok(noTemplateDoctor.fixSuggestions.some((suggestion: { code: string }) => suggestion.code === "AWG_HEALTH_CREATE_OPERATING_TEMPLATE"));
  assert.equal(existsSync(path.join(cwd, ".awg/compiled/graph.json")), false);
  run(cwd, ["add", "node", "--id", "n:template", "--type", "process", "--title", "Project operating template", "--summary", "Project conventions.", "--status", "active", "--fields-json", "{\"scope\":\"project\",\"purpose\":\"Keep conventions local.\",\"taxonomy\":{\"types\":[\"task\"]},\"freshness_rules\":\"Review on behavior changes.\",\"agent_rules\":\"Search before creating nodes.\",\"review_state\":\"reviewed\",\"human_review_required\":true,\"human_approved\":true,\"fieldRules\":[{\"nodeType\":\"task\",\"field\":\"owner\",\"required\":true}]}", "--tag", "template:operating"]);
  const before = (await new FileAwgStorage(cwd).readLogEntries()).length;
  const status = JSON.parse(run(cwd, ["template", "status", "--goal", "project conventions", "--json"]));
  assert.equal(status.ok, true);
  assert.equal(status.activeTemplateId, "n:template");
  assert.equal(status.activeTemplates[0].scope, "project");
  assert.equal(status.activeTemplates[0].humanApproved, true);
  assert.equal(status.selectedTemplate.id, "n:template");
  assert.deepEqual(status.missingSections, []);
  assert.equal((await new FileAwgStorage(cwd).readLogEntries()).length, before);
  run(cwd, ["add", "node", "--id", "n:templated-task", "--type", "task", "--title", "Templated task", "--summary", "Missing owner."]);
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.equal(graph.operating_templates.activeTemplateId, "n:template");
  assert.ok(graph.diagnostics.diagnostics.some((diag: { code: string; id: string }) => diag.code === "missing_required_field" && diag.id === "n:templated-task"));
  assert.ok(existsSync(path.join(cwd, ".awg/compiled/indexes/operating-templates.json")));
  const doctor = JSON.parse(run(cwd, ["doctor", "--fix-suggestions", "--json"]));
  assert.ok(doctor.fixSuggestions.some((suggestion: { code: string; suggestedCommands: string[] }) => suggestion.code === "AWG_HEALTH_ADD_TEMPLATE_FIELD" && suggestion.suggestedCommands[0].includes("--field owner=...")));
  assert.equal(existsSync(path.join(cwd, ".awg/compiled/graph.json")), true);
});

test("template field rules respect deterministic appliesTo boundaries", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:seo-template", "--type", "process", "--title", "SEO operating template", "--summary", "SEO conventions.", "--status", "active", "--tag", "template:operating", "--fields-json", "{\"scope\":\"seo\",\"appliesTo\":{\"client\":\"acme\"},\"purpose\":\"SEO work.\",\"taxonomy\":{\"types\":[\"task\"]},\"freshness_rules\":\"Review after audits.\",\"agent_rules\":\"Use site evidence.\",\"review_state\":\"reviewed\",\"fieldRules\":[{\"nodeType\":\"task\",\"field\":\"owner\",\"required\":true}]}"]);
  run(cwd, ["add", "node", "--id", "n:plain-task", "--type", "task", "--title", "Plain task", "--summary", "Not SEO."]);
  run(cwd, ["add", "node", "--id", "n:seo-task", "--type", "task", "--title", "SEO task", "--summary", "SEO.", "--fields-json", "{\"client\":\"acme\"}"]);
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.ok(graph.diagnostics.diagnostics.some((diag: { code: string; id: string }) => diag.code === "missing_required_field" && diag.id === "n:seo-task"));
  assert.ok(!graph.diagnostics.diagnostics.some((diag: { code: string; id: string }) => diag.code === "missing_required_field" && diag.id === "n:plain-task"));
});

test("rich content participates in deterministic search", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:search-rich", "--type", "task", "--title", "Opaque", "--summary", "Does not mention the key phrase.", "--body", "Contains retrieval-only phrase alpaca-blue.", "--fields-json", "{\"owner\":\"field-owner\"}", "--freshness-json", "{\"state\":\"unknown\"}"]);
  const fromBody = JSON.parse(run(cwd, ["search", "alpaca-blue", "--json"]));
  assert.deepEqual(fromBody.results.map((item: { id: string }) => item.id), ["n:search-rich"]);
  const fromFields = JSON.parse(run(cwd, ["search", "field-owner", "--json"]));
  assert.deepEqual(fromFields.results.map((item: { id: string }) => item.id), ["n:search-rich"]);
  run(cwd, ["add", "node", "--id", "n:secret-ish", "--type", "concept", "--title", "Secretish", "--summary", "Search safe.", "--fields-json", "{\"api_key\":\"sk-123456789012345678901234567890\"}"]);
  const secretSearch = JSON.parse(run(cwd, ["search", "123456789012345678901234567890", "--json"]));
  assert.deepEqual(secretSearch.results.map((item: { id: string }) => item.id), []);
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  assert.ok(graph.diagnostics.diagnostics.some((diag: { code: string; id: string }) => diag.code === "sensitive_value_detected" && diag.id === "n:secret-ish"));
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

test("release notes, relations, evidence help, and generated instructions expose V1.9.1 ergonomics", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const release = JSON.parse(run(cwd, ["release", "notes", "--json"]));
  assert.equal(release.ok, true);
  const v191 = release.releases.find((item: { version: string }) => item.version === "0.1.0-v2.1");
  assert.ok(v191.newCommands.includes("awg rels [--json]"));
  assert.ok(release.releases[0].newCommands.some((command: string) => command.startsWith("awg queue next")));
  assert.ok(release.releases.some((item: { newCommands: string[] }) => item.newCommands.some((command: string) => command.startsWith("awg add claim"))));
  assert.ok(run(cwd, ["release", "current"]).includes("AWG release"));
  const rels = JSON.parse(run(cwd, ["rels", "--json"]));
  assert.ok(rels.relations.some((rel: { id: string; example: string }) => rel.id === "relates_to" && rel.example.includes("--rel relates_to")));
  assert.ok(runFail(cwd, ["add", "edge", "--from", "n:a", "--rel", "similar_to", "--to", "n:b"]).includes("Run awg rels"));
  const help = run(cwd, ["--help"]);
  for (const flag of ["--source", "--command", "--path", "--status", "--rel", "--target", "--summary", "--json"]) assert.ok(help.includes(flag));
  const agents = readFileSync(path.join(cwd, "AGENTS.md"), "utf8");
  assert.ok(agents.includes("awg release current"));
  assert.ok(agents.includes("Capture the consequence, not the conversation"));
  assert.ok(agents.includes("awg quick note|task|risk|question|decision"));
});

test("coordination claims derive collisions and steer queue/run/lens surfaces", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:coord-a", "--type", "task", "--title", "Coord A", "--summary", "First coordination task.", "--status", "active", "--no-run"]);
  run(cwd, ["add", "node", "--id", "n:coord-b", "--type", "task", "--title", "Coord B", "--summary", "Second coordination task.", "--status", "active", "--no-run"]);
  run(cwd, ["add", "node", "--id", "n:coord-c", "--type", "task", "--title", "Coord C", "--summary", "Unattributed coordination task.", "--status", "active", "--no-run"]);
  run(cwd, ["add", "node", "--id", "n:coord-unrelated", "--type", "task", "--title", "Coord Unrelated", "--summary", "Unrelated coordination task.", "--status", "active", "--no-run"]);
  const runA = JSON.parse(run(cwd, ["run", "start", "--goal", "Run A", "--agent", "codex-a", "--json"]));
  const claimA = JSON.parse(run(cwd, ["coord", "claim", "n:coord-a", "--summary", "Working A", "--json"]));
  assert.equal(claimA.claim.status, "active");
  const statusA = JSON.parse(run(cwd, ["coord", "status", "--json"]));
  assert.equal(statusA.coordination.summary.activeClaims, 1);
  const missingRelease = JSON.parse(runFail(cwd, ["coord", "release", "coord:notfound", "--status", "released", "--json"]));
  assert.equal(missingRelease.ok, false);
  assert.equal(missingRelease.code, "AWG_COORDINATION_CLAIM_NOT_FOUND");
  const runB = JSON.parse(run(cwd, ["run", "start", "--goal", "Run B", "--agent", "codex-b", "--force", "--json"]));
  assert.notEqual(runA.runId, runB.runId);
  const next = JSON.parse(run(cwd, ["queue", "next", "--json"]));
  assert.equal(JSON.stringify(next.items).includes("n:coord-a"), false);
  const included = JSON.parse(run(cwd, ["queue", "next", "--include-claimed", "--json"]));
  assert.equal(JSON.stringify(included.items).includes("n:coord-a"), true);
  const unattributed = JSON.parse(run(cwd, ["coord", "claim", "n:coord-c", "--no-run", "--summary", "Unattributed exclusive", "--json"]));
  assert.ok(unattributed.warnings.some((warning: { code: string }) => warning.code === "AWG_COORDINATION_UNATTRIBUTED_CLAIM"));
  const nextAfterUnattributed = JSON.parse(run(cwd, ["queue", "next", "--json"]));
  assert.equal(JSON.stringify(nextAfterUnattributed.items).includes("n:coord-c"), true);
  const check = JSON.parse(run(cwd, ["coord", "check", "--target", "n:coord-a", "--json"]));
  assert.equal(check.available, false);
  assert.ok(check.warnings.some((warning: { code: string }) => warning.code === "AWG_COORDINATION_ACTIVE_CLAIM"));
  run(cwd, ["coord", "claim", "n:coord-b", "--mode", "shared", "--summary", "Shared one", "--json"]);
  run(cwd, ["coord", "claim", "n:coord-b", "--mode", "shared", "--summary", "Shared two", "--json"]);
  assert.equal(JSON.parse(run(cwd, ["coord", "status", "--json"])).coordination.summary.collisions, 0);
  const mine = JSON.parse(run(cwd, ["queue", "next", "--mine", "--json"]));
  assert.equal(JSON.stringify(mine.items).includes("n:coord-b"), true);
  run(cwd, ["coord", "claim", "n:coord-a", "--mode", "exclusive", "--summary", "Overlap", "--json"]);
  const collided = JSON.parse(run(cwd, ["coord", "status", "--json"]));
  assert.equal(collided.coordination.summary.collisions, 1);
  const collisionQueues = JSON.parse(run(cwd, ["queue", "list", "--json"]));
  assert.ok(collisionQueues.items.some((item: { sourceCode?: string; queue: string }) => item.sourceCode === "coordination_collision" && item.queue === "human_review"));
  assert.ok(collisionQueues.items.some((item: { sourceCode?: string; queue: string }) => item.sourceCode === "coordination_collision" && item.queue === "risk_review"));
  const queueItem = JSON.parse(run(cwd, ["queue", "next", "--include-claimed", "--json"])).items.find((item: { nodeIds: string[] }) => item.nodeIds.includes("n:coord-a"));
  const shown = JSON.parse(run(cwd, ["queue", "show", queueItem.id, "--json"]));
  assert.ok(shown.coordinationClaims.length >= 1);
  run(cwd, ["coord", "claim", queueItem.id, "--mode", "exclusive", "--summary", "Queue item overlap", "--json"]);
  const queueClaimCheck = JSON.parse(run(cwd, ["coord", "check", "--target", "n:coord-a", "--json"]));
  assert.equal(queueClaimCheck.available, false);
  assert.ok(queueClaimCheck.claims.some((claim: { targetIds: string[] }) => claim.targetIds.includes(queueItem.id)));
  const lens = JSON.parse(run(cwd, ["lens", "task", "--goal", "Coord A", "--json"]));
  assert.ok(lens.sections.some((section: { section: string; items: unknown[] }) => section.section === "coordination" && section.items.length));
  const handoff = JSON.parse(run(cwd, ["handoff", "--json", "--no-record"]));
  assert.ok(handoff.sections.some((section: { section: string; items: unknown[] }) => section.section === "coordination" && section.items.length));
  const doctor = JSON.parse(run(cwd, ["doctor", "--fix-suggestions", "--json"]));
  assert.ok(doctor.diagnostics.some((diag: { code: string }) => diag.code === "AWG_COORDINATION_ACTIVE_COLLISION"));
  assert.ok(doctor.fixSuggestions.some((suggestion: { code: string }) => suggestion.code === "AWG_COORDINATION_REVIEW_COLLISION"));
  const queueJsonMissing = JSON.parse(runFail(cwd, ["queue", "show", "wq:notfound", "--json"]));
  assert.equal(queueJsonMissing.ok, false);
  assert.equal(queueJsonMissing.code, "AWG_QUEUE_ITEM_NOT_FOUND");
  const handoffMissing = JSON.parse(runFail(cwd, ["coord", "handoff", "coord:notfound", "--summary", "No claim", "--json"]));
  assert.equal(handoffMissing.ok, false);
  assert.equal(handoffMissing.code, "AWG_COORDINATION_CLAIM_NOT_FOUND");
  run(cwd, ["coord", "release", claimA.coordinationId, "--status", "released", "--summary", "Done", "--json"]);
  const released = JSON.parse(run(cwd, ["coord", "status", "--json"]));
  assert.ok(released.coordination.claims.some((claim: { id: string; status: string }) => claim.id === claimA.coordinationId && claim.status === "released"));
});

test("coordination accepts documented created_at events and avoids finished-run warning for ttl-only stale active claims", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const logDir = path.join(cwd, ".awg/log/2026/05");
  mkdirSync(logDir, { recursive: true });
  const log = path.join(logDir, "2026-05-17.awg.jsonl");
  writeFileSync(log, [
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:created-at-target", type: "task", title: "Created At Target", summary: "Target for created_at coordination.", status: "active", importance: 0.5, confidence: 0.8, created_at: "2026-05-17T00:00:00.000Z", updated_at: "2026-05-17T00:00:00.000Z" }),
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:run-active:start", type: "run_started", target: "run:active-created-at", by: "agent:codex", at: "2026-05-17T00:00:00.000Z", goal: "Active created_at run" }),
    JSON.stringify({ awg: "0.1", kind: "event", type: "coordination.claimed", coordinationId: "coord:createdat0001", runId: "run:active-created-at", agent: "codex", targetKind: "node", targetIds: ["n:created-at-target"], mode: "exclusive", summary: "Created_at claim", expires_at: "2026-05-17T00:30:00.000Z", created_at: "2026-05-17T00:10:00.000Z" }),
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:advance-time", type: "run_note", target: "run:active-created-at", run: "run:active-created-at", by: "agent:codex", at: "2026-05-17T01:00:00.000Z", summary: "Advance graph time." })
  ].join("\n") + "\n");
  const graph = JSON.parse(run(cwd, ["build", "--json"]));
  assert.equal(graph.fatal_error_count, 0);
  const status = JSON.parse(run(cwd, ["coord", "status", "--json"]));
  assert.ok(status.coordination.claims.some((claim: { id: string; status: string }) => claim.id === "coord:createdat0001" && claim.status === "stale"));
  const doctor = JSON.parse(run(cwd, ["doctor", "--json"]));
  assert.ok(doctor.diagnostics.some((diag: { code: string; id?: string }) => diag.code === "AWG_COORDINATION_STALE_CLAIM" && diag.id === "coord:createdat0001"));
  assert.equal(doctor.diagnostics.some((diag: { code: string; id?: string }) => diag.code === "AWG_COORDINATION_FINISHED_RUN_UNRELEASED_CLAIM" && diag.id === "coord:createdat0001"), false);
  const queue = JSON.parse(run(cwd, ["queue", "list", "--json"]));
  assert.ok(queue.items.some((item: { sourceCode?: string; queue: string }) => item.sourceCode === "coordination_stale_claim" && item.queue === "handoff_followup"));
  assert.ok(queue.items.some((item: { sourceCode?: string; queue: string }) => item.sourceCode === "coordination_stale_claim" && item.queue === "maintenance"));
});

test("coordination ttl expires on live read even without later log writes", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const logDir = path.join(cwd, ".awg/log/2000/01");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(path.join(logDir, "2000-01-01.awg.jsonl"), [
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:quiet-ttl-target", type: "task", title: "Quiet TTL Target", summary: "Target for quiet TTL expiry.", status: "active", importance: 0.5, confidence: 0.8, created_at: "2000-01-01T00:00:00.000Z", updated_at: "2000-01-01T00:00:00.000Z" }),
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:quiet-ttl-claim", type: "coordination.claimed", coordinationId: "coord:quietttl0001", runId: "run:quiet-ttl", agent: "codex", targetKind: "node", targetIds: ["n:quiet-ttl-target"], mode: "exclusive", summary: "Quiet TTL claim", expires_at: "2000-01-01T01:00:00.000Z", at: "2000-01-01T00:00:00.000Z" })
  ].join("\n") + "\n");
  const status = JSON.parse(run(cwd, ["coord", "status", "--json"]));
  assert.ok(status.coordination.claims.some((claim: { id: string; status: string }) => claim.id === "coord:quietttl0001" && claim.status === "stale"));
  const next = JSON.parse(run(cwd, ["queue", "next", "--json"]));
  assert.equal(JSON.stringify(next.items).includes("n:quiet-ttl-target"), true);
});

test("coordination diagnoses raw handoffs that reference missing claims", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const logDir = path.join(cwd, ".awg/log/2026/05");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(path.join(logDir, "2026-05-19.awg.jsonl"), [
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:orphan-coord-handoff", type: "coordination.handoff", target: "coord:notfound", coordinationId: "coord:notfound", by: "agent:codex", at: "2026-05-19T00:00:00.000Z", summary: "Orphan handoff" })
  ].join("\n") + "\n");
  const doctor = JSON.parse(run(cwd, ["doctor", "--json"]));
  assert.ok(doctor.diagnostics.some((diag: { code: string; id?: string }) => diag.code === "AWG_COORDINATION_HANDOFF_MISSING_CLAIM" && diag.id === "ev:orphan-coord-handoff"));
});

test("coordination handoff scopes active claims to the current run", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const logDir = path.join(cwd, ".awg/log/2026/05");
  mkdirSync(logDir, { recursive: true });
  const log = path.join(logDir, "2026-05-18.awg.jsonl");
  writeFileSync(log, [
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:current-run-task", type: "task", title: "Current Run Task", summary: "Current.", status: "active", importance: 0.5, confidence: 0.8, created_at: "2026-05-18T00:00:00.000Z", updated_at: "2026-05-18T00:00:00.000Z" }),
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:other-run-task", type: "task", title: "Other Run Task", summary: "Other.", status: "active", importance: 0.5, confidence: 0.8, created_at: "2026-05-18T00:00:00.000Z", updated_at: "2026-05-18T00:00:00.000Z" }),
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:run-a:start", type: "run_started", target: "run:a-current", by: "agent:codex", at: "2026-05-18T00:01:00.000Z", goal: "Current run" }),
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:run-z:start", type: "run_started", target: "run:z-other", by: "agent:codex", at: "2026-05-18T00:02:00.000Z", goal: "Other run" }),
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:coord-current", type: "coordination.claimed", coordinationId: "coord:current0001", runId: "run:a-current", agent: "codex", targetKind: "node", targetIds: ["n:current-run-task"], mode: "exclusive", summary: "Current claim", at: "2026-05-18T00:03:00.000Z" }),
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:coord-other", type: "coordination.claimed", coordinationId: "coord:other0001", runId: "run:z-other", agent: "codex", targetKind: "node", targetIds: ["n:other-run-task"], mode: "exclusive", summary: "Other claim", at: "2026-05-18T00:04:00.000Z" })
  ].join("\n") + "\n");
  const handoff = JSON.parse(run(cwd, ["handoff", "--json", "--no-record"]));
  const coordination = JSON.stringify(handoff.sections.find((section: { section: string }) => section.section === "coordination")?.items ?? []);
  assert.ok(["run:a-current", "run:z-other"].includes(handoff.run.id));
  assert.notEqual(coordination.includes("Current claim"), coordination.includes("Other claim"));
});

test("quick capture commands create normal nodes, optional edges, and run attribution", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const started = JSON.parse(run(cwd, ["run", "start", "--goal", "Quick capture smoke", "--json"]));
  const target = JSON.parse(run(cwd, ["quick", "note", "Target context", "--title", "Target context", "--json"]));
  const note = JSON.parse(run(cwd, ["quick", "note", "Small durable note", "--title", "Small durable note", "--tag", "smoke", "--target", target.nodeId, "--json"]));
  assert.equal(note.node.type, "note");
  assert.equal(note.node.runId, started.runId);
  assert.equal(note.edge.rel, "relates_to");
  const task = JSON.parse(run(cwd, ["quick", "task", "Follow up task", "--status", "in_progress", "--json"]));
  const risk = JSON.parse(run(cwd, ["quick", "risk", "Review risk", "--status", "needs_review", "--json"]));
  const question = JSON.parse(run(cwd, ["quick", "question", "Open question", "--json"]));
  const decision = JSON.parse(run(cwd, ["quick", "decision", "Use compact capture", "--status", "proposed", "--json"]));
  assert.equal(task.node.type, "task");
  assert.equal(risk.node.status, "needs_review");
  assert.equal(question.node.type, "question");
  assert.equal(decision.node.status, "proposed");
  const noRun = JSON.parse(run(cwd, ["quick", "note", "No run note", "--no-run", "--json"]));
  assert.equal(noRun.runId, null);
  assert.equal(noRun.node.runId, undefined);
  const graph = JSON.parse(run(cwd, ["build", "--json"]));
  assert.equal(graph.fatal_error_count, 0);
  const detail = JSON.parse(run(cwd, ["node", "show", note.nodeId, "--json"]));
  assert.equal(detail.node.type, "note");
  assert.ok(!JSON.stringify(detail.node).includes("transcript"));
});

test("template scaffold exposes structured fields and compact handoff stays deterministic", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["run", "start", "--goal", "Template scaffold smoke"]);
  const scaffold = JSON.parse(run(cwd, ["template", "scaffold", "--title", "Project operating template", "--scope", "project", "--json"]));
  assert.equal(scaffold.node.type, "process");
  assert.equal(scaffold.node.status, "needs_review");
  for (const field of ["scope", "purpose", "taxonomy", "freshness_rules", "agent_rules", "review_state", "human_approved"]) assert.ok(scaffold.requiredFields.includes(field));
  const status = run(cwd, ["template", "status"]);
  assert.ok(status.includes("requiredFields"));
  assert.ok(status.includes("freshness_rules"));
  const statusJson = JSON.parse(run(cwd, ["template", "status", "--json"]));
  assert.ok(statusJson.requiredFields.includes("agent_rules"));
  assert.ok(statusJson.fieldHints.taxonomy.includes("preferred node types"));
  const compact = run(cwd, ["handoff", "--compact", "--no-record"]);
  assert.ok(compact.includes("AWG compact handoff"));
  assert.ok(compact.length < run(cwd, ["handoff", "--no-record"]).length);
  const json = JSON.parse(run(cwd, ["handoff", "--json", "--no-record"]));
  assert.equal(json.kind, "handoff");
});

test("task lens and handoff include scoped context and respect budgets", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:task-a", "--type", "task", "--title", "Implement upgrade command", "--summary", "Build upgrade.", "--status", "in_progress", "--importance", "0.9", "--anchor", "file:src/upgrade.ts"]);
  run(cwd, ["add", "node", "--id", "n:risk-a", "--type", "risk", "--title", "Upgrade risk", "--summary", "Schema compatibility risk.", "--status", "active"]);
  run(cwd, ["add", "node", "--id", "n:unrelated", "--type", "task", "--title", "Unrelated", "--summary", "Other work.", "--status", "active"]);
  run(cwd, ["add", "edge", "--from", "n:task-a", "--rel", "blocks", "--to", "n:risk-a"]);
  run(cwd, ["add", "evidence", "--target", "n:task-a", "--summary", "Focused test evidence.", "--status", "passed"]);
  const lens = JSON.parse(run(cwd, ["lens", "task", "--goal", "upgrade command", "--budget", "900", "--json"]));
  assert.equal(lens.id, "lens:task");
  assert.ok(lens.sections.find((section: { section: string }) => section.section === "matches").items.some((item: { id: string }) => item.id === "n:task-a"));
  assert.ok(JSON.stringify(lens).includes("n:risk-a"));
  assert.ok(JSON.stringify(lens).includes("templateContext"));
  assert.ok(JSON.stringify(lens).includes("src/upgrade.ts"));
  assert.ok(!JSON.stringify(lens).includes("n:unrelated"));
  assert.ok(lens.sections.some((section: { omitted: number }) => typeof section.omitted === "number"));
  const handoff = JSON.parse(run(cwd, ["handoff", "--budget", "1000", "--json"]));
  assert.equal(handoff.kind, "handoff");
  assert.ok(JSON.stringify(handoff).includes("templateContext"));
  assert.ok(JSON.stringify(handoff).includes("activeTasks"));
  assert.ok(JSON.stringify(handoff).includes("recentEvidence"));
  const tinyHandoff = run(cwd, ["handoff", "--budget", "200", "--json"]);
  assert.ok(tinyHandoff.length < 1800);
  const tinyParsed = JSON.parse(tinyHandoff);
  assert.equal(typeof tinyParsed.quality.score, "number");
  assert.ok(["activeRun", "mostRecentRun", "graphHealth"].includes(tinyParsed.sections[0].section));
  assert.ok(tinyParsed.sections.some((section: { omitted: number }) => section.omitted > 0));
  assert.ok(run(cwd, ["handoff", "--budget", "600"]).includes("AWG handoff"));
  run(cwd, ["run", "start", "--goal", "Handoff text formatting"]);
  run(cwd, ["add", "node", "--id", "n:run-attributed", "--type", "task", "--title", "Run attributed", "--summary", "Run attributed.", "--status", "in_progress"]);
  const textHandoff = run(cwd, ["handoff"]);
  assert.ok(textHandoff.includes("templateContext"));
  assert.ok(textHandoff.includes("runAttribution"));
  assert.ok(textHandoff.includes("handoffQuality"));
  assert.ok(textHandoff.includes("1 created node"));
  assert.ok(textHandoff.includes("1 touched node"));
  assert.ok(!textHandoff.includes("[object Object]"));
  assert.ok(!textHandoff.includes("createds"));
  assert.ok(!textHandoff.includes("toucheds"));
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
  run(cwd, ["add", "node", "--id", "n:attr-task", "--type", "task", "--title", "Attr task", "--summary", "Attributed.", "--status", "in_progress", "--evidence-required"]);
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
  assert.equal(graph.nodes.find((node: { id: string }) => node.id === "n:attr-task").evidence_required, true);
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
  assert.equal(existsSync(path.join(cwd, ".awg/compiled/graph.json")), false);
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
  assert.equal(handoff.quality.checks.find((check: { id: string }) => check.id === "handoff_generated").ok, true);
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
  assert.ok(js.includes('"task-queue"'));
  assert.ok(js.includes('"run-summary"'));
  assert.ok(js.includes("renderSummaryBlock"));
  assert.ok(js.includes("objectRecord(block.summary)"));
  assert.ok(js.includes("normalizeBlockNode"));
  assert.ok(js.includes("Missing node reference"));
  assert.ok(js.includes("byId.get(item) || missingBlockNode(item)"));
  assert.ok(js.includes("safeAnchorHref"));
  assert.ok(js.includes("rawJsonPreview(block.data || block)"));
  assert.ok(js.includes("normalizeTableColumns"));
  assert.ok(js.includes("renderBodyOutline(node.body)"));
  assert.ok(js.includes("function renderBodyOutline"));
  assert.ok(js.includes("function renderInlineText"));
  assert.ok(js.includes("item && typeof item === \"object\""));
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
  assert.ok(css.includes(".callout-warning"));
  assert.ok(css.includes(".checklist"));
  assert.ok(css.includes(".timeline-row"));
  assert.ok(css.includes(".prose h4"));
  assert.ok(css.includes(".prose code"));
  assert.ok(css.includes(".block{grid-column:1 / -1}"));
  assert.ok(css.includes(".block-compact{grid-column:span 1"));
  assert.ok(css.includes(".column-blocked"));
  assert.ok(css.includes("@media(max-width:640px){.route-root"));
  assert.ok(!css.includes("\n(max-width:640px)"));
  assert.ok(css.includes(':root[data-theme="dark"]'));
});

test("viewer node bodies use a safe outline renderer instead of raw markdown or html", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, [
    "add",
    "node",
    "--id",
    "n:outline",
    "--type",
    "concept",
    "--title",
    "Outline",
    "--summary",
    "Structured body.",
    "--body",
    "Problem:\n- Escape <script>\n1. Render `code`."
  ]);
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  const js = readFileSync(path.join(cwd, ".awg/compiled/site/app.js"), "utf8");
  assert.equal(graph.nodes[0].body, "Problem:\n- Escape <script>\n1. Render `code`.");
  assert.ok(js.includes("node.body ? nodeSection(\"Body\", renderBodyOutline(node.body))"));
  assert.ok(js.includes("outlineHeading(trimmed)"));
  assert.ok(js.includes("renderInlineText"));
  assert.ok(js.includes("esc(match[1])"));
  assert.ok(!js.includes("'<div class=\"prose\"><p>' + esc(node.body)"));
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

test("work queue index derives deterministic queue items and CLI is read-only", async () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const file = path.join(cwd, ".awg/log/2026/01/2026-01-01.awg.jsonl");
  mkdirSync(path.dirname(file), { recursive: true });
  const at = "2026-01-01T00:00:00.000Z";
  writeFileSync(file, [
    JSON.stringify({ awg: "0.1", kind: "event", id: "ev:run:start", type: "run_started", target: "run:active", run: "run:active", by: "agent:codex", at, goal: "Queue smoke" }),
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:active-task", type: "task", title: "Active task", summary: "Active task.", status: "active", importance: 0.6, confidence: 0.8, created_at: at, updated_at: at }),
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:done", type: "task", title: "Done task", summary: "Done task.", status: "completed", importance: 0.7, confidence: 0.8, created_at: at, updated_at: at }),
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:blocker", type: "blocker", title: "Blocker", summary: "Blocker.", status: "active", importance: 0.9, confidence: 0.8, created_at: at, updated_at: at }),
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:blocked", type: "task", title: "Blocked", summary: "Blocked.", status: "active", importance: 0.6, confidence: 0.8, created_at: at, updated_at: at }),
    JSON.stringify({ awg: "0.1", kind: "edge", id: "e:blocker-blocks", from: "n:blocker", rel: "blocks", to: "n:blocked", created_at: at }),
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:claim", type: "claim", title: "Claim", summary: "Claim.", status: "active", importance: 0.5, confidence: 0.8, created_at: at, updated_at: at, claim: "A claim." }),
    JSON.stringify({ awg: "0.1", kind: "node", id: "n:old", type: "requirement", title: "Old", summary: "Old.", status: "active", importance: 0.5, confidence: 0.8, created_at: at, updated_at: at, freshness: { state: "current", review_after: "2020-01-01" } })
  ].join("\n") + "\n");
  const before = canonicalLogSnapshot(cwd);
  run(cwd, ["build"]);
  const graph = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/graph.json"), "utf8"));
  const index = JSON.parse(readFileSync(path.join(cwd, ".awg/compiled/indexes/work-queues.json"), "utf8"));
  assert.equal(graph.work_queue_index.kind, "work-queue-index");
  assert.equal(index.kind, "work-queue-index");
  assert.ok(index.items.some((item: { queue: string; nodeIds: string[] }) => item.queue === "next" && item.nodeIds.includes("n:active-task")));
  assert.ok(index.items.some((item: { queue: string; nodeIds: string[] }) => item.queue === "evidence_needed" && item.nodeIds.includes("n:done")));
  assert.ok(index.items.some((item: { queue: string; nodeIds: string[]; blockedByNodeIds: string[] }) => item.queue === "blocked" && item.nodeIds.includes("n:blocked") && item.blockedByNodeIds.includes("n:blocker")));
  assert.ok(index.items.some((item: { queue: string; nodeIds: string[] }) => item.queue === "stale_review" && item.nodeIds.includes("n:old")));
  const firstWorkQueueArtifact = readFileSync(path.join(cwd, ".awg/compiled/indexes/work-queues.json"), "utf8");
  run(cwd, ["build"]);
  const secondWorkQueueArtifact = readFileSync(path.join(cwd, ".awg/compiled/indexes/work-queues.json"), "utf8");
  assert.equal(secondWorkQueueArtifact, firstWorkQueueArtifact);
  const compiledBefore = compiledSnapshot(cwd);
  const list = JSON.parse(run(cwd, ["queue", "list", "--queue", "evidence_needed", "--json"]));
  assert.equal(list.ok, true);
  assert.ok(list.items.some((item: { nodeIds: string[] }) => item.nodeIds.includes("n:done")));
  assert.ok(run(cwd, ["queue", "list", "--queue", "evidence_needed"]).includes("Evidence Needed (evidence_needed)"));
  assert.ok(run(cwd, ["queue", "list", "--limit", "1"]).includes("1 shown of"));
  const next = JSON.parse(run(cwd, ["queue", "next", "--include-human-review", "--goal", "blocked", "--json"]));
  assert.ok(next.items.some((item: { nodeIds: string[] }) => item.nodeIds.includes("n:blocked")));
  const autonomous = JSON.parse(run(cwd, ["queue", "next", "--autonomous", "--json"]));
  assert.ok(autonomous.items.every((item: { autonomousSafe: boolean }) => item.autonomousSafe));
  const shown = JSON.parse(run(cwd, ["queue", "show", list.items[0].id, "--json"]));
  assert.equal(shown.ok, true);
  assert.ok(Array.isArray(shown.nodes));
  assert.equal(canonicalLogSnapshot(cwd), before);
  assert.equal(compiledSnapshot(cwd), compiledBefore);
  assert.ok(runFail(cwd, ["queue", "list", "--queue", "missing"]).includes("Unknown queue id"));
  assert.ok(runFail(cwd, ["queue", "next", "--limit", "-1"]).includes("--limit must be a non-negative integer"));
  assert.ok(runFail(cwd, ["queue", "show", "wq:missing"]).includes("Work queue item not found"));
});

test("work queues feed lenses handoff configurable lenses and viewer route", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["add", "node", "--id", "n:queue-task", "--type", "task", "--title", "Queue task", "--summary", "Queue task.", "--status", "active"]);
  run(cwd, ["add", "node", "--id", "n:queue-task-filtered", "--type", "task", "--title", "Queue task filtered", "--summary", "Queue task filtered.", "--status", "active"]);
  run(cwd, ["add", "lens", "--id", "lens:queues", "--title", "Queues", "--purpose", "Queue lens.", "--sections-json", "[{\"id\":\"queues\",\"source\":\"workQueues\",\"query\":{\"queue\":\"next\",\"minPriority\":1},\"limit\":5},{\"id\":\"scoped\",\"source\":\"workQueues\",\"query\":{\"queue\":\"next\",\"nodeIds\":[\"n:queue-task-filtered\"]},\"limit\":1}]", "--json"]);
  run(cwd, ["build"]);
  const taskLens = JSON.parse(run(cwd, ["lens", "task", "--goal", "queue", "--json"]));
  assert.ok(taskLens.sections.some((section: { section: string; items: unknown[] }) => section.section === "workQueues" && section.items.length));
  const handoff = JSON.parse(run(cwd, ["handoff", "--json", "--no-record"]));
  assert.ok(handoff.sections.some((section: { section: string; items: unknown[] }) => section.section === "workQueues" && section.items.length));
  const configured = JSON.parse(run(cwd, ["lens", "run", "lens:queues", "--json"]));
  assert.ok(configured.sections[0].items.some((item: { queue: string }) => item.queue === "next"));
  assert.deepEqual(configured.sections.find((section: { section: string }) => section.section === "scoped").items.map((item: { nodeIds: string[] }) => item.nodeIds[0]), ["n:queue-task-filtered"]);
  const js = readFileSync(path.join(cwd, ".awg/compiled/site/app.js"), "utf8");
  assert.ok(js.includes('["queues", "Queues"]'));
  assert.ok(js.includes("renderQueuesRoute"));
  assert.ok(js.includes("item.runIds"));
  assert.ok(js.includes("item.inboxItemIds"));
});

test("forced run finish preflight warnings surface as handoff follow-up queue items", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  run(cwd, ["run", "start", "--goal", "Forced finish queue", "--json"]);
  run(cwd, ["add", "node", "--id", "n:forced-done", "--type", "task", "--title", "Forced done", "--summary", "Forced done.", "--status", "completed"]);
  run(cwd, ["run", "finish", "--status", "completed", "--summary", "Forced done.", "--force", "--json"]);
  const queue = JSON.parse(run(cwd, ["queue", "list", "--queue", "handoff_followup", "--json"]));
  assert.ok(queue.items.some((item: { title: string; runIds: string[]; nodeIds: string[] }) => item.title.includes("Forced finish left unresolved preflight warnings") && item.runIds.length && item.nodeIds.includes("n:forced-done")));
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
  assert.ok(first.includes("awg node show <node-id> --json"));
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
  assert.ok(text.includes("awg node show <node-id> --json"));
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
  assert.ok(claude.includes("awg node show <node-id> --json"));
  assert.ok(antigravity.includes("awg node show <node-id> --json"));
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
  rmSync(path.join(cwd, ".awg/AGENTS.md"));
  run(cwd, ["upgrade"]);
  const nextConfig = JSON.parse(readFileSync(configFile, "utf8"));
  const nodeSchema = JSON.parse(readFileSync(path.join(cwd, ".awg/schema/core/node.schema.json"), "utf8"));
  const vaultAgents = readFileSync(path.join(cwd, ".awg/AGENTS.md"), "utf8");
  assert.deepEqual(nextConfig["x-user"], { kept: true });
  assert.equal(nextConfig.validation.strict_links, true);
  assert.deepEqual(nodeSchema, schemaForFile("node"));
  assert.ok(vaultAgents.includes("awg doctor --fix-suggestions --json"));
  assert.ok(vaultAgents.includes("--auto-handoff"));
  assert.ok(vaultAgents.includes("awg node show <node-id> --json"));
  assert.ok(vaultAgents.includes("awg release current"));
  assert.ok(vaultAgents.includes("Capture the consequence, not the conversation"));
  assert.ok(vaultAgents.includes("awg quick note|task|risk|question|decision"));
});

test("upgrade refreshes known generated vault instructions and preserves custom vault instructions", () => {
  const cwd = tmp();
  run(cwd, ["init", "--empty"]);
  const vaultAgentsFile = path.join(cwd, ".awg/AGENTS.md");
  writeFileSync(vaultAgentsFile, `# AWG Agent Instructions

- Before starting work, run \`awg handoff\`, \`awg lens resume\`, or read \`.awg/compiled/lenses/resume.json\`.
- Start a focused run with \`awg run start --goal "<goal>"\`.
- If the lens is missing or stale, run \`awg build\`.
- Store durable knowledge as AWG nodes/edges/responses/events.
- Use \`awg search <query>\` before creating duplicate nodes.
- Use \`awg template status --goal "..." --json\` to understand local operating templates and field expectations.
- Use \`awg lens task --goal "..."\` for scoped work context.
- Use \`awg node show <node-id> --json\` when search, lens, or handoff surfaces a node whose full detail matters.
- Prefer \`awg add\`, \`awg update node\`, and \`awg add evidence\` commands over manually editing JSONL.
- Durable writes automatically attach to the active run; use \`--run <run-id>\` for an explicit active run or \`--no-run\` to suppress attribution.
- Use concise summaries for scanning, \`body\` for deeper detail, \`fields\` for structured operational data, safe \`blocks\` for presentation, \`freshness\` for currentness, and \`anchors\` for file/symbol/url/command references.
- Do not edit \`.awg/compiled/*\` manually.
- Do not link by file path when linking knowledge. Link by AWG node ID.
- Do not delete nodes to reorganize. Supersede, archive, merge later, or create corrective events.
- When making a durable decision, create or update a decision node.
- When identifying a risk/blocker, create a risk/task node with review metadata if possible.
- When completing work, update/add task status and add evidence.
- When behavior, policy, implementation, ownership, pricing, or process changes, update related nodes and freshness metadata.
- Add run notes for meaningful progress, blockers, and force-finish rationale.
- After writing AWG data, run \`awg build\`.
- Fix fatal validation errors before stopping.
- Review \`awg doctor --fix-suggestions --json\` warnings and resolve obvious stale items.
- End with \`awg run finish --status completed|partial|blocked|failed --summary "..." --auto-handoff\`.
- If forced, document why in the run summary or a run note.
- Ensure \`.awg/compiled/lenses/resume.json\` reflects the current state.
`);
  run(cwd, ["upgrade"]);
  const refreshed = readFileSync(vaultAgentsFile, "utf8");
  assert.ok(refreshed.includes("awg release current"));
  assert.ok(refreshed.includes("Capture the consequence, not the conversation"));
  assert.ok(refreshed.includes("awg quick note|task|risk|question|decision"));

  const custom = tmp();
  run(custom, ["init", "--empty"]);
  const customVaultAgentsFile = path.join(custom, ".awg/AGENTS.md");
  writeFileSync(customVaultAgentsFile, "# Custom vault instructions\n\nKeep this.\n");
  run(custom, ["upgrade"]);
  assert.equal(readFileSync(customVaultAgentsFile, "utf8"), "# Custom vault instructions\n\nKeep this.\n");
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

test("vault registration persists stable identity and preserves relationships", () => {
  const home = tempHome();
  const cwd = tmp();
  run(cwd, ["init", "--empty"], { HOME: home });
  run(cwd, ["register", "--name", "Moved"], { HOME: home });
  const first = readRegistry(home);
  const id = first.vaults[0].id;
  assert.ok(id.startsWith("vault:"));
  const config = JSON.parse(readFileSync(path.join(cwd, ".awg/config.json"), "utf8"));
  assert.equal(config.vault.id, id);
  const moved = path.join(tmp(), "moved");
  cpSync(cwd, moved, { recursive: true });
  run(moved, ["register", "--name", "Moved Again"], { HOME: home });
  const second = readRegistry(home);
  assert.equal(second.vaults.length, 2);
  assert.ok(second.vaults.some((vault) => vault.id === id && realpathSync(vault.path) === realpathSync(path.join(cwd, ".awg"))));
  assert.ok(second.vaults.some((vault) => vault.id !== id && realpathSync(vault.path) === realpathSync(path.join(moved, ".awg"))));
});

test("vault link, unlink, topology, and build materialize deterministic topology", () => {
  const home = tempHome();
  const one = tmp();
  const two = tmp();
  run(one, ["init", "--empty"], { HOME: home });
  run(two, ["init", "--empty"], { HOME: home });
  run(one, ["register", "--name", "One"], { HOME: home });
  run(two, ["register", "--name", "Two"], { HOME: home });
  const registry = readRegistry(home);
  registry["x-keep"] = true;
  registry.vaults[1]["x-vault"] = true;
  writeFileSync(path.join(home, ".awg/registry.json"), JSON.stringify(registry, null, 2));
  const linked = JSON.parse(run(one, ["vault", "link", "--to", "Two", "--rel", "consumes_data_from", "--summary", "One consumes Two contracts.", "--json"], { HOME: home }));
  assert.equal(linked.ok, true);
  assert.equal(linked.relationship.rel, "provides_contract_for");
  assert.equal(linked.fromVault.id, linked.relationship.fromVaultId);
  assert.equal(linked.toVault.id, linked.relationship.toVaultId);
  assert.equal(linked.created, true);
  const repeated = JSON.parse(run(one, ["vault", "link", "--to", "Two", "--rel", "consumes_data_from", "--summary", "Updated.", "--json"], { HOME: home }));
  assert.equal(repeated.created, false);
  assert.equal(repeated.relationship.id, linked.relationship.id);
  const topology = JSON.parse(run(one, ["vault", "topology", "--json"], { HOME: home }));
  assert.equal(topology.ok, true);
  assert.equal(topology.relatedVaults.length, 1);
  assert.ok(topology.relatedVaults[0].whySurfaced.includes("direct_registry_relationship:provides_contract_for"));
  run(one, ["build", "--json"], { HOME: home });
  const compiled = JSON.parse(readFileSync(path.join(one, ".awg/compiled/indexes/topology.json"), "utf8"));
  assert.equal(compiled.directNeighbors.length, 1);
  const afterLink = readRegistry(home);
  assert.equal(afterLink["x-keep"], true);
  assert.equal(afterLink.vaults.some((vault) => vault["x-vault"] === true), true);
  const unlinked = JSON.parse(run(one, ["vault", "unlink", "--relationship", linked.relationship.id, "--json"], { HOME: home }));
  assert.equal(unlinked.ok, true);
  const afterUnlink = readRegistry(home);
  assert.equal(afterUnlink.relationships?.[0].archivedAt !== null, true);
});

test("vault link preserves private visibility and emits stable json errors", () => {
  const home = tempHome();
  const one = tmp();
  const two = tmp();
  run(one, ["init", "--empty"], { HOME: home });
  run(two, ["init", "--empty"], { HOME: home });
  run(one, ["register", "--name", "One"], { HOME: home });
  run(two, ["register", "--name", "Two"], { HOME: home });
  const first = JSON.parse(run(one, ["vault", "link", "--to", "Two", "--rel", "depends_on", "--visibility", "private", "--summary", "Secret relationship detail.", "--json"], { HOME: home }));
  assert.equal(first.relationship.visibility, "private");
  const second = JSON.parse(run(one, ["vault", "link", "--to", "Two", "--rel", "depends_on", "--summary", "Still private.", "--json"], { HOME: home }));
  assert.equal(second.relationship.visibility, "private");
  const listed = JSON.parse(run(one, ["vault", "list", "--json"], { HOME: home }));
  assert.equal(listed.relationships[0].summary, undefined);
  run(one, ["build", "--json"], { HOME: home });
  const topology = JSON.parse(readFileSync(path.join(one, ".awg/compiled/indexes/topology.json"), "utf8"));
  assert.equal(topology.directNeighbors[0].summary.source, "private_relationship");
  assert.deepEqual(topology.directNeighbors[0].relationshipSummaries, []);
  assert.equal(topology.relationships[0].summary, undefined);
  const lens = JSON.parse(run(one, ["lens", "task", "--goal", "depends_on", "--json"], { HOME: home }));
  assert.ok(!JSON.stringify(lens).includes("Secret relationship detail."));
  assert.ok(!JSON.stringify(lens).includes("Still private."));
  const handoff = JSON.parse(run(one, ["handoff", "--json", "--no-record"], { HOME: home }));
  assert.ok(!JSON.stringify(handoff).includes("Secret relationship detail."));
  assert.ok(!JSON.stringify(handoff).includes("Still private."));
  const missing = JSON.parse(runFail(one, ["vault", "link", "--to", "Missing", "--rel", "depends_on", "--json"], { HOME: home }));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "AWG_VAULT_SELECTOR_NOT_FOUND");
  const usage = JSON.parse(runFail(one, ["vault", "unlink", "--json"], { HOME: home }));
  assert.equal(usage.code, "AWG_VAULT_UNLINK_USAGE");
  const depth = JSON.parse(runFail(one, ["vault", "topology", "--depth", "2", "--json"], { HOME: home }));
  assert.equal(depth.code, "AWG_VAULT_DEPTH_UNSUPPORTED");
});

test("topology skips symlinked neighbor compiled summaries", () => {
  const home = tempHome();
  const one = tmp();
  const two = tmp();
  const outside = tmp();
  run(one, ["init", "--empty"], { HOME: home });
  run(two, ["init", "--empty"], { HOME: home });
  run(one, ["register", "--name", "One"], { HOME: home });
  run(two, ["register", "--name", "Two"], { HOME: home });
  run(two, ["build", "--json"], { HOME: home });
  run(one, ["vault", "link", "--to", "Two", "--rel", "depends_on"], { HOME: home });
  const outsideSummary = path.join(outside, "resume.json");
  writeFileSync(outsideSummary, JSON.stringify({ summary: "LEAKED OUTSIDE SUMMARY" }));
  rmSync(path.join(two, ".awg/compiled/lenses/resume.json"));
  symlinkSync(outsideSummary, path.join(two, ".awg/compiled/lenses/resume.json"));
  run(one, ["build", "--json"], { HOME: home });
  const topology = JSON.parse(readFileSync(path.join(one, ".awg/compiled/indexes/topology.json"), "utf8"));
  assert.ok(!JSON.stringify(topology).includes("LEAKED OUTSIDE SUMMARY"));
  assert.ok(topology.diagnostics.some((diag: { code: string }) => diag.code === "topology_related_vault_compiled_artifact_unsafe"));
});

test("vault selectors prefer exact id before colliding names", () => {
  const home = tempHome();
  const one = tmp();
  const two = tmp();
  run(one, ["init", "--empty"], { HOME: home });
  run(two, ["init", "--empty"], { HOME: home });
  run(one, ["register", "--name", "One"], { HOME: home });
  run(two, ["register", "--name", "Two"], { HOME: home });
  const registry = readRegistry(home);
  const oneId = registry.vaults.find((vault) => vault.name === "One")?.id;
  const twoEntry = registry.vaults.find((vault) => vault.name === "Two");
  assert.ok(oneId);
  assert.ok(twoEntry);
  twoEntry.name = oneId;
  writeFileSync(path.join(home, ".awg/registry.json"), JSON.stringify(registry, null, 2));
  const linked = JSON.parse(run(one, ["vault", "link", "--to", twoEntry.id, "--from", oneId, "--rel", "related_to", "--json"], { HOME: home }));
  assert.deepEqual([linked.relationship.fromVaultId, linked.relationship.toVaultId].sort(), [oneId, twoEntry.id].sort());
});

test("lens, handoff, and run preflight surface related vault context", () => {
  const home = tempHome();
  const one = tmp();
  const two = tmp();
  run(one, ["init", "--empty"], { HOME: home });
  run(two, ["init", "--empty"], { HOME: home });
  run(one, ["register", "--name", "Portal"], { HOME: home });
  run(two, ["register", "--name", "Sanity"], { HOME: home });
  const registry = readRegistry(home);
  const sanityId = registry.vaults.find((vault) => vault.name === "Sanity")?.id;
  assert.ok(sanityId);
  run(one, ["vault", "link", "--to", "Sanity", "--rel", "depends_on"], { HOME: home });
  run(one, ["run", "start", "--goal", "Portal schema work", "--agent", "test"], { HOME: home });
  run(one, ["add", "node", "--type", "task", "--title", "Schema impact", "--summary", "Touches Sanity.", "--status", "active", "--fields-json", JSON.stringify({ crossVaultRefs: [{ vaultId: sanityId, rel: "requires_update", status: "open", reason: "Schema contract changed." }] })], { HOME: home });
  run(one, ["build", "--json"], { HOME: home });
  const lens = JSON.parse(run(one, ["lens", "task", "--goal", "Sanity schema", "--json"], { HOME: home }));
  const topologySection = lens.sections.find((section: { section: string }) => section.section === "topology");
  assert.ok(topologySection.items.some((item: { id: string }) => item.id === sanityId));
  const handoff = JSON.parse(run(one, ["handoff", "--json", "--no-record"], { HOME: home }));
  assert.ok(handoff.sections.find((section: { section: string }) => section.section === "topology"));
  assert.equal(handoff.topology.relatedVaults[0].id, sanityId);
  const finish = JSON.parse(runFail(one, ["run", "finish", "--status", "completed", "--summary", "Done.", "--json"], { HOME: home }));
  assert.equal(finish.ok, false);
  assert.ok(finish.preflight.warnings.some((warning: { code: string }) => warning.code === "AWG_RUN_CROSS_VAULT_IMPACT_UNHANDLED"));
});
