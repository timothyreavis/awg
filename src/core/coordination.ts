import { createHash } from "node:crypto";
import { AWG_VERSION } from "./constants.js";
import { buildRuns } from "./runs.js";
import type { AwgEvent, CompiledGraph, CoordinationClaimRecord, CoordinationCollisionRecord, CoordinationHandoffRecord, CoordinationIndex, CoordinationMode, Diagnostic, WorkQueueCoordinationState, WorkQueueItem } from "./types.js";

const MODES = new Set(["exclusive", "shared", "watch"]);
const RELEASE_STATUSES = new Set(["completed", "released", "abandoned", "blocked"]);

export function buildCoordinationIndex(graph: CompiledGraph, asOf = graph.generated_at): CoordinationIndex {
  const events = graph.events.filter((event) => String(event.type).startsWith("coordination.")).sort((a, b) => eventAt(a).localeCompare(eventAt(b)) || String(a.id ?? "").localeCompare(String(b.id ?? "")));
  const byId = new Map<string, CoordinationClaimRecord>();
  const handoffs: CoordinationHandoffRecord[] = [];
  const acknowledgements = new Map<string, AwgEvent>();
  const finishedRuns = new Set(buildRuns(graph).filter((run) => run.status !== "in_progress").map((run) => run.id));
  const activeRuns = new Set(buildRuns(graph).filter((run) => run.status === "in_progress").map((run) => run.id));

  for (const event of events) {
    if (event.type === "coordination.claimed") {
      const target = targetFromEvent(event);
      const id = coordinationIdFor(event, target.ids);
      const expanded = expandTarget(graph, target.kind, target.ids, event.queueItemId);
      byId.set(id, {
        id,
        status: "active",
        mode: MODES.has(String(event.mode)) ? String(event.mode) as CoordinationMode : "exclusive",
        agent: typeof event.agent === "string" ? event.agent : typeof event.by === "string" ? event.by : undefined,
        runId: typeof event.runId === "string" ? event.runId : typeof event.run === "string" ? event.run : undefined,
        targetKind: target.kind,
        targetIds: target.ids,
        queueItemId: typeof event.queueItemId === "string" ? event.queueItemId : target.ids.find((id) => id.startsWith("wq:")),
        ...expanded,
        summary: typeof event.summary === "string" ? event.summary : undefined,
        reason: typeof event.reason === "string" ? event.reason : undefined,
        createdAt: eventAt(event),
        updatedAt: eventAt(event),
        expiresAt: typeof event.expires_at === "string" ? event.expires_at : typeof event.expiresAt === "string" ? event.expiresAt : undefined,
        handoffIds: [],
        collisionIds: [],
        suggestedCommands: [`awg coord status --json`, `awg coord release ${id} --status released --summary "..."`]
      });
    }
    if (event.type === "coordination.released") {
      const id = String(event.coordinationId ?? event.target ?? "");
      const claim = byId.get(id);
      if (!claim) continue;
      const status = RELEASE_STATUSES.has(String(event.status)) ? String(event.status) : "released";
      claim.status = status as CoordinationClaimRecord["status"];
      claim.releaseStatus = status;
      claim.releasedAt = eventAt(event);
      claim.updatedAt = eventAt(event);
      if (typeof event.summary === "string") claim.summary = event.summary;
    }
    if (event.type === "coordination.handoff") {
      const coordinationId = String(event.coordinationId ?? event.target ?? "");
      const claim = byId.get(coordinationId);
      const handoff: CoordinationHandoffRecord = {
        id: String(event.id ?? `ev:${hash(["coordination.handoff", coordinationId, eventAt(event)])}`),
        coordinationId,
        runId: typeof event.runId === "string" ? event.runId : typeof event.run === "string" ? event.run : undefined,
        toAgent: typeof event.toAgent === "string" ? event.toAgent : undefined,
        toRole: typeof event.toRole === "string" ? event.toRole : undefined,
        summary: String(event.summary ?? ""),
        targetIds: stringArray(event.targetIds).length ? stringArray(event.targetIds) : claim?.targetIds ?? [],
        at: eventAt(event)
      };
      handoffs.push(handoff);
      if (claim) {
        claim.handoffIds = sorted([...claim.handoffIds, handoff.id]);
        claim.updatedAt = eventAt(event);
      }
    }
    if (event.type === "coordination.collision_acknowledged") acknowledgements.set(String(event.coordinationId ?? event.target ?? ""), event);
  }

  for (const claim of byId.values()) {
    if (claim.status === "active" && ((claim.expiresAt && claim.expiresAt < asOf) || (claim.runId && finishedRuns.has(claim.runId)))) claim.status = "stale";
    claim.runIds = sorted([...claim.runIds, ...(claim.runId ? [claim.runId] : [])]);
    if (claim.runId && activeRuns.has(claim.runId)) claim.suggestedCommands.unshift(`awg run status --json`);
  }

  const claims = [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const collisions = detectCollisions(claims, acknowledgements);
  for (const collision of collisions) for (const id of collision.claimIds) {
    const claim = byId.get(id);
    if (claim) claim.collisionIds = sorted([...claim.collisionIds, collision.id]);
  }
  return {
    awg: AWG_VERSION,
    kind: "coordination-index",
    generated_at: graph.generated_at,
    claims,
    collisions,
    handoffs: handoffs.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)),
    summary: {
      activeClaims: claims.filter((claim) => claim.status === "active").length,
      staleClaims: claims.filter((claim) => claim.status === "stale").length,
      collisions: collisions.length,
      handoffs: handoffs.length,
      claimedQueueItems: new Set(claims.filter((claim) => claim.queueItemId).map((claim) => claim.queueItemId)).size,
      claimedNodes: new Set(claims.flatMap((claim) => claim.nodeIds)).size
    }
  };
}

