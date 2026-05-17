import { randomUUID } from "node:crypto";
import { AWG_VERSION } from "../../core/constants.js";
import { buildAwg } from "../../core/compiler.js";
import { coordinationCheck, targetKindFor } from "../../core/coordination.js";
import { activeRun, buildRuns, runEventId } from "../../core/runs.js";
import type { AwgEvent } from "../../core/types.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { nowIso } from "../../util/time.js";
import { str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

const MODES = ["exclusive", "shared", "watch"];
const RELEASE_STATUSES = ["completed", "released", "abandoned", "blocked"];

export async function coordCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  if (sub === "status") return status(parsed);
  if (sub === "claim") return claim(parsed);
  if (sub === "release") return release(parsed);
  if (sub === "check") return check(parsed);
  if (sub === "handoff") return handoff(parsed);
  throw new Error("Usage: awg coord status|claim|release|check|handoff ...");
}

async function status(parsed: ParsedArgs): Promise<void> {
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false, coordinationAsOf: nowIso() });
  const index = graph.coordination_index;
  if (parsed.flags.json) return printJson({ ok: true, generated_at: graph.generated_at, coordination: index });
  if (!index?.claims.length) return console.log("No coordination claims.");
  console.log(`Coordination: ${index.summary.activeClaims} active, ${index.summary.staleClaims} stale, ${index.summary.collisions} collisions`);
  for (const claim of index.claims.slice(0, 20)) console.log(`- ${claim.id} ${claim.status} ${claim.mode} ${claim.targetIds.join(", ")}${claim.runId ? ` (${claim.runId})` : ""}`);
}

async function claim(parsed: ParsedArgs): Promise<void> {
  const target = parsed.positionals[2];
  if (!target) throw new Error("Usage: awg coord claim <target> [--mode exclusive|shared|watch] [--json]");
  const mode = str(parsed.flags, "mode", "exclusive") ?? "exclusive";
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of: ${MODES.join(", ")}`);
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false, coordinationAsOf: nowIso() });
  const runId = resolveRunId(parsed, graph);
  const warnings = runId ? [] : [{ code: "AWG_COORDINATION_UNATTRIBUTED_CLAIM", severity: "warning", message: "No active or explicit run is attached to this coordination claim.", suggestedCommands: ["awg run start --goal \"...\"", "awg coord claim <target> --run <run-id>"] }];
  const at = nowIso();
  const ttlHours = ttl(parsed);
  const expiresAt = new Date(Date.parse(at) + ttlHours * 3_600_000).toISOString();
  const coordinationId = `coord:${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const checkResult = coordinationCheck(graph, target, runId);
  const event: AwgEvent = {
    awg: AWG_VERSION,
    kind: "event",
    id: runEventId(runId ?? "coord", `coord-claim-${coordinationId.replace(/^coord:/, "")}`, at),
    type: "coordination.claimed",
    target,
    targetKind: targetKindFor(target),
    targetIds: [target],
    queueItemId: target.startsWith("wq:") ? target : undefined,
    by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex",
    at,
    run: runId,
    runId,
    agent: str(parsed.flags, "agent", "codex"),
    coordinationId,
    mode,
    summary: str(parsed.flags, "summary"),
    reason: str(parsed.flags, "reason"),
    expires_at: expiresAt
  };
  await storage.appendLogEntry(event);
  const rebuilt = await buildAwg(storage, { write: false, coordinationAsOf: nowIso() });
  const created = rebuilt.graph.coordination_index?.claims.find((item) => item.id === coordinationId);
  if (parsed.flags.json) return printJson({ ok: true, coordinationId, claim: created, warnings: [...warnings, ...checkResult.warnings] });
  console.log(`Created coordination claim ${coordinationId}`);
  for (const warning of warnings) console.log(`warning: ${warning.message}`);
  for (const warning of checkResult.warnings) console.log(`warning: ${warning.message}`);
}

async function release(parsed: ParsedArgs): Promise<void> {
  const coordinationId = parsed.positionals[2];
  if (!coordinationId) throw new Error("Usage: awg coord release <coordination-id> --status completed|released|abandoned|blocked [--json]");
  const status = required(parsed, "status");
  if (!RELEASE_STATUSES.includes(status)) throw new Error(`--status must be one of: ${RELEASE_STATUSES.join(", ")}`);
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false, coordinationAsOf: nowIso() });
  if (!graph.coordination_index?.claims.some((claim) => claim.id === coordinationId)) {
    if (parsed.flags.json) {
      printJson({ ok: false, code: "AWG_COORDINATION_CLAIM_NOT_FOUND", coordinationId });
      process.exitCode = 1;
      return;
    }
    throw new Error(`Coordination claim not found: ${coordinationId}`);
  }
  const runId = resolveRunId(parsed, graph);
  const at = nowIso();
  const event: AwgEvent = {
    awg: AWG_VERSION,
    kind: "event",
    id: runEventId(runId ?? "coord", `coord-release-${coordinationId.replace(/^coord:/, "")}`, at),
    type: "coordination.released",
    target: coordinationId,
    by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex",
    at,
    run: runId,
    runId,
    coordinationId,
    status,
    summary: str(parsed.flags, "summary")
  };
  await storage.appendLogEntry(event);
  if (parsed.flags.json) return printJson({ ok: true, coordinationId, status });
  console.log(`Released ${coordinationId} (${status})`);
}

