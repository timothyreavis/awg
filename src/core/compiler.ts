import { AWG_VERSION } from "./constants.js";
import { buildDiagnostics } from "./diagnostics.js";
import { edgeId } from "./ids.js";
import { buildResumeLens } from "./lenses.js";
import { parseAndValidate } from "./validation.js";
import { renderStaticSite } from "./renderStaticSite.js";
import { buildCurrentView } from "./views.js";
import type { AwgEdge, AwgLens, AwgNode, AwgObject, AwgPolicy, AwgResponse, AwgView, BuildResult, CompiledGraph, Diagnostic } from "./types.js";
import type { AwgStorage } from "../storage/AwgStorage.js";
import { nowIso } from "../util/time.js";

export interface BuildOptions {
  strict?: boolean;
  write?: boolean;
}

export async function buildAwg(storage: AwgStorage, options: BuildOptions = {}): Promise<BuildResult> {
  const generatedAt = nowIso();
  const config = storage.readConfig ? await storage.readConfig() : null;
  if (storage.readSchemas) await storage.readSchemas();
  const validationConfig = (config?.validation && typeof config.validation === "object" ? config.validation : {}) as Record<string, unknown>;
  const strict = Boolean(options.strict || validationConfig.strict_links);
  const allowUnknownNodeTypes = validationConfig.allow_unknown_node_types !== false;
  const entries = await storage.readLogEntries();
  const { parsed, diagnostics } = parseAndValidate(entries, { strict, allowUnknownNodeTypes });
  const nodes = new Map<string, AwgNode>();
  const edges = new Map<string, AwgEdge>();
  const events: AwgObject[] = [];
  const views = new Map<string, AwgView>();
  const lenses = new Map<string, AwgLens>();
  const responses = new Map<string, AwgResponse>();
  const policies = new Map<string, AwgPolicy>();
  const seenKinds = new Map<string, string>();

  for (const item of parsed) {
    if (!item.object) continue;
    const object = item.object;
    const id = "id" in object ? object.id : undefined;
    if (id) {
      const prior = seenKinds.get(id);
      if (prior && prior !== object.kind) {
        diagnostics.push({ severity: "fatal", code: "duplicate_id_incompatible_kind", message: `ID ${id} was used for both ${prior} and ${object.kind}.`, file: item.raw.file, line: item.raw.line, id });
        continue;
      }
      if (prior === object.kind && object.kind !== "edge") diagnostics.push({ severity: "warning", code: "duplicate_id_upsert", message: `ID ${id} appeared more than once; last write wins.`, file: item.raw.file, line: item.raw.line, id });
      seenKinds.set(id, object.kind);
    }

    if (object.kind === "node") nodes.set(object.id, mergeNode(nodes.get(object.id), object));
    if (object.kind === "edge") {
      const edge = { ...object, id: object.id || edgeId(object.from, object.rel, object.to) };
      edges.set(edge.id, edge);
    }
    if (object.kind === "event") events.push(object);
    if (object.kind === "view") views.set(object.id, object);
    if (object.kind === "lens") lenses.set(object.id, object);
    if (object.kind === "response") responses.set(object.id, object);
    if (object.kind === "policy") policies.set(object.id, object);
  }

  const sortedNodes = [...nodes.values()].sort(byId);
  const sortedEdges = [...edges.values()].sort(byId);
  const sortedResponses = [...responses.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const diag = buildDiagnostics(sortedNodes, sortedEdges, sortedResponses, diagnostics, strict);
  const diagnosticsReport = { awg: AWG_VERSION, generated_at: generatedAt, summary: diag.summary, diagnostics: diag.diagnostics };
  const graph: CompiledGraph = {
    awg: AWG_VERSION,
    generated_at: generatedAt,
    source: { log_files: [...new Set(entries.map((entry) => entry.file))].sort(), entry_count: entries.length },
    stats: { nodes: sortedNodes.length, edges: sortedEdges.length, events: events.length, responses: sortedResponses.length },
    nodes: sortedNodes,
    edges: sortedEdges,
    events: events as never,
    views: [...views.values()].sort(byId),
    lenses: [...lenses.values()].sort(byId),
    responses: sortedResponses,
    policies: [...policies.values()].sort(byId),
    diagnostics: diagnosticsReport
  };
  const resumeLens = buildResumeLens(sortedNodes, sortedResponses, diag.summary, diag.recommended, generatedAt);
  const currentView = buildCurrentView(sortedNodes, diag.summary, generatedAt);

  if (options.write !== false && diagnosticsReport.summary.fatal_error_count === 0) {
    await writeCompiled(storage, graph, diagnosticsReport, resumeLens, currentView);
  }

  return { graph, diagnostics: diagnosticsReport, resumeLens, currentView };
}

function mergeNode(prior: AwgNode | undefined, next: AwgNode): AwgNode {
  if (!prior) return next;
  return { ...prior, ...next, created_at: prior.created_at, updated_at: next.updated_at || prior.updated_at };
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}

async function writeCompiled(storage: AwgStorage, graph: CompiledGraph, diagnostics: CompiledGraph["diagnostics"], resumeLens: unknown, currentView: unknown): Promise<void> {
  const backlinks: Record<string, AwgEdge[]> = {};
  const byType: Record<string, string[]> = {};
  const byStatus: Record<string, string[]> = {};
  const tags: Record<string, string[]> = {};
  for (const node of graph.nodes) {
    (byType[node.type] ||= []).push(node.id);
    (byStatus[node.status] ||= []).push(node.id);
    for (const tag of node.tags ?? []) (tags[tag] ||= []).push(node.id);
  }
  for (const edge of graph.edges) {
    (backlinks[edge.to] ||= []).push(edge);
  }
  const site = renderStaticSite(graph, currentView as never, diagnostics);
  await storage.writeCompiledArtifact("graph.json", graph);
  await storage.writeCompiledArtifact("nodes.json", graph.nodes);
  await storage.writeCompiledArtifact("edges.json", graph.edges);
  await storage.writeCompiledArtifact("indexes/backlinks.json", backlinks);
  await storage.writeCompiledArtifact("indexes/by-type.json", byType);
  await storage.writeCompiledArtifact("indexes/by-status.json", byStatus);
  await storage.writeCompiledArtifact("indexes/tags.json", tags);
  await storage.writeCompiledArtifact("lenses/resume.json", resumeLens as object);
  await storage.writeCompiledArtifact("views/current.json", currentView as object);
  await storage.writeCompiledArtifact("reports/diagnostics.json", diagnostics);
  await storage.writeCompiledArtifact("site/index.html", site.html);
  await storage.writeCompiledArtifact("site/app.js", site.js);
  await storage.writeCompiledArtifact("site/style.css", site.css);
}
