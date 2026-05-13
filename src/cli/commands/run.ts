import { randomUUID } from "node:crypto";
import { AWG_VERSION } from "../../core/constants.js";
import { buildAwg } from "../../core/compiler.js";
import { activeRun, buildRuns, RUN_STATUSES, runEventId, type AgentRun, type RunStatus } from "../../core/runs.js";
import type { AwgEvent } from "../../core/types.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { nowIso } from "../../util/time.js";
import { str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function runCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  if (sub === "start") return startRun(parsed);
  if (sub === "note") return noteRun(parsed);
  if (sub === "finish") return finishRun(parsed);
  if (sub === "status") return statusRun(parsed);
  if (sub === "list") return listRuns(parsed);
  throw new Error("Usage: awg run start|note|finish|status|list ...");
}

async function startRun(parsed: ParsedArgs): Promise<void> {
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const runs = buildRuns(graph);
  const current = activeRun(runs);
  if (current && !parsed.flags.force) throw new Error(`Active run already exists: ${current.id}. Finish it first or pass --force.`);
  const at = nowIso();
  const goal = required(parsed, "goal");
  const runId = `run:${randomUUID().slice(0, 12)}`;
  const event: AwgEvent = {
    awg: AWG_VERSION,
    kind: "event",
    id: runEventId(runId, "start", at),
    type: "run_started",
    target: runId,
    by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex",
    at,
    goal,
    agent: str(parsed.flags, "agent")
  };
  await storage.appendLogEntry(event);
  const output = { ok: true, runId, run: { id: runId, goal, agent: event.agent, status: "in_progress", started_at: at } };
  if (parsed.flags.json) return printJson(output);
  console.log(`Started run ${runId}`);
}

async function noteRun(parsed: ParsedArgs): Promise<void> {
  const note = parsed.positionals.slice(2).join(" ").trim();
  if (!note) throw new Error("Usage: awg run note \"<note>\" [--run <run-id>] [--json]");
  const storage = new FileAwgStorage();
  const { run } = await resolveRun(storage, str(parsed.flags, "run"));
  const at = nowIso();
  const event: AwgEvent = {
    awg: AWG_VERSION,
    kind: "event",
    id: runEventId(run.id, "note", at),
    type: "run_note",
    target: run.id,
    run: run.id,
    by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex",
    at,
    summary: note
  };
  await storage.appendLogEntry(event);
  if (parsed.flags.json) return printJson({ ok: true, runId: run.id, note: { at, summary: note } });
  console.log(`Added note to ${run.id}`);
}

async function finishRun(parsed: ParsedArgs): Promise<void> {
  const storage = new FileAwgStorage();
  const { run } = await resolveRun(storage, str(parsed.flags, "run"));
  if (run.status !== "in_progress") throw new Error(`Run is not active: ${run.id}`);
  const status = required(parsed, "status");
  if (!RUN_STATUSES.includes(status as RunStatus) || status === "in_progress") throw new Error("--status must be one of: completed, partial, blocked, failed, abandoned");
  const at = nowIso();
  const event: AwgEvent = {
    awg: AWG_VERSION,
    kind: "event",
    id: runEventId(run.id, "finish", at),
    type: "run_finished",
    target: run.id,
    run: run.id,
    by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex",
    at,
    status,
    summary: str(parsed.flags, "summary")
  };
  await storage.appendLogEntry(event);
  if (parsed.flags.json) return printJson({ ok: true, runId: run.id, status, finished_at: at, summary: event.summary });
  console.log(`Finished run ${run.id} (${status})`);
}

async function statusRun(parsed: ParsedArgs): Promise<void> {
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false });
  const current = activeRun(buildRuns(graph));
  if (parsed.flags.json) return printJson({ ok: true, activeRun: current ?? null });
  if (!current) return console.log("No active run.");
  printRun(current);
}

async function listRuns(parsed: ParsedArgs): Promise<void> {
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false });
  const runs = buildRuns(graph).slice(0, 20);
  if (parsed.flags.json) return printJson({ ok: true, runs });
  if (!runs.length) return console.log("No runs.");
  for (const run of runs) printRun(run);
}

async function resolveRun(storage: FileAwgStorage, explicit?: string): Promise<{ graph: Awaited<ReturnType<typeof buildAwg>>["graph"]; run: AgentRun }> {
  const { graph } = await buildAwg(storage, { write: false });
  const runs = buildRuns(graph);
  const run = explicit ? runs.find((item) => item.id === explicit) : activeRun(runs);
  if (!run) throw new Error(explicit ? `Run not found: ${explicit}` : "No active run. Start one with awg run start --goal \"...\".");
  return { graph, run };
}

function printRun(run: AgentRun): void {
  console.log(`${run.id} ${run.status} ${run.goal}`);
  if (run.summary) console.log(`  summary: ${run.summary}`);
  if (run.notes.length) console.log(`  notes: ${run.notes.length}`);
}

function required(parsed: ParsedArgs, key: string): string {
  const value = str(parsed.flags, key);
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}
