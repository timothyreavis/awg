import { activeRun, buildRuns } from "./runs.js";
import type { CompiledGraph } from "./types.js";

export interface RunAttribution {
  run?: string;
  runId?: string;
}

export function attachRun<T extends Record<string, unknown>>(object: T, runId?: string): T {
  if (!runId) return object;
  return { ...object, run: runId, runId } as T;
}

export function runIdFromObject(object: Record<string, unknown>): string | undefined {
  return typeof object.run === "string" ? object.run : typeof object.runId === "string" ? object.runId : undefined;
}

export function resolveWriteRunId(graph: CompiledGraph, flags: Record<string, string | boolean | string[]>): string | undefined {
  if (flags["no-run"]) return undefined;
  const explicit = flagString(flags, "run");
  const runs = buildRuns(graph);
  if (explicit) {
    const run = runs.find((item) => item.id === explicit);
    if (!run) throw new Error(`Run not found: ${explicit}`);
    if (run.status !== "in_progress") throw new Error(`Run is not active: ${explicit}`);
    return explicit;
  }
  return activeRun(runs)?.id;
}

function flagString(flags: Record<string, string | boolean | string[]>, key: string): string | undefined {
  const value = flags[key];
  if (Array.isArray(value)) return value[value.length - 1];
  return typeof value === "string" ? value : undefined;
}
