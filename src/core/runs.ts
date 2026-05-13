import type { AwgEvent, CompiledGraph } from "./types.js";

export const RUN_STATUSES = ["in_progress", "completed", "partial", "blocked", "failed", "abandoned"] as const;
export type RunStatus = typeof RUN_STATUSES[number];

export interface AgentRun {
  id: string;
  goal: string;
  agent?: string;
  status: RunStatus;
  started_at: string;
  updated_at: string;
  finished_at?: string;
  summary?: string;
  notes: RunNote[];
  evidence: string[];
  changed_nodes: string[];
  handoffs: string[];
}

export interface RunNote {
  id?: string;
  at: string;
  by: string;
  summary: string;
}

export function buildRuns(graph: Pick<CompiledGraph, "events">): AgentRun[] {
  const runs = new Map<string, AgentRun>();
  const events = graph.events.slice().sort((a, b) => a.at.localeCompare(b.at) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
  for (const event of events) {
    if (event.type === "run_started") {
      const runId = String(event.target);
      runs.set(runId, {
        id: runId,
        goal: String(event.goal ?? ""),
        agent: typeof event.agent === "string" ? event.agent : undefined,
        status: "in_progress",
        started_at: event.at,
        updated_at: event.at,
        notes: [],
        evidence: [],
        changed_nodes: [],
        handoffs: []
      });
      continue;
    }
    const runId = typeof event.run === "string" ? event.run : String(event.target);
    const run = runs.get(runId);
    if (!run) continue;
    run.updated_at = event.at > run.updated_at ? event.at : run.updated_at;
    if (event.type === "run_note") {
      run.notes.push({ id: event.id, at: event.at, by: event.by, summary: String(event.summary ?? "") });
    }
    if (event.type === "run_finished") {
      const status = String(event.status);
      run.status = RUN_STATUSES.includes(status as RunStatus) ? status as RunStatus : "partial";
      run.finished_at = event.at;
      run.summary = typeof event.summary === "string" ? event.summary : undefined;
    }
    if (event.type === "evidence_added" && typeof event.evidence === "string") run.evidence.push(event.evidence);
    if (event.type === "node_updated" && typeof event.target === "string") run.changed_nodes.push(event.target);
    if (event.type === "handoff_generated") run.handoffs.push(event.id ?? event.at);
  }
  return [...runs.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
}

export function activeRun(runs: AgentRun[]): AgentRun | undefined {
  return runs.find((run) => run.status === "in_progress");
}

export function recentRuns(runs: AgentRun[], limit = 8): AgentRun[] {
  return runs.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id)).slice(0, limit);
}

export function runEventId(runId: string, type: string, at: string): string {
  return `ev:${runId.replace(/^run:/, "")}:${type}:${at.replace(/[^0-9]/g, "")}`;
}
