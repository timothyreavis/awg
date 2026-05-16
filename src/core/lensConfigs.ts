import { AWG_VERSION } from "./constants.js";
import { budgetSections, type BudgetedSection } from "./budget.js";
import { searchGraph } from "./search.js";
import { buildRuns } from "./runs.js";
import { runSummaryFor } from "./runPreflight.js";
import { buildOperatingTemplateIndex } from "./operatingTemplates.js";
import type { AwgEdge, AwgLens, AwgLensSection, AwgNode, CompiledGraph, Diagnostic, LensIndex } from "./types.js";

export const LENS_STATUSES = ["active", "proposed", "needs_review", "archived"] as const;
export const LENS_SCOPES = ["vault", "project", "workflow"] as const;
export const LENS_AUDIENCES = ["agent", "human", "reviewer"] as const;
export const LENS_SECTION_SOURCES = ["search", "nodes", "edges", "runs", "claims", "evidence", "maintenanceInbox", "diagnostics", "templateContext", "topology", "anchors", "view", "static"] as const;

const SOURCE_SET = new Set<string>(LENS_SECTION_SOURCES);
const MAX_SECTION_DATA_BYTES = 50_000;
const MAX_SECTIONS = 24;
const MAX_LIMIT = 200;

export interface ConfiguredLensOutput {
  awg: string;
  kind: "lens-output";
  id: string;
  lensId: string;
  generated_at: string;
  goal?: string;
  budget?: number;
  title: string;
  status: string;
  sections: Array<BudgetedSection<unknown> & { title?: string; source: string; required?: boolean }>;
  diagnostics: Diagnostic[];
}

export function normalizeLensSections(lens: AwgLens): AwgLensSection[] {
  if (Array.isArray(lens.sections)) return lens.sections;
  if (!Array.isArray(lens.include)) return [];
  return lens.include.map((item, index) => {
    if (typeof item === "string") return { id: item, source: legacySource(item), limit: 20 };
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      return { ...record, source: legacySource(String(record.source ?? record.id ?? `legacy-${index}`)) } as AwgLensSection;
    }
    return { id: `legacy-${index}`, source: "static", items: [item] };
  });
}

export function validateLens(lens: AwgLens, graph?: CompiledGraph, severity: Diagnostic["severity"] = "warning"): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!/^lens:[a-z0-9][a-z0-9._-]*$/i.test(lens.id)) diagnostics.push({ severity, code: "invalid_lens_id", message: `Lens id must be lens:<slug>: ${lens.id}`, id: lens.id });
  const status = lens.status ?? "needs_review";
  if (!LENS_STATUSES.includes(status as never)) diagnostics.push({ severity, code: "invalid_lens_status", message: `Lens ${lens.id} status must be one of: ${LENS_STATUSES.join(", ")}`, id: lens.id });
  if (lens.scope !== undefined && !LENS_SCOPES.includes(lens.scope as never)) diagnostics.push({ severity, code: "invalid_lens_scope", message: `Lens ${lens.id} scope must be one of: ${LENS_SCOPES.join(", ")}`, id: lens.id });
  if (lens.audience !== undefined && !LENS_AUDIENCES.includes(lens.audience as never)) diagnostics.push({ severity, code: "invalid_lens_audience", message: `Lens ${lens.id} audience must be one of: ${LENS_AUDIENCES.join(", ")}`, id: lens.id });
  const sections = normalizeLensSections(lens);
  if (!Array.isArray(sections)) diagnostics.push({ severity, code: "invalid_lens_sections", message: `Lens sections must be an array: ${lens.id}`, id: lens.id });
  if (sections.length > MAX_SECTIONS) diagnostics.push({ severity, code: "oversized_lens_sections", message: `Lens ${lens.id} has too many sections.`, id: lens.id });
  sections.forEach((section, index) => diagnostics.push(...validateSection(lens.id, section, index, graph, severity)));
  if (status === "active" && needsReview(lens)) diagnostics.push({ severity: "warning", code: "active_lens_needs_review", message: `Active lens ${lens.id} is marked as needing review.`, id: lens.id });
  return diagnostics;
}