export function coordinationDiagnostics(graph: CompiledGraph, strict = false): Diagnostic[] {
  const severity = strict ? "fatal" : "warning";
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const finishedRunIds = new Set(buildRuns(graph).filter((run) => run.status !== "in_progress").map((run) => run.id));
  const out: Diagnostic[] = [];
  for (const event of graph.events.filter((event) => String(event.type).startsWith("coordination."))) {
    if (!["coordination.claimed", "coordination.released", "coordination.handoff", "coordination.collision_acknowledged"].includes(event.type)) {
      out.push({ severity, code: "AWG_COORDINATION_INVALID_EVENT", message: `Unknown coordination event type: ${event.type}`, id: event.id });
    }
    if (event.type === "coordination.claimed" && !MODES.has(String(event.mode ?? "exclusive"))) {
      out.push({ severity, code: "AWG_COORDINATION_INVALID_EVENT", message: `Invalid coordination claim mode: ${String(event.mode)}`, id: event.id });
    }
  }
  for (const claim of graph.coordination_index?.claims ?? []) {
    if (claim.status === "stale") out.push({ severity: "warning", code: "AWG_COORDINATION_STALE_CLAIM", message: `Coordination claim is stale: ${claim.id}`, id: claim.id, fixSuggestion: { command: `awg coord release ${claim.id} --status abandoned --summary "..."` } });
    if (claim.status === "stale" && claim.runId && finishedRunIds.has(claim.runId)) out.push({ severity: "warning", code: "AWG_COORDINATION_FINISHED_RUN_UNRELEASED_CLAIM", message: `Finished run has unreleased coordination claim: ${claim.runId}`, id: claim.id, fixSuggestion: { command: `awg coord release ${claim.id} --status released --summary "..."` } });
    for (const id of claim.targetIds.filter((id) => id.startsWith("n:") && !nodeIds.has(id))) out.push({ severity, code: "AWG_COORDINATION_MISSING_TARGET", message: `Coordination claim references missing target: ${id}`, id: claim.id, fixSuggestion: { command: "awg coord status --json" } });
  }
  for (const collision of graph.coordination_index?.collisions ?? []) out.push({ severity: "warning", code: "AWG_COORDINATION_ACTIVE_COLLISION", message: collision.message, id: collision.id, fixSuggestion: { command: collision.suggestedCommands[0] } });
  for (const handoff of graph.coordination_index?.handoffs ?? []) {
    if (!(graph.coordination_index?.claims ?? []).some((claim) => claim.id === handoff.coordinationId)) out.push({ severity, code: "AWG_COORDINATION_HANDOFF_MISSING_CLAIM", message: `Coordination handoff references missing claim: ${handoff.coordinationId}`, id: handoff.id, fixSuggestion: { command: "awg coord status --json" } });
    for (const id of handoff.targetIds.filter((target) => target.startsWith("n:") && !nodeIds.has(target))) out.push({ severity, code: "AWG_COORDINATION_HANDOFF_MISSING_TARGET", message: `Coordination handoff references missing target: ${id}`, id: handoff.id, fixSuggestion: { command: "awg coord status --json" } });
  }
  return out;
}