async function check(parsed: ParsedArgs): Promise<void> {
  const target = str(parsed.flags, "target") ?? str(parsed.flags, "queue-item");
  if (!target) throw new Error("Usage: awg coord check [--target <id>] [--queue-item <id>] [--json]");
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false, coordinationAsOf: nowIso() });
  const current = activeRun(buildRuns(graph));
  const result = coordinationCheck(graph, target, current?.id);
  if (parsed.flags.json) return printJson({ ok: true, target, available: result.available, warnings: result.warnings, claims: result.claims, collisions: result.collisions });
  console.log(result.available ? `Available: ${target}` : `Claimed: ${target}`);
  for (const warning of result.warnings) console.log(`warning: ${warning.message}`);
}

async function handoff(parsed: ParsedArgs): Promise<void> {
  const coordinationId = parsed.positionals[2];
  if (!coordinationId) throw new Error("Usage: awg coord handoff <coordination-id> --summary <text> [--run <run-id>|--no-run] [--json]");
  const summary = required(parsed, "summary");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false, coordinationAsOf: nowIso() });
  const runId = resolveRunId(parsed, graph);
  const claim = graph.coordination_index?.claims.find((item) => item.id === coordinationId);
  if (!claim) {
    if (parsed.flags.json) {
      printJson({ ok: false, code: "AWG_COORDINATION_CLAIM_NOT_FOUND", coordinationId });
      process.exitCode = 1;
      return;
    }
    throw new Error(`Coordination claim not found: ${coordinationId}`);
  }
  const at = nowIso();
  const event: AwgEvent = {
    awg: AWG_VERSION,
    kind: "event",
    id: runEventId(runId ?? "coord", `coord-handoff-${coordinationId.replace(/^coord:/, "")}`, at),
    type: "coordination.handoff",
    target: coordinationId,
    by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex",
    at,
    run: runId,
    runId,
    coordinationId,
    toAgent: str(parsed.flags, "to-agent"),
    toRole: str(parsed.flags, "to-role"),
    summary,
    targetIds: claim.targetIds
  };
  await storage.appendLogEntry(event);
  if (parsed.flags.json) return printJson({ ok: true, coordinationId, handoff: event });
  console.log(`Recorded coordination handoff for ${coordinationId}`);
}

function resolveRunId(parsed: ParsedArgs, graph: Awaited<ReturnType<typeof buildAwg>>["graph"]): string | undefined {
  if (parsed.flags["no-run"]) return undefined;
  const explicit = str(parsed.flags, "run");
  if (explicit) return explicit;
  return activeRun(buildRuns(graph))?.id;
}

function ttl(parsed: ParsedArgs): number {
  const value = Number(str(parsed.flags, "ttl-hours", "24"));
  if (!Number.isFinite(value) || value <= 0) throw new Error("--ttl-hours must be a positive number");
  return value;
}

function required(parsed: ParsedArgs, key: string): string {
  const value = str(parsed.flags, key);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}
