import { AWG_VERSION } from "./constants.js";
import { buildDiagnostics } from "./diagnostics.js";
import { edgeId } from "./ids.js";
import { buildResumeLens } from "./lenses.js";
import { buildAnchorIndex } from "./anchors.js";
import { buildOperatingTemplateIndex } from "./operatingTemplates.js";
import { buildRunSummaries } from "./runs.js";
import { parseAndValidate } from "./validation.js";
import { renderStaticSite } from "./renderStaticSite.js";
import { buildCurrentView } from "./views.js";
import type { AwgEdge, AwgLens, AwgNode, AwgObject, AwgPolicy, AwgResponse, AwgView, BuildResult, CompiledGraph, Diagnostic } from "./types.js";
import type { AwgStorage } from "../storage/AwgStorage.js";

export interface BuildOptions {
  strict?: boolean;
  write?: boolean;
}

export async function buildAwg(storage: AwgStorage, options: BuildOptions = {}): Promise<BuildResult> {
  const config = storage.readConfig ? await storage.readConfig() : null;
  const schemaOverrides = storage.readSchemas ? await storage.readSchemas() : undefined;
  const validationConfig = (config?.validation && typeof config.validation === "object" ? config.validation : {}) as Record<string, unknown>;
  const strict = Boolean(options.strict || validationConfig.strict_links);
  const allowUnknownNodeTypes = validationConfig.allow_unknown_node_types !== false;
  const entries = await storage.readLogEntries();
  const { parsed, diagnostics } = parseAndValidate(entries, { strict, allowUnknownNodeTypes }, schemaOverrides);
  const generatedAt = generatedAtFor(parsed);
  const nodes = new Map<string, AwgNode>();
  const edges = new Map<string, AwgEdge>();
  const events: AwgObject[] = [];
  const views = new Map<string, AwgView>();
  const lenses = new Map<string, AwgLens>();
  const responses = new Map<string, AwgResponse>();
  const policies = new Map<string, AwgPolicy>();
  const seenKinds = new Map<string, string>();
  const edgeSignatures = new Map<string, string>();
  const duplicateUpserts: Array<{ id: string; kind: string; file: string; line: number; at?: string }> = [];

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
      if (prior === object.kind && object.kind !== "edge") duplicateUpserts.push({ id, kind: object.kind, file: item.raw.file, line: item.raw.line, at: typeof object.updated_at === "string" ? object.updated_at : undefined });
      seenKinds.set(id, object.kind);
    }

    if (object.kind === "node") nodes.set(object.id, mergeNode(nodes.get(object.id), object));
    if (object.kind === "edge") {
      const edge = { ...object, id: object.id || edgeId(object.from, object.rel, object.to) };
      const signature = `${edge.from}\0${edge.rel}\0${edge.to}`;
      const priorSignature = edgeSignatures.get(edge.id);
      if (priorSignature && priorSignature !== signature) {
        diagnostics.push({ severity: "fatal", code: "duplicate_edge_id_conflict", message: `Edge ID ${edge.id} was used for different relationships.`, file: item.raw.file, line: item.raw.line, id: edge.id });
        continue;
      }
      edgeSignatures.set(edge.id, signature);
      edges.set(edge.id, edge);
    }
    if (object.kind === "event") events.push(object);
    if (object.kind === "view") views.set(object.id, object);
    if (object.kind === "lens") lenses.set(object.id, object);
    if (object.kind === "response") responses.set(object.id, object);
    if (object.kind === "policy") policies.set(object.id, object);
  }

  const intentionalNodeUpserts = new Set(events.filter((event) => event.kind === "event" && ["node_updated", "evidence_added"].includes(String(event.type))).map((event) => `${String(event.target)}\0${String(event.at)}`));
  for (const duplicate of duplicateUpserts) {
    if (duplicate.kind === "node" && duplicate.at && intentionalNodeUpserts.has(`${duplicate.id}\0${duplicate.at}`)) continue;
    diagnostics.push({ severity: "warning", code: "duplicate_id_upsert", message: `ID ${duplicate.id} appeared more than once; last write wins. Use awg update node for intentional node updates.`, file: duplicate.file, line: duplicate.line, id: duplicate.id });
  }

  const sortedNodes = [...nodes.values()].sort(byId);
  const sortedEdges = [...edges.values()].sort(byId);
  const sortedResponses = [...responses.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const operatingTemplates = buildOperatingTemplateIndex(sortedNodes);
  const anchorIndex = buildAnchorIndex(sortedNodes);
  const diag = buildDiagnostics(sortedNodes, sortedEdges, sortedResponses, events as never, diagnostics, strict, config, operatingTemplates);
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
    diagnostics: diagnosticsReport,
    operating_templates: operatingTemplates,
    anchor_index: anchorIndex
  };
  graph.run_summaries = buildRunSummaries(graph);
  const resumeLens = buildResumeLens(sortedNodes, sortedResponses, diag.summary, diag.recommended, generatedAt);
  const currentView = buildCurrentView(sortedNodes, diag.summary, generatedAt);

  if (options.write !== false) {
    if (diagnosticsReport.summary.fatal_error_count === 0) await writeCompiled(storage, graph, diagnosticsReport, resumeLens, currentView);
    else {
      await writeGraphArtifacts(storage, graph);
      await writeFailedBuildArtifacts(storage, diagnosticsReport, resumeLens, currentView);
    }
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

function generatedAtFor(parsed: Array<{ object?: AwgObject }>): string {
  let latest = 0;
  for (const item of parsed) {
    const object = item.object as Record<string, unknown> | undefined;
    if (!object) continue;
    for (const key of ["updated_at", "created_at", "at"]) {
      const value = object[key];
      if (typeof value !== "string") continue;
      const time = Date.parse(value);
      if (Number.isFinite(time) && time > latest) latest = time;
    }
  }
  return latest > 0 ? new Date(latest).toISOString() : "1970-01-01T00:00:00.000Z";
}

async function writeCompiled(storage: AwgStorage, graph: CompiledGraph, diagnostics: CompiledGraph["diagnostics"], resumeLens: unknown, currentView: unknown): Promise<void> {
  await writeGraphArtifacts(storage, graph);
  const site = renderStaticSite(graph, currentView as never, diagnostics, resumeLens as never);
  await storage.writeCompiledArtifact("lenses/resume.json", resumeLens as object);
  await storage.writeCompiledArtifact("views/current.json", currentView as object);
  await storage.writeCompiledArtifact("reports/diagnostics.json", diagnostics);
  await storage.writeCompiledArtifact("site/index.html", site.html);
  await storage.writeCompiledArtifact("site/app.js", site.js);
  await storage.writeCompiledArtifact("site/style.css", site.css);
}

async function writeGraphArtifacts(storage: AwgStorage, graph: CompiledGraph): Promise<void> {
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
  await storage.writeCompiledArtifact("graph.json", graph);
  await storage.writeCompiledArtifact("nodes.json", graph.nodes);
  await storage.writeCompiledArtifact("edges.json", graph.edges);
  await storage.writeCompiledArtifact("indexes/backlinks.json", backlinks);
  await storage.writeCompiledArtifact("indexes/by-type.json", byType);
  await storage.writeCompiledArtifact("indexes/by-status.json", byStatus);
  await storage.writeCompiledArtifact("indexes/tags.json", tags);
  if (graph.operating_templates) await storage.writeCompiledArtifact("indexes/operating-templates.json", graph.operating_templates);
  if (graph.anchor_index) await storage.writeCompiledArtifact("indexes/anchors.json", graph.anchor_index);
}

async function writeFailedBuildArtifacts(storage: AwgStorage, diagnostics: CompiledGraph["diagnostics"], resumeLens: unknown, currentView: unknown): Promise<void> {
  await storage.writeCompiledArtifact("reports/diagnostics.json", diagnostics);
  await storage.writeCompiledArtifact("lenses/resume.json", resumeLens as object);
  await storage.writeCompiledArtifact("views/current.json", currentView as object);
  await storage.writeCompiledArtifact("site/index.html", failedBuildHtml(diagnostics));
  await storage.writeCompiledArtifact("site/app.js", "\"use strict\";\n");
  await storage.writeCompiledArtifact("site/style.css", "body{font-family:ui-sans-serif,system-ui,sans-serif;margin:32px;line-height:1.45;max-width:880px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.fatal{color:#a40000}\n");
}

function failedBuildHtml(diagnostics: CompiledGraph["diagnostics"]): string {
  const rows = diagnostics.diagnostics.map((diag) => `<li><strong>${escapeHtml(diag.severity.toUpperCase())}</strong> <code>${escapeHtml(diag.code)}</code>${diag.id ? ` <code>${escapeHtml(diag.id)}</code>` : ""}: ${escapeHtml(diag.message)}</li>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AWG Build Failed</title><link rel="stylesheet" href="./style.css"></head><body><h1>AWG Build Failed</h1><p class="fatal">${diagnostics.summary.fatal_error_count} fatal errors, ${diagnostics.summary.warning_count} warnings.</p><p>Fix fatal diagnostics, then run <code>awg build</code> again.</p><ul>${rows}</ul></body></html>
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}