export function validateLenses(lenses: AwgLens[], graph?: CompiledGraph, severity: Diagnostic["severity"] = "warning"): Diagnostic[] {
  const diagnostics = lenses.flatMap((lens) => validateLens(lens, graph, severity));
  const selectorKeys = new Map<string, string[]>();
  for (const lens of lenses) {
    if ((lens.status ?? "needs_review") !== "active") continue;
    const key = selectorKey(lens);
    if (!key) continue;
    const ids = selectorKeys.get(key) ?? [];
    ids.push(lens.id);
    selectorKeys.set(key, ids);
  }
  for (const [key, ids] of selectorKeys) {
    if (ids.length > 1) diagnostics.push({ severity, code: "duplicate_active_lens_selector", message: `Active lenses share selector ${key}: ${ids.join(", ")}`, id: ids[0] });
  }
  return diagnostics;
}

export function buildLensIndex(lenses: AwgLens[], generatedAt: string): LensIndex {
  return {
    awg: AWG_VERSION,
    kind: "lens-index",
    generated_at: generatedAt,
    lenses: lenses.map((lens) => ({
      id: lens.id,
      title: lens.title,
      purpose: lens.purpose,
      summary: lens.summary,
      status: lens.status ?? "needs_review",
      scope: lens.scope ?? "vault",
      audience: lens.audience ?? "agent",
      tags: Array.isArray(lens.tags) ? lens.tags : [],
      selector: lens.selector,
      sectionCount: normalizeLensSections(lens).length,
      needsReview: needsReview(lens),
      updated_at: lens.updated_at
    })).sort((a, b) => a.id.localeCompare(b.id))
  };
}

export function runConfiguredLens(graph: CompiledGraph, lens: AwgLens, goal?: string, budget?: number): ConfiguredLensOutput {
  const diagnostics = validateLens(lens, graph, "warning");
  const sections = normalizeLensSections(lens).map((section, index) => {
    const id = section.id ?? `section-${index + 1}`;
    return { section: id, title: section.title, source: section.source, required: Boolean(section.required), items: executeSection(graph, lens, section, goal), omitted: 0 };
  });
  const budgeted = budgetSections(sections, budget, renderItem).map((section, index) => ({ ...section, title: sections[index]?.title, source: sections[index]?.source ?? "static", required: sections[index]?.required }));
  for (const section of budgeted) {
    if (section.required && !section.items.length) diagnostics.push({ severity: "warning", code: "lens_required_section_empty", message: `Required lens section is empty: ${lens.id} ${section.section}`, id: lens.id });
  }
  return { awg: AWG_VERSION, kind: "lens-output", id: lens.id, lensId: lens.id, generated_at: graph.generated_at, goal, budget, title: lens.title, status: lens.status ?? "needs_review", sections: budgeted, diagnostics };
}

function executeSection(graph: CompiledGraph, lens: AwgLens, section: AwgLensSection, goal?: string): unknown[] {
  const limit = boundedLimit(section.limit);
  const query = resolveGoal(section.query, goal);
  switch (section.source) {
    case "search":
      return searchGraph(graph, String(query?.text ?? query?.q ?? goal ?? lens.title), searchOptions(query, limit));
    case "nodes":
      return filterNodes(graph, query, section).slice(0, limit).map((node) => compactNode(node, section));
    case "edges":
      return filterEdges(graph, query, section).slice(0, limit);
    case "runs":
      return buildRuns(graph).filter((run) => matchesRun(run.id, section, query) && matchesRecord(run as unknown as Record<string, unknown>, query)).slice(0, limit).map((run) => ({ ...run, attribution: runSummaryFor(graph, run.id) }));
    case "claims":
      return filterClaims(graph, query, section).slice(0, limit);
    case "evidence":
      return graph.nodes.filter((node) => node.type === "evidence").filter((node) => matchesNode(node, query)).slice(0, limit).map((node) => compactNode(node, section));
    case "maintenanceInbox":
      return (graph.maintenance_inbox?.items ?? []).filter((item) => matchesRecord(item as unknown as Record<string, unknown>, query)).slice(0, limit);
    case "diagnostics":
      return graph.diagnostics.diagnostics.filter((diag) => matchesRecord(diag as unknown as Record<string, unknown>, query)).slice(0, limit);
    case "templateContext":
      return [buildOperatingTemplateIndex(graph.nodes, goal)];
    case "topology":
      return graph.topology ? [graph.topology] : [];
    case "anchors":
      return (graph.anchor_index?.entries ?? []).filter((entry) => matchesRecord(entry as unknown as Record<string, unknown>, query)).slice(0, limit);
    case "view":
      return viewItems(graph, section).slice(0, limit);
    case "static":
      return section.items ? section.items.slice(0, limit) : section.text ? [{ text: section.text }] : [];
    default:
      return [];
  }
}