export function coordinationForQueueItem(item: WorkQueueItem, graph: CompiledGraph, currentRunId?: string): WorkQueueCoordinationState {
  const targetIds = idsForOverlap(item);
  const claims = (graph.coordination_index?.claims ?? []).filter((claim) => claim.status === "active" || claim.status === "stale").filter((claim) => overlaps(targetIds, claim));
  const active = claims.filter((claim) => claim.status === "active");
  const collisions = (graph.coordination_index?.collisions ?? []).filter((collision) => collision.claimIds.some((id) => claims.some((claim) => claim.id === id)));
  const handoffs = (graph.coordination_index?.handoffs ?? []).filter((handoff) => claims.some((claim) => claim.id === handoff.coordinationId));
  return {
    activeClaimIds: active.map((claim) => claim.id).sort(),
    staleClaimIds: claims.filter((claim) => claim.status === "stale").map((claim) => claim.id).sort(),
    collisionIds: collisions.map((collision) => collision.id).sort(),
    handoffIds: handoffs.map((handoff) => handoff.id).sort(),
    claimedByOtherActiveRun: active.some((claim) => claim.mode === "exclusive" && claim.runId && claim.runId !== currentRunId),
    claimedByCurrentRun: Boolean(currentRunId && active.some((claim) => claim.runId === currentRunId))
  };
}

export function coordinationCheck(graph: CompiledGraph, target: string, currentRunId?: string): { available: boolean; warnings: Diagnostic[]; claims: CoordinationClaimRecord[]; collisions: CoordinationCollisionRecord[] } {
  const expanded = expandTarget(graph, targetKindFor(target), [target], target.startsWith("wq:") ? target : undefined);
  const claims = (graph.coordination_index?.claims ?? []).filter((claim) => claim.status === "active" && overlaps(new Set([target, ...expanded.nodeIds, ...expanded.runIds, ...expanded.claimIds, ...expanded.evidenceIds, ...expanded.vaultIds, ...expanded.relationshipIds]), claim));
  const blocking = claims.filter((claim) => claim.mode === "exclusive" && (!currentRunId || claim.runId !== currentRunId));
  const collisions = (graph.coordination_index?.collisions ?? []).filter((collision) => collision.claimIds.some((id) => claims.some((claim) => claim.id === id)));
  return {
    available: blocking.length === 0,
    claims,
    collisions,
    warnings: blocking.map((claim) => ({ severity: "warning", code: "AWG_COORDINATION_ACTIVE_CLAIM", message: `Another active run has an exclusive work claim on this target: ${claim.id}`, id: claim.id, fixSuggestion: { command: "awg coord status --json" } }))
  };
}

export function targetKindFor(target: string): string {
  if (target.startsWith("n:")) return "node";
  if (target.startsWith("wq:")) return "queue";
  if (target.startsWith("run:")) return "run";
  if (target.startsWith("vault:")) return "vault";
  return "unknown";
}