function validateSection(lensId: string, section: AwgLensSection, index: number, graph: CompiledGraph | undefined, severity: Diagnostic["severity"]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const path = `${lensId}.sections[${index}]`;
  if (!section || typeof section !== "object" || Array.isArray(section)) return [{ severity, code: "invalid_lens_sections", message: `Lens section must be an object: ${path}`, id: lensId }];
  if (typeof section.source !== "string" || !SOURCE_SET.has(section.source)) diagnostics.push({ severity, code: "unsupported_lens_section_source", message: `Unsupported lens section source "${String(section.source)}": ${path}`, id: lensId });
  if (section.query !== undefined && (!section.query || typeof section.query !== "object" || Array.isArray(section.query))) diagnostics.push({ severity, code: "invalid_lens_query", message: `Lens section query must be an object: ${path}`, id: lensId });
  if (section.query && invalidQueryKeys(section.query).length) diagnostics.push({ severity, code: "invalid_lens_query", message: `Unsupported lens query keys: ${invalidQueryKeys(section.query).join(", ")}: ${path}`, id: lensId });
  if (section.limit !== undefined && (!Number.isInteger(section.limit) || section.limit < 0 || section.limit > MAX_LIMIT)) diagnostics.push({ severity, code: "invalid_lens_limit", message: `Lens section limit must be an integer from 0 to ${MAX_LIMIT}: ${path}`, id: lensId });
  if (JSON.stringify(section).length > MAX_SECTION_DATA_BYTES) diagnostics.push({ severity, code: "oversized_lens_section_data", message: `Lens section data is too large: ${path}`, id: lensId });
  if (graph && section.nodeIds) for (const id of section.nodeIds) if (!graph.nodes.some((node) => node.id === id)) diagnostics.push({ severity, code: "missing_lens_node", message: `Lens section references missing node ${id}: ${path}`, id: lensId });
  if (graph && section.viewId && !graph.views.some((view) => view.id === section.viewId) && !graph.authored_views?.some((view) => view.id === section.viewId)) diagnostics.push({ severity, code: "missing_lens_view", message: `Lens section references missing view ${section.viewId}: ${path}`, id: lensId });
  if (graph && section.required && section.source !== "static" && executeSection(graph, { awg: AWG_VERSION, kind: "lens", id: lensId, title: lensId, purpose: "" }, section).length === 0) diagnostics.push({ severity: "warning", code: "lens_required_section_impossible", message: `Required lens section has no matching data: ${path}`, id: lensId });
  return diagnostics;
}

function invalidQueryKeys(query: Record<string, unknown>): string[] {
  const allowed = new Set(["text", "q", "id", "ids", "type", "types", "status", "statuses", "tag", "tags", "rel", "from", "to", "severity", "code", "kind", "limit", "sortBy", "verificationStatus", "claimKind", "sourceOfTruth", "needsAttention", "nodeIds"]);
  return Object.keys(query).filter((key) => !allowed.has(key));
}

function filterClaims(graph: CompiledGraph, query: Record<string, unknown> | undefined, section: AwgLensSection): unknown[] {
  const ids = new Set([...(section.nodeIds ?? []), ...stringArray(query?.ids), ...stringArray(query?.nodeIds)]);
  if (typeof query?.id === "string") ids.add(query.id);
  return (graph.claim_index?.claims ?? []).filter((claim) => {
    if (ids.size && !ids.has(claim.id)) return false;
    if (query?.verificationStatus && claim.verificationStatus !== String(query.verificationStatus)) return false;
    if (query?.claimKind && claim.claimKind !== String(query.claimKind)) return false;
    if (query?.status && claim.nodeStatus !== String(query.status)) return false;
    if (query?.sourceOfTruth && claim.sourceOfTruth !== String(query.sourceOfTruth)) return false;
    if (query?.needsAttention && !["unverified", "contradicted", "stale", "expired"].includes(claim.verificationStatus) && claim.nodeStatus !== "needs_review") return false;
    if (query?.tag) {
      const node = graph.nodes.find((item) => item.id === claim.id);
      if (!(node?.tags ?? []).includes(String(query.tag))) return false;
    }
    return matchesRecord(claim as unknown as Record<string, unknown>, query);
  });
}

function filterNodes(graph: CompiledGraph, query: Record<string, unknown> | undefined, section: AwgLensSection): AwgNode[] {
  const byId = new Set(section.nodeIds ?? stringArray(query?.ids));
  const nodes = byId.size ? graph.nodes.filter((node) => byId.has(node.id)) : graph.nodes;
  return nodes.filter((node) => matchesNode(node, query));
}

function filterEdges(graph: CompiledGraph, query: Record<string, unknown> | undefined, section: AwgLensSection): AwgEdge[] {
  const byId = new Set(section.edgeIds ?? stringArray(query?.ids));
  const edges = byId.size ? graph.edges.filter((edge) => byId.has(edge.id)) : graph.edges;
  return edges.filter((edge) => matchesRecord(edge as unknown as Record<string, unknown>, query));
}

function compactNode(node: AwgNode, section: AwgLensSection): Partial<AwgNode> {
  if (section.includeBody) return node;
  const { awg, kind, id, type, title, summary, status, importance, confidence, created_at, updated_at, tags, anchors } = node;
  return { awg, kind, id, type, title, summary, status, importance, confidence, created_at, updated_at, tags, anchors };
}

function matchesRun(runId: string, section: AwgLensSection, query?: Record<string, unknown>): boolean {
  const ids = new Set([...(section.runIds ?? []), ...stringArray(query?.ids)]);
  if (typeof query?.id === "string") ids.add(query.id);
  return ids.size === 0 || ids.has(runId);
}

function matchesNode(node: AwgNode, query?: Record<string, unknown>): boolean {
  if (!matchesRecord(node as unknown as Record<string, unknown>, query)) return false;
  if (query?.tag && !(node.tags ?? []).includes(String(query.tag))) return false;
  if (query?.tags && !stringArray(query.tags).some((tag) => (node.tags ?? []).includes(tag))) return false;
  if (query?.text || query?.q) {
    const text = String(query.text ?? query.q).toLowerCase();
    const haystack = [node.id, node.type, node.status, node.title, node.summary, ...(node.tags ?? [])].join(" ").toLowerCase();
    if (!haystack.includes(text)) return false;
  }
  return true;
}

function matchesRecord(record: Record<string, unknown>, query?: Record<string, unknown>): boolean {
  if (!query) return true;
  for (const [key, expected] of Object.entries(query)) {
    if (["limit", "sortBy", "text", "q", "tag", "tags", "ids"].includes(key)) continue;
    if (key === "types" && stringArray(expected).length && !stringArray(expected).includes(String(record.type))) return false;
    if (key === "statuses" && stringArray(expected).length && !stringArray(expected).includes(String(record.status))) return false;
    if (record[key] !== undefined && String(record[key]) !== String(expected)) return false;
  }
  return true;
}

function viewItems(graph: CompiledGraph, section: AwgLensSection): unknown[] {
  const id = section.viewId ?? (typeof section.query?.id === "string" ? section.query.id : undefined);
  if (!id) return graph.authored_views ?? [];
  return [...(graph.authored_views ?? []), ...graph.views].filter((view) => view.id === id);
}

function searchOptions(query: Record<string, unknown> | undefined, limit: number): { type?: string; status?: string; tag?: string; limit: number } {
  return { type: typeof query?.type === "string" ? query.type : undefined, status: typeof query?.status === "string" ? query.status : undefined, tag: typeof query?.tag === "string" ? query.tag : undefined, limit };
}

function resolveGoal(query: Record<string, unknown> | undefined, goal?: string): Record<string, unknown> | undefined {
  if (!query) return undefined;
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [key, value === "$goal" ? goal ?? "" : value]));
}

function boundedLimit(limit: unknown): number {
  return Number.isInteger(limit) ? Math.max(0, Math.min(MAX_LIMIT, Number(limit))) : 20;
}

function needsReview(lens: AwgLens): boolean {
  return lens.status === "needs_review" || Boolean(lens.review && ((lens.review as Record<string, unknown>).state === "needs_review" || (lens.review as Record<string, unknown>).humanApproved === false));
}

function selectorKey(lens: AwgLens): string {
  return lens.selector ? JSON.stringify(lens.selector, Object.keys(lens.selector).sort()) : "";
}

function legacySource(value: string): string {
  return SOURCE_SET.has(value) ? value : value === "important" || value === "active_tasks" ? "nodes" : "static";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function renderItem(item: unknown): string {
  const record = item as Record<string, unknown>;
  return [record.id, record.title, record.summary, record.status, record.code, record.message, record.text].filter(Boolean).join(" ");
}