function detectCollisions(claims: CoordinationClaimRecord[], acknowledgements: Map<string, AwgEvent>): CoordinationCollisionRecord[] {
  const active = claims.filter((claim) => claim.status === "active" && claim.mode !== "watch");
  const out: CoordinationCollisionRecord[] = [];
  for (let i = 0; i < active.length; i += 1) for (let j = i + 1; j < active.length; j += 1) {
    const a = active[i];
    const b = active[j];
    if (a.runId && b.runId && a.runId === b.runId) continue;
    if (a.mode === "shared" && b.mode === "shared") continue;
    const overlap = overlapIds(a, b);
    if (!overlap.length) continue;
    const claimIds = sorted([a.id, b.id]);
    const id = `coord-collision:${hash([...claimIds, ...overlap])}`;
    const ack = acknowledgements.get(a.id) ?? acknowledgements.get(b.id) ?? acknowledgements.get(id);
    out.push({
      id,
      claimIds,
      nodeIds: overlap.filter((value) => value.startsWith("n:")),
      queueItemIds: sorted([a.queueItemId, b.queueItemId].filter((value): value is string => Boolean(value))),
      runIds: sorted([a.runId, b.runId].filter((value): value is string => Boolean(value))),
      agents: sorted([a.agent, b.agent].filter((value): value is string => Boolean(value))),
      severity: "warning",
      message: `Active coordination claims overlap: ${claimIds.join(", ")}`,
      acknowledged: Boolean(ack),
      acknowledgedByRunId: typeof ack?.runId === "string" ? ack.runId : undefined,
      suggestedCommands: [`awg coord check --target ${overlap[0]} --json`, `awg coord status --json`]
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function targetFromEvent(event: AwgEvent): { kind: string; ids: string[] } {
  const ids = stringArray(event.targetIds);
  const target = typeof event.target === "string" && event.target !== "" ? event.target : undefined;
  const all = sorted(ids.length ? ids : target ? [target] : []);
  return { kind: typeof event.targetKind === "string" ? event.targetKind : all[0] ? targetKindFor(all[0]) : "unknown", ids: all };
}

function expandTarget(graph: CompiledGraph, kind: string, ids: string[], queueItemId: unknown): Omit<CoordinationClaimRecord, "id" | "status" | "mode" | "agent" | "runId" | "targetKind" | "targetIds" | "queueItemId" | "summary" | "reason" | "createdAt" | "updatedAt" | "expiresAt" | "releasedAt" | "releaseStatus" | "handoffIds" | "collisionIds" | "suggestedCommands"> {
  const queueIds = [...ids.filter((id) => id.startsWith("wq:")), ...(typeof queueItemId === "string" ? [queueItemId] : [])];
  const queueItems = (graph.work_queue_index?.items ?? []).filter((item) => queueIds.includes(item.id));
  return {
    nodeIds: sorted([...ids.filter((id) => id.startsWith("n:")), ...queueItems.flatMap((item) => item.nodeIds)]),
    runIds: sorted([...ids.filter((id) => id.startsWith("run:")), ...queueItems.flatMap((item) => item.runIds)]),
    claimIds: sorted(queueItems.flatMap((item) => item.claimIds)),
    evidenceIds: sorted(queueItems.flatMap((item) => item.evidenceIds)),
    vaultIds: sorted([...ids.filter((id) => id.startsWith("vault:")), ...queueItems.flatMap((item) => item.vaultIds)]),
    relationshipIds: sorted(queueItems.flatMap((item) => item.relationshipIds))
  };
}

function idsForOverlap(item: WorkQueueItem): Set<string> {
  return new Set([item.id, ...item.nodeIds, ...item.runIds, ...item.claimIds, ...item.evidenceIds, ...item.vaultIds, ...item.relationshipIds]);
}

function overlaps(ids: Set<string>, claim: CoordinationClaimRecord): boolean {
  const right = new Set([claim.queueItemId, ...claim.targetIds, ...claim.nodeIds, ...claim.runIds, ...claim.claimIds, ...claim.evidenceIds, ...claim.vaultIds, ...claim.relationshipIds].filter((value): value is string => Boolean(value)));
  return [...ids].some((id) => right.has(id));
}

function overlapIds(a: CoordinationClaimRecord, b: CoordinationClaimRecord): string[] {
  const left = new Set([a.queueItemId, ...a.targetIds, ...a.nodeIds, ...a.runIds, ...a.claimIds, ...a.evidenceIds, ...a.vaultIds, ...a.relationshipIds].filter((value): value is string => Boolean(value)));
  const right = [b.queueItemId, ...b.targetIds, ...b.nodeIds, ...b.runIds, ...b.claimIds, ...b.evidenceIds, ...b.vaultIds, ...b.relationshipIds].filter((value): value is string => Boolean(value));
  return sorted(right.filter((value) => left.has(value)));
}

function coordinationIdFor(event: AwgEvent, targetIds: string[]): string {
  if (typeof event.coordinationId === "string" && event.coordinationId.startsWith("coord:")) return event.coordinationId;
  return `coord:${hash([String(event.id ?? eventAt(event)), ...targetIds])}`;
}

function eventAt(event: AwgEvent): string {
  return typeof event.at === "string" ? event.at : typeof event.created_at === "string" ? event.created_at : "1970-01-01T00:00:00.000Z";
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").sort();
}

function sorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function hash(values: string[]): string {
  return createHash("sha256").update(values.join("\0")).digest("hex").slice(0, 16);
}
