import { VIEW_BLOCK_TYPES } from "./blocks.js";
import type { AwgEdge, AwgNode, CurrentViewOutput, DiagnosticsReport, Diagnostic, CompiledGraph, ResumeLensOutput } from "./types.js";

export interface ViewerQuery {
  type?: string;
  types?: string[];
  status?: string;
  statuses?: string[];
  tag?: string;
  tags?: string[];
  importance_gte?: number;
  confidence_gte?: number;
  confidence_lte?: number;
  hasDiagnostics?: boolean;
  needsAttention?: boolean;
  open?: boolean;
  stale?: boolean;
  needsReview?: boolean;
  limit?: number;
  sortBy?: string;
}

export interface ViewerRouteFilters {
  [key: string]: string | number | boolean | undefined;
}

export const KANBAN_COLUMNS = [
  { id: "proposed", title: "Proposed", statuses: ["draft", "proposed"], hidden: false },
  { id: "active", title: "Active", statuses: ["active", "accepted"], hidden: false },
  { id: "in_progress", title: "In Progress", statuses: ["in_progress"], hidden: false },
  { id: "blocked", title: "Blocked", statuses: ["blocked"], hidden: false },
  { id: "needs_review", title: "Needs Review", statuses: ["needs_review", "stale"], hidden: false },
  { id: "done", title: "Done", statuses: ["completed", "resolved"], hidden: false },
  { id: "archived", title: "Archived", statuses: ["archived", "superseded", "rejected"], hidden: true }
] as const;

const ROUTES = ["overview", "graph", "kanban", "nodes", "health", "views", "settings"];
const DEFAULT_GRAPH_LIMIT = 80;
const DEFAULT_KANBAN_TYPES = new Set(["task", "decision", "risk", "question", "claim", "requirement", "artifact"]);
const CLOSED_STATUSES = new Set(["completed", "resolved", "rejected", "superseded", "archived"]);

export function nodeRoute(nodeId: string): string {
  return `#/node/${encodeURIComponent(nodeId)}`;
}

export function decodeNodeRouteId(encoded: string): string {
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

export function nodesRoute(filters: ViewerRouteFilters = {}): string {
  return routeWithFilters("nodes", filters);
}

export function graphRoute(focusNodeId?: string, filters: ViewerRouteFilters = {}): string {
  return routeWithFilters("graph", focusNodeId ? { ...filters, focus: focusNodeId } : filters);
}

export function healthRoute(filters: ViewerRouteFilters = {}): string {
  return routeWithFilters("health", filters);
}

export function kanbanRoute(filters: ViewerRouteFilters = {}): string {
  return routeWithFilters("kanban", filters);
}

export function queryNodes(nodes: AwgNode[], diagnostics: Diagnostic[], query: ViewerQuery = {}): AwgNode[] {
  const diagnosticsByNode = diagnosticsByNodeId(diagnostics);
  let result = nodes.filter((node) => {
    if (query.type && node.type !== query.type) return false;
    if (query.types?.length && !query.types.includes(node.type)) return false;
    if (query.status && node.status !== query.status) return false;
    if (query.statuses?.length && !query.statuses.includes(node.status)) return false;
    if (query.tag && !(node.tags ?? []).includes(query.tag)) return false;
    if (query.tags?.length && !query.tags.some((tag) => (node.tags ?? []).includes(tag))) return false;
    if (query.importance_gte !== undefined && node.importance < query.importance_gte) return false;
    if (query.confidence_gte !== undefined && node.confidence < query.confidence_gte) return false;
    if (query.confidence_lte !== undefined && node.confidence > query.confidence_lte) return false;
    if (query.hasDiagnostics && !(diagnosticsByNode.get(node.id)?.length)) return false;
    if (query.needsAttention && !["blocked", "needs_review", "stale"].includes(node.status)) return false;
    if (query.open && isClosedStatus(node.status)) return false;
    if (query.stale && node.status !== "stale" && !diagnosticsByNode.get(node.id)?.some((diag) => diag.code === "stale_node")) return false;
    if (query.needsReview && !["needs_review", "stale"].includes(node.status)) return false;
    return true;
  });
  result = sortNodes(result, query.sortBy, diagnosticsByNode);
  return query.limit ? result.slice(0, Math.max(0, query.limit)) : result;
}

function isClosedStatus(status: string): boolean {
  return CLOSED_STATUSES.has(status);
}

export function kanbanColumnsFor(nodes: AwgNode[], diagnostics: Diagnostic[] = [], includeArchived = false): Array<{ id: string; title: string; nodes: AwgNode[]; hidden: boolean }> {
  const workflowNodes = nodes.filter((node) => DEFAULT_KANBAN_TYPES.has(node.type));
  return KANBAN_COLUMNS.filter((column) => includeArchived || !column.hidden).map((column) => ({
    id: column.id,
    title: column.title,
    hidden: column.hidden,
    nodes: sortNodes(workflowNodes.filter((node) => (column.statuses as readonly string[]).includes(node.status)), "blockedFirst", diagnosticsByNodeId(diagnostics))
  }));
}

export function graphNeighborhood(graph: Pick<CompiledGraph, "nodes" | "edges">, focusNodeId: string | undefined, options: { depth?: number; types?: string[]; statuses?: string[]; rels?: string[]; includeArchived?: boolean; limit?: number } = {}): { focus?: AwgNode; nodes: AwgNode[]; edges: AwgEdge[]; capped: boolean; missingFocus: boolean } {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const visible = (node: AwgNode | undefined): node is AwgNode => {
    if (!node) return false;
    return (options.includeArchived || !["archived", "superseded"].includes(node.status)) && (!options.types?.length || options.types.includes(node.type)) && (!options.statuses?.length || options.statuses.includes(node.status));
  };
  const requested = focusNodeId ? byId.get(focusNodeId) : undefined;
  if (focusNodeId && !requested) return { focus: undefined, nodes: [], edges: [], capped: false, missingFocus: true };
  const fallback = graph.nodes.find(visible);
  const focus = visible(requested) ? requested : fallback;
  if (!focus) return { focus: undefined, nodes: [], edges: [], capped: false, missingFocus: Boolean(focusNodeId) };
  const maxDepth = Math.max(1, Math.min(3, options.depth ?? 1));
  const limit = options.limit ?? DEFAULT_GRAPH_LIMIT;
  const selected = new Map<string, number>([[focus.id, 0]]);
  const queue = [focus.id];
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    const depth = selected.get(id) ?? 0;
    if (depth >= maxDepth) continue;
    for (const edge of graph.edges) {
      if (options.rels?.length && !options.rels.includes(edge.rel)) continue;
      if (edge.from !== id && edge.to !== id) continue;
      const nextId = edge.from === id ? edge.to : edge.from;
      if (selected.has(nextId)) continue;
      const next = byId.get(nextId);
      if (!visible(next)) continue;
      selected.set(nextId, depth + 1);
      queue.push(nextId);
      if (selected.size >= limit) break;
    }
    if (selected.size >= limit) break;
  }
  const nodeSet = new Set(selected.keys());
  const nodes = [...selected.keys()].map((id) => byId.get(id)).filter((node): node is AwgNode => Boolean(node)).sort((a, b) => (selected.get(a.id) ?? 0) - (selected.get(b.id) ?? 0) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const edges = graph.edges.filter((edge) => nodeSet.has(edge.from) && nodeSet.has(edge.to) && (!options.rels?.length || options.rels.includes(edge.rel))).sort((a, b) => a.id.localeCompare(b.id));
  return { focus, nodes, edges, capped: selected.size >= limit, missingFocus: false };
}

export function unsupportedBlockFallback(block: unknown): string {
  const type = block && typeof block === "object" && "type" in block ? String((block as { type?: unknown }).type) : "unknown";
  return `Unsupported block type: ${type}`;
}

export function renderStaticSite(graph: CompiledGraph, view: CurrentViewOutput, diagnostics: DiagnosticsReport, resumeLens?: ResumeLensOutput): { html: string; js: string; css: string } {
  const data = JSON.stringify({ graph, view, diagnostics, resumeLens: resumeLens ?? null }).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AWG Surface</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <div id="app" class="awg-app">
    <aside class="sidebar">
      <a class="brand" href="#/overview"><span>AWG</span><small>Human Surface</small></a>
      <nav id="nav" aria-label="Viewer routes"></nav>
      <div class="sidebar-footer">
        <label class="field-label" for="theme-select">Theme</label>
        <select id="theme-select"></select>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <div>
          <p class="eyebrow">Agent Work Graph</p>
          <h1 id="route-title">Overview</h1>
        </div>
        <div id="top-summary" class="top-summary"></div>
      </header>
      <section id="route-root" class="route-root" aria-live="polite"></section>
    </main>
  </div>
  <script>window.AWG_DATA = ${data};</script>
  <script src="./app.js"></script>
</body>
</html>
`;
  return { html, js: viewerJs(), css: viewerCss() };
}

function routeWithFilters(route: string, filters: ViewerRouteFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  return `#/${route}${params.size ? `?${params.toString()}` : ""}`;
}

function diagnosticsByNodeId(diagnostics: Diagnostic[]): Map<string, Diagnostic[]> {
  const byNode = new Map<string, Diagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (!diagnostic.id) continue;
    const list = byNode.get(diagnostic.id) ?? [];
    list.push(diagnostic);
    byNode.set(diagnostic.id, list);
  }
  return byNode;
}

function sortNodes(nodes: AwgNode[], sortBy = "importance", diagnosticsByNode = new Map<string, Diagnostic[]>()): AwgNode[] {
  const severityRank = (node: AwgNode) => Math.max(0, ...(diagnosticsByNode.get(node.id) ?? []).map((diag) => diag.severity === "fatal" ? 3 : diag.severity === "warning" ? 2 : 1));
  const updated = (node: AwgNode) => Date.parse(node.updated_at || node.created_at || "") || 0;
  return [...nodes].sort((a, b) => {
    if (sortBy === "updated") return updated(b) - updated(a) || a.title.localeCompare(b.title);
    if (sortBy === "created") return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || a.title.localeCompare(b.title);
    if (sortBy === "confidence") return b.confidence - a.confidence || a.title.localeCompare(b.title);
    if (sortBy === "title") return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    if (sortBy === "type") return a.type.localeCompare(b.type) || a.title.localeCompare(b.title);
    if (sortBy === "status") return a.status.localeCompare(b.status) || a.title.localeCompare(b.title);
    if (sortBy === "diagnosticSeverity") return severityRank(b) - severityRank(a) || a.title.localeCompare(b.title);
    if (sortBy === "staleFirst") return Number(b.status === "stale") - Number(a.status === "stale") || updated(a) - updated(b);
    if (sortBy === "blockedFirst") return Number(b.status === "blocked") - Number(a.status === "blocked") || b.importance - a.importance || a.title.localeCompare(b.title);
    return b.importance - a.importance || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}

function viewerJs(): string {
  return `"use strict";
const data = window.AWG_DATA || {};
const graph = data.graph || { nodes: [], edges: [], views: [], lenses: [], events: [], responses: [], policies: [] };
const view = data.view || { blocks: [] };
const diagnostics = data.diagnostics || graph.diagnostics || { summary: {}, diagnostics: [] };
const resumeLens = data.resumeLens;
const byId = new Map(graph.nodes.map((node) => [node.id, node]));
const diagnosticsByNode = groupDiagnostics(diagnostics.diagnostics || []);
const topology = graph.topology || data.topology || { directNeighbors: [], relationships: [], diagnostics: [] };
const workQueues = graph.work_queue_index || { queues: [], items: [], summary: { total: 0, byQueue: {}, bySeverity: {}, autonomousSafe: 0, needsHumanReview: 0, blocked: 0, highPriority: 0 } };
const coordination = graph.coordination_index || { claims: [], collisions: [], handoffs: [], summary: { activeClaims: 0, staleClaims: 0, collisions: 0, handoffs: 0, claimedQueueItems: 0, claimedNodes: 0 } };
const routes = [
  ["overview", "Overview"],
  ["queues", "Queues"],
  ["coordination", "Coordination"],
  ["topology", "Topology"],
  ["maintenance", "Maintenance"],
  ["graph", "Graph"],
  ["kanban", "Kanban"],
  ["nodes", "Nodes"],
  ["runs", "Runs"],
  ["health", "Health"],
  ["views", "Views"],
  ["settings", "Settings"]
];
const themes = [
  ["system", "System"],
  ["light", "AWG Light"],
  ["dark", "AWG Dark"]
];
const settings = loadSettings();
const blockRenderers = {
  brief: renderBriefBlock,
  summary: renderSummaryBlock,
  "metric-row": renderStatsGridBlock,
  callout: renderCalloutBlock,
  table: renderTableBlock,
  checklist: renderChecklistBlock,
  timeline: renderTimelineBlock,
  "current-effort": renderCurrentEffortBlock,
  "stats-grid": renderStatsGridBlock,
  "attention-list": renderNodeListBlock,
  "attention-required": renderNodeListBlock,
  "node-list": renderNodeListBlock,
  "task-queue": renderNodeListBlock,
  "risk-list": renderNodeListBlock,
  "decision-list": renderNodeListBlock,
  "node-table": renderNodeTableBlock,
  "decision-review": renderNodeListBlock,
  "task-review": renderNodeListBlock,
  "risk-review": renderNodeListBlock,
  "question-review": renderNodeListBlock,
  "evidence-list": renderEvidenceListBlock,
  "diagnostic-list": renderDiagnosticListBlock,
  diagnostics: renderDiagnosticListBlock,
  "kanban-board": renderKanbanBlock,
  "graph-neighborhood": renderGraphBlock,
  "run-summary": renderRunSummaryBlock,
  "raw-json": renderRawJsonBlock
};
const authoredViewBlockTypes = new Set(${JSON.stringify([...VIEW_BLOCK_TYPES])});
const nodeBlockRenderers = {
  brief: renderBriefBlock,
  callout: renderCalloutBlock,
  "metric-row": renderStatsGridBlock,
  table: renderTableBlock,
  checklist: renderChecklistBlock,
  "node-list": renderNodeListBlock,
  timeline: renderTimelineBlock
};
initShell();
window.addEventListener("hashchange", renderRoute);
renderRoute();

function initShell() {
  applyTheme(settings.theme || "system");
  document.getElementById("nav").innerHTML = routes.map(([id, label]) => '<a data-route="' + id + '" href="#/' + id + '">' + label + '</a>').join("");
  const select = document.getElementById("theme-select");
  select.innerHTML = themes.map(([value, label]) => '<option value="' + value + '">' + label + '</option>').join("");
  select.value = settings.theme || "system";
  select.addEventListener("change", () => updateSetting("theme", select.value));
}

function renderRoute() {
  const parsed = parseHash();
  const root = document.getElementById("route-root");
  const routeTitle = document.getElementById("route-title");
  document.querySelectorAll("[data-route]").forEach((link) => link.classList.toggle("active", link.dataset.route === parsed.route));
  document.getElementById("top-summary").innerHTML = renderTopSummary();
  const title = parsed.route === "node" ? "Node Detail" : labelForRoute(parsed.route);
  routeTitle.textContent = title;
  if (parsed.route === "overview") root.innerHTML = renderOverview();
  else if (parsed.route === "queues") root.innerHTML = renderQueuesRoute(parsed.params);
  else if (parsed.route === "coordination") root.innerHTML = renderCoordinationRoute();
  else if (parsed.route === "graph") root.innerHTML = renderGraphRoute(parsed.params);
  else if (parsed.route === "kanban") root.innerHTML = renderKanbanRoute(parsed.params);
  else if (parsed.route === "nodes") root.innerHTML = renderNodesRoute(parsed.params);
  else if (parsed.route === "topology") root.innerHTML = renderTopologyRoute();
  else if (parsed.route === "maintenance") root.innerHTML = renderMaintenanceRoute(parsed.params);
  else if (parsed.route === "runs") root.innerHTML = renderRunsRoute();
  else if (parsed.route === "health") root.innerHTML = renderHealthRoute(parsed.params);
  else if (parsed.route === "views") root.innerHTML = renderViewsRoute(parsed);
  else if (parsed.route === "node") root.innerHTML = renderNodeDetail(safeDecodeURIComponent(parsed.parts[1] || ""));
  else if (parsed.route === "settings") root.innerHTML = renderSettingsRoute();
  else root.innerHTML = renderOverview();
  wireRouteControls(root, parsed.route);
  syncReviewColumns(root);
}

function parseHash() {
  const raw = (location.hash || "#/overview").slice(2);
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  const route = parts[0] || "overview";
  return { route, parts, params: Object.fromEntries(new URLSearchParams(query)) };
}

function labelForRoute(route) {
  const found = routes.find(([id]) => id === route);
  return found ? found[1] : "Overview";
}

function renderTopSummary() {
  const s = diagnostics.summary || {};
  const needsAttention = graph.nodes.filter((node) => ["blocked", "needs_review", "stale"].includes(node.status)).length;
  const activeWork = graph.nodes.filter((node) => ["task", "risk", "requirement", "artifact"].includes(node.type) && ["active", "accepted", "in_progress", "blocked", "needs_review", "stale"].includes(node.status)).length;
  const openDecisions = graph.nodes.filter((node) => node.type === "decision" && !isClosedStatus(node.status)).length;
  const openQuestions = graph.nodes.filter((node) => node.type === "question" && !isClosedStatus(node.status)).length;
  const healthValue = (s.fatal_error_count || 0) > 0 ? String(s.fatal_error_count) : (s.warning_count || 0) > 0 ? String(s.warning_count) : "OK";
  const healthLabel = (s.fatal_error_count || 0) > 0 ? "Errors" : (s.warning_count || 0) > 0 ? "Warnings" : "Health";
  return [
    metric("Queue Items", (workQueues.summary || {}).total || 0, "#/queues"),
    metric("Claims", (coordination.summary || {}).activeClaims || 0, "#/coordination"),
    metric("Needs Attention", needsAttention, needsAttention ? "#/nodes?needsAttention=true" : "#/health"),
    metric("Active Work", activeWork, "#/kanban"),
    metric("Open Decisions", openDecisions, "#/nodes?type=decision&open=true"),
    metric("Open Questions", openQuestions, "#/nodes?type=question&open=true"),
    metric(healthLabel, healthValue, "#/health")
  ].join("");
}

function renderQueuesRoute(params) {
  let items = workQueues.items || [];
  if (params.queue) items = items.filter((item) => item.queue === params.queue);
  if (params.autonomous === "true") items = items.filter((item) => item.autonomousSafe);
  if (params.humanReview === "true") items = items.filter((item) => item.needsHumanReview);
  const queueIds = unique((workQueues.queues || []).map((queue) => queue.id));
  const stats = [
    metric("Total", (workQueues.summary || {}).total || 0, "#/queues"),
    metric("High Priority", (workQueues.summary || {}).highPriority || 0, "#/queues"),
    metric("Autonomous", (workQueues.summary || {}).autonomousSafe || 0, "#/queues?autonomous=true"),
    metric("Human Review", (workQueues.summary || {}).needsHumanReview || 0, "#/queues?humanReview=true"),
    metric("Blocked", (workQueues.summary || {}).blocked || 0, "#/queues?queue=blocked")
  ].join("");
  const filters = '<div class="filters"><select data-control="queue-id"><option value="">All queues</option>' + optionList(queueIds, params.queue) + '</select></div>';
  const queueSummary = (workQueues.queues || []).length ? '<section class="panel span-2"><h2>Queue Summary</h2><div class="metric-row">' + (workQueues.queues || []).map((queue) => metric(queue.title || queue.id, queue.count || 0, "#/queues?queue=" + encodeURIComponent(queue.id))).join("") + '</div></section>' : "";
  const rows = items.length ? '<div class="card-list">' + items.slice(0, 100).map(renderQueueItemCard).join("") + '</div>' : '<div class="empty"><h2>No queue items</h2><p>The derived work queue is empty for this filter.</p></div>';
  return '<section class="health-surface"><div class="health-kpis">' + stats + '</div><div class="health-body">' + filters + queueSummary + rows + '</div></section>';
}

function renderQueueItemCard(item) {
  const nodes = (item.nodeIds || []).slice(0, 8).map((id) => nodeLink(id)).join(" ");
  const runs = (item.runIds || []).slice(0, 6).map((id) => '<a class="badge type" href="#/runs">' + esc(id) + '</a>').join(" ");
  const inbox = (item.inboxItemIds || []).slice(0, 6).map((id) => '<a class="badge type" href="#/maintenance">' + esc(id) + '</a>').join(" ");
  const claims = (item.claimIds || []).slice(0, 6).map((id) => byId.has(id) ? nodeLink(id) : '<code>' + esc(id) + '</code>').join(" ");
  const evidence = (item.evidenceIds || []).slice(0, 6).map((id) => byId.has(id) ? nodeLink(id) : '<code>' + esc(id) + '</code>').join(" ");
  const coordinationLinks = item.coordination && (item.coordination.activeClaimIds || []).length ? '<h3>Coordination</h3><div class="chip-row">' + item.coordination.activeClaimIds.slice(0, 6).map((id) => '<a class="badge status" href="#/coordination">' + esc(id) + '</a>').join(" ") + '</div>' : "";
  const links = [nodes && '<h3>Nodes</h3><div class="chip-row">' + nodes + '</div>', runs && '<h3>Runs</h3><div class="chip-row">' + runs + '</div>', inbox && '<h3>Inbox</h3><div class="chip-row">' + inbox + '</div>', claims && '<h3>Claims</h3><div class="chip-row">' + claims + '</div>', evidence && '<h3>Evidence</h3><div class="chip-row">' + evidence + '</div>', coordinationLinks].filter(Boolean).join("");
  const commands = (item.suggestedCommands || []).length ? '<h3>Suggested commands</h3><ul>' + item.suggestedCommands.slice(0, 3).map((command) => '<li><code>' + esc(command) + '</code></li>').join("") + '</ul>' : "";
  const reasons = (item.reasons || []).length ? '<h3>Reasons</h3><ul>' + item.reasons.slice(0, 4).map((reason) => '<li>' + esc(reason) + '</li>').join("") + '</ul>' : "";
  return '<article class="node-card severity-' + esc(item.severity || "info") + '"><div class="chip-row">' + badge(item.queue || "queue", "type") + badge(item.severity || "info", "severity") + (item.autonomousSafe ? badge("autonomous", "status") : "") + (item.needsHumanReview ? badge("human review", "status") : "") + '<code>' + esc(item.id || "") + '</code></div><h2>' + esc(item.title || item.summary || "Queue item") + '</h2><p>' + esc(item.summary || "") + '</p><p class="muted">priority ' + esc(String(item.priority || 0)) + '</p>' + links + reasons + commands + '</article>';
}

function renderCoordinationRoute() {
  const stats = [
    metric("Active Claims", (coordination.summary || {}).activeClaims || 0, "#/coordination"),
    metric("Stale Claims", (coordination.summary || {}).staleClaims || 0, "#/coordination"),
    metric("Collisions", (coordination.summary || {}).collisions || 0, "#/coordination"),
    metric("Handoffs", (coordination.summary || {}).handoffs || 0, "#/coordination"),
    metric("Claimed Nodes", (coordination.summary || {}).claimedNodes || 0, "#/coordination")
  ].join("");
  const claims = (coordination.claims || []).length ? '<section class="panel span-2"><h2>Claims</h2><div class="card-list">' + coordination.claims.map(renderCoordinationClaim).join("") + '</div></section>' : '<section class="panel"><h2>No coordination claims</h2><p class="muted">Claims are advisory and append-only.</p></section>';
  const collisions = (coordination.collisions || []).length ? '<section class="panel"><h2>Collisions</h2>' + coordination.collisions.map((item) => '<article class="node-card severity-warning"><div class="chip-row">' + badge(item.severity || "warning", "severity") + '<code>' + esc(item.id) + '</code></div><p>' + esc(item.message || "") + '</p><div class="chip-row">' + (item.claimIds || []).map((id) => '<span class="badge status">' + esc(id) + '</span>').join("") + '</div></article>').join("") + '</section>' : "";
  const handoffs = (coordination.handoffs || []).length ? '<section class="panel"><h2>Handoffs</h2>' + coordination.handoffs.map((item) => '<article class="node-card"><div class="chip-row"><code>' + esc(item.id) + '</code>' + badge(item.toRole || item.toAgent || "handoff", "type") + '</div><p>' + esc(item.summary || "") + '</p></article>').join("") + '</section>' : "";
  return '<section class="health-surface"><div class="health-kpis">' + stats + '</div><div class="health-body surface-grid">' + claims + collisions + handoffs + '</div></section>';
}

function renderCoordinationClaim(claim) {
  const targets = (claim.nodeIds || claim.targetIds || []).slice(0, 8).map((id) => byId.has(id) ? nodeLink(id) : '<code>' + esc(id) + '</code>').join(" ");
  const collisions = (claim.collisionIds || []).length ? '<p class="muted">collisions: ' + claim.collisionIds.map((id) => '<code>' + esc(id) + '</code>').join(" ") + '</p>' : "";
  const commands = (claim.suggestedCommands || []).length ? '<h3>Suggested commands</h3><ul>' + claim.suggestedCommands.slice(0, 3).map((command) => '<li><code>' + esc(command) + '</code></li>').join("") + '</ul>' : "";
  return '<article class="node-card"><div class="chip-row">' + badge(claim.status || "active", "status") + badge(claim.mode || "exclusive", "type") + '<code>' + esc(claim.id || "") + '</code></div><h2>' + esc(claim.summary || claim.id || "Coordination claim") + '</h2><p>' + esc(claim.reason || "") + '</p>' + (targets ? '<h3>Targets</h3><div class="chip-row">' + targets + '</div>' : "") + (claim.runId ? '<p class="muted">run: <code>' + esc(claim.runId) + '</code></p>' : "") + collisions + commands + '</article>';
}

function renderOverview() {
  if (!graph.nodes.length) return '<div class="empty"><h2>No graph yet</h2><p>Add AWG nodes, run <code>awg build</code>, then reopen the viewer.</p></div>';
  const blocks = buildOverviewBlocks();
  return '<div class="surface-grid">' + blocks.map(renderBlock).join("") + '</div>';
}

function renderTopologyRoute() {
  const current = topology.currentVault;
  const neighbors = topology.directNeighbors || [];
  const rels = topology.relationships || [];
  const header = current ? '<section class="panel"><h2>' + esc(current.name || "Current vault") + '</h2><p><code>' + esc(current.id || "") + '</code></p><p class="muted">' + esc(current.path || "") + '</p></section>' : '<section class="panel"><h2>No registered current vault</h2><p class="muted">Run <code>awg register</code> in this project.</p></section>';
  const neighborCards = neighbors.length ? neighbors.map((vault) => '<section class="panel"><div class="chip-row">' + badge(vault.stale ? "stale/missing" : "ok", "status") + badge(vault.scope || "project", "type") + '</div><h2>' + esc(vault.name || vault.id) + '</h2><p><code>' + esc(vault.id || "") + '</code></p><p class="muted">' + esc(vault.path || "") + '</p><p>' + esc(vault.summary?.text || "") + '</p><h3>Why surfaced</h3><div class="chip-row">' + (vault.whySurfaced || []).map((why) => '<span class="badge type">' + esc(why) + '</span>').join("") + '</div></section>').join("") : '<section class="panel"><h2>No direct neighbors</h2><p class="muted">Create explicit links with <code>awg vault link</code>.</p></section>';
  const relationshipRows = rels.length ? '<section class="panel span-2"><h2>Relationships</h2><table><thead><tr><th>ID</th><th>Relationship</th><th>Direction</th><th>Summary</th></tr></thead><tbody>' + rels.map((rel) => '<tr><td><code>' + esc(rel.id) + '</code></td><td>' + esc(rel.rel || "") + '</td><td>' + esc(rel.direction || "") + '</td><td>' + esc(rel.summary || "") + '</td></tr>').join("") + '</tbody></table></section>' : "";
  const diagRows = (topology.diagnostics || []).length ? '<section class="panel span-2"><h2>Topology Health</h2>' + renderDiagnostics(topology.diagnostics || []) + '</section>' : "";
  return '<div class="surface-grid">' + header + neighborCards + relationshipRows + diagRows + '</div>';
}

function renderMaintenanceRoute(params) {
  const inbox = graph.maintenance_inbox || { items: [], summary: { total: 0, byKind: {}, bySeverity: {}, highPriority: 0 } };
  let items = inbox.items || [];
  if (params.kind) items = items.filter((item) => item.kind === params.kind);
  if (params.severity) items = items.filter((item) => item.severity === params.severity);
  const kinds = unique((inbox.items || []).map((item) => item.kind));
  const severities = unique((inbox.items || []).map((item) => item.severity));
  const summary = inbox.summary || {};
  const stats = [
    metric("Inbox Items", summary.total || 0, "#/maintenance"),
    metric("High Priority", summary.highPriority || 0, "#/maintenance"),
    metric("Errors", (summary.bySeverity || {}).error || 0, "#/maintenance?severity=error"),
    metric("Warnings", (summary.bySeverity || {}).warning || 0, "#/maintenance?severity=warning")
  ].join("");
  const filters = '<div class="filters"><select data-control="maintenance-kind"><option value="">All kinds</option>' + optionList(kinds, params.kind) + '</select><select data-control="maintenance-severity"><option value="">All severities</option>' + optionList(severities, params.severity) + '</select></div>';
  const rows = items.length ? '<div class="card-list">' + items.map((item) => {
    const reasons = (item.reasons || []).length ? '<h3>Reasons</h3><ul>' + item.reasons.map((reason) => '<li>' + esc(reason) + '</li>').join("") + '</ul>' : "";
    const commands = (item.suggestedCommands || []).length ? '<h3>Suggested commands</h3><ul>' + item.suggestedCommands.map((command) => '<li><code>' + esc(command) + '</code></li>').join("") + '</ul>' : "";
    return '<article class="node-card severity-' + esc(item.severity) + '"><div class="chip-row">' + badge(item.severity, "severity") + badge(item.kind, "type") + '<code>' + esc(item.id) + '</code></div><h2>' + esc(item.message) + '</h2><p><code>' + esc(item.code) + '</code> priority ' + esc(String(item.priority)) + '</p>' + (item.nodeIds || []).map((id) => nodeLink(id)).join(" ") + reasons + commands + '</article>';
  }).join("") + '</div>' : '<div class="empty"><h2>No maintenance items</h2><p>The derived inbox is empty for this filter.</p></div>';
  return '<section class="health-surface"><div class="health-kpis">' + stats + '</div><div class="health-body">' + filters + rows + '</div></section>';
}

function buildOverviewBlocks() {
  const currentBlocks = Array.isArray(view.blocks) ? view.blocks.filter((block) => block && !["node-list", "summary", "diagnostics", "diagnostic-list"].includes(block.type)) : [];
  if (currentBlocks.length) {
    return [
      { type: "current-effort", title: "Current Effort" },
      { type: "attention-list", title: "Current Focus", items: resumeLens?.important || queryNodes({ limit: 6, sortBy: "importance" }) },
      ...currentBlocks.map(normalizeOverviewBlock),
      { type: "node-list", title: "Recently Completed", items: queryNodes({ statuses: ["completed", "resolved"], limit: 8, sortBy: "updated" }) }
    ];
  }
  const blocks = [
    { type: "current-effort", title: "Current Effort" },
    { type: "attention-list", title: "Current Focus", items: resumeLens?.important || queryNodes({ limit: 6, sortBy: "importance" }) },
    { type: "attention-list", title: "Needs Attention", items: queryNodes({ statuses: ["blocked", "needs_review", "stale"], limit: 8, sortBy: "blockedFirst" }) },
    { type: "attention-list", title: "Agent-Surfaced Priorities", items: (resumeLens?.active_tasks || []).concat(resumeLens?.active_risks || []).slice(0, 8) },
    { type: "question-review", title: "Open Questions", items: resumeLens?.unanswered_questions || queryNodes({ type: "question", limit: 8 }) },
    { type: "decision-review", title: "Open Decisions", items: resumeLens?.open_decisions || queryNodes({ type: "decision", limit: 8 }) },
    { type: "risk-review", title: "Active Risks & Blockers", items: queryNodes({ types: ["risk", "task"], statuses: ["active", "blocked"], limit: 8, sortBy: "blockedFirst" }) },
    { type: "node-list", title: "Recently Completed", items: queryNodes({ statuses: ["completed", "resolved"], limit: 8, sortBy: "updated" }) }
  ];
  return blocks;
}

function normalizeOverviewBlock(block) {
  if (block.type === "attention-required") return { ...block, type: "attention-list", title: block.title || "Needs Attention" };
  return block;
}

function renderGraphRoute(params) {
  const depth = clamp(Number(params.depth || settings.graphDepth || 1), 1, 3);
  const graphOptions = { depth, rels: params.rel ? [params.rel] : undefined, types: params.type ? [params.type] : undefined, statuses: params.status ? [params.status] : undefined };
  const focus = params.focus || firstGraphFocus(graphOptions);
  const neighborhood = graphNeighborhood(focus, graphOptions);
  if (neighborhood.missingFocus) return '<section class="graph-surface"><div class="graph-toolbar"><p class="muted">The requested focus node is not in this graph.</p></div><div class="graph-main"><div class="empty"><h2>Missing focus node</h2><p>No node found for <code>' + esc(params.focus || "") + '</code>.</p><p><a class="button" href="#/graph">Open graph overview</a></p></div></div></section>';
  const options = graph.nodes.map((node) => '<option value="' + esc(node.id) + '"' + (node.id === neighborhood.focus?.id ? " selected" : "") + '>' + esc(node.title) + '</option>').join("");
  const types = unique(graph.nodes.map((node) => node.type));
  const statuses = unique(graph.nodes.map((node) => node.status).filter((status) => !["archived", "superseded"].includes(status)));
  const rels = unique(graph.edges.map((edge) => edge.rel));
  return '<section class="graph-surface"><div class="graph-toolbar"><label>Node<select data-control="graph-focus">' + options + '</select></label><label>Depth<select data-control="graph-depth"><option' + selected(depth, 1) + '>1</option><option' + selected(depth, 2) + '>2</option><option' + selected(depth, 3) + '>3</option></select></label><label>Relationship<select data-control="graph-rel"><option value="">All relationships</option>' + optionList(rels, params.rel) + '</select></label><label>Type<select data-control="graph-type"><option value="">All types</option>' + optionList(types, params.type) + '</select></label><label>Status<select data-control="graph-status"><option value="">All statuses</option>' + optionList(statuses, params.status) + '</select></label></div><div class="graph-main">' + renderGraphBlock({ title: "Neighborhood", focus: neighborhood.focus?.id, depth, rels: params.rel ? [params.rel] : undefined, types: params.type ? [params.type] : undefined, statuses: params.status ? [params.status] : undefined }) + '</div><footer class="graph-footer">' + (neighborhood.focus ? renderGraphFooterNode(neighborhood.focus) : '<p class="muted">No nodes match these graph filters.</p>') + '</footer></section>';
}

function renderKanbanRoute(params) {
  const includeArchived = params.archived === "true";
  const columns = kanbanColumns(includeArchived);
  return '<div class="toolbar"><a class="button" href="#/kanban?archived=' + String(!includeArchived) + '">' + (includeArchived ? "Hide archived" : "Show archived") + '</a></div>' + renderKanbanColumns(columns);
}

function renderNodesRoute(params) {
  const query = {
    type: params.type,
    status: params.status,
    statuses: params.statuses ? String(params.statuses).split(",").filter(Boolean) : undefined,
    tag: params.tag,
    hasDiagnostics: params.diagnostics === "true",
    needsAttention: params.needsAttention === "true",
    open: params.open === "true",
    stale: params.stale === "true",
    needsReview: params.needsReview === "true",
    sortBy: params.sortBy || "importance"
  };
  let nodes = queryNodes(query);
  const search = (params.q || "").toLowerCase();
  if (search) nodes = nodes.filter((node) => [node.id, node.title, node.summary, node.type, node.status, ...(node.tags || [])].join(" ").toLowerCase().includes(search));
  const types = unique(graph.nodes.map((node) => node.type));
  const statuses = unique(graph.nodes.map((node) => node.status));
  const tags = unique(graph.nodes.flatMap((node) => node.tags || []));
  return '<section class="panel"><div class="filters"><input data-control="nodes-q" value="' + esc(params.q || "") + '" placeholder="Search nodes"><select data-control="nodes-type"><option value="">All types</option>' + optionList(types, params.type) + '</select><select data-control="nodes-status"><option value="">All statuses</option>' + optionList(statuses, params.status) + '</select><select data-control="nodes-tag"><option value="">All tags</option>' + optionList(tags, params.tag) + '</select><select data-control="nodes-sort">' + optionList(["importance", "updated", "created", "confidence", "title", "type", "status", "diagnosticSeverity"], params.sortBy || "importance") + '</select></div>' + renderNodeTable(nodes) + '</section>';
}

function renderHealthRoute(params) {
  const severity = params.severity;
  const code = params.code;
  const id = params.id;
  let items = diagnostics.diagnostics || [];
  if (severity) items = items.filter((diag) => diag.severity === severity);
  if (code) items = items.filter((diag) => diag.code === code);
  if (id) items = items.filter((diag) => diag.id === id);
  const summary = diagnostics.summary || {};
  const stats = [
    metric("Errors", summary.fatal_error_count || 0, "#/health?severity=fatal"),
    metric("Warnings", summary.warning_count || 0, "#/health?severity=warning"),
    metric("Stale", summary.stale_node_count || 0, "#/nodes?stale=true"),
    metric("Orphans", summary.orphan_node_count || 0, "#/health?code=orphan_node"),
    metric("Open Questions", summary.unanswered_question_count || 0, "#/nodes?type=question")
  ].join("");
  return '<section class="health-surface"><div class="health-kpis">' + stats + '</div><div class="health-body">' + renderDiagnostics(items) + '</div></section>';
}

function renderRunsRoute() {
  const runs = deriveRuns();
  const summaries = new Map((graph.run_summaries || []).map((summary) => [summary.runId, summary]));
  if (!runs.length) return '<section class="panel"><h2>Runs</h2><p class="muted">No runs recorded.</p></section>';
  return '<div class="surface-grid">' + runs.map((run) => {
    const summary = summaries.get(run.id) || {};
    const notes = (run.notes || []).slice(-3).reverse();
    const warningCount = (summary.diagnostics || []).filter((diag) => diag.severity === "warning" || diag.severity === "fatal").length;
    return '<section class="panel"><div class="chip-row">' + badge(run.status || "unknown", "status") + '<code>' + esc(run.id) + '</code></div><h2>' + esc(run.goal || "Untitled run") + '</h2>' + (run.summary ? '<p>' + esc(run.summary) + '</p>' : "") + '<div class="metric-row">' + metric("Created", (summary.createdNodeIds || []).length, "#/nodes") + metric("Touched", (summary.touchedNodeIds || []).length, "#/nodes") + metric("Evidence", (summary.evidenceNodeIds || []).length, "#/nodes?type=evidence") + metric("Warnings", warningCount, "#/health") + '</div>' + renderRunNodeLinks("Created nodes", summary.createdNodeIds || []) + renderRunNodeLinks("Touched nodes", summary.touchedNodeIds || []) + renderRunNodeLinks("Evidence targets", summary.evidenceTargetIds || []) + (notes.length ? '<h3>Notes</h3><div class="activity-table">' + notes.map((note) => '<article class="activity-row"><time title="' + esc(humanDate(note.at)) + '">' + esc(relativeTime(note.at)) + '</time><strong>note</strong><span>' + esc(note.summary || "") + '</span><em>' + esc(note.by || "") + '</em></article>').join("") + '</div>' : "") + '</section>';
  }).join("") + '</div>';
}

function renderRunNodeLinks(title, ids) {
  const kept = ids.slice(0, 8);
  if (!kept.length) return "";
  return '<h3>' + esc(title) + '</h3><div class="chip-row">' + kept.map((id) => byId.has(id) ? '<a class="badge type" href="#/node/' + encodeURIComponent(id) + '">' + esc(id) + '</a>' : '<code>' + esc(id) + '</code>').join("") + (ids.length > kept.length ? '<span class="muted">+' + (ids.length - kept.length) + ' more</span>' : "") + '</div>';
}

function deriveRuns() {
  const runs = new Map();
  for (const event of graph.events || []) {
    if (event.type === "run_started") runs.set(event.target, { id: event.target, goal: event.goal || "", agent: event.agent, status: "in_progress", started_at: event.at, updated_at: event.at, notes: [], handoffs: [] });
  }
  for (const event of graph.events || []) {
    const runId = event.run || event.runId || (String(event.target || "").startsWith("run:") ? event.target : "");
    const run = runs.get(runId);
    if (!run) continue;
    if (event.at && (!run.updated_at || event.at > run.updated_at)) run.updated_at = event.at;
    if (event.type === "run_note") run.notes.push({ at: event.at, by: event.by, summary: event.summary });
    if (event.type === "run_finished") {
      run.status = event.status || "partial";
      run.finished_at = event.at;
      run.summary = event.summary;
    }
    if (event.type === "handoff_generated") run.handoffs.push(event.id || event.at);
  }
  return [...runs.values()].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")) || String(a.id).localeCompare(String(b.id)));
}

function renderViewsRoute(parsed) {
  const generated = [
    { id: "v:current", title: "Current View", summary: "Generated current review surface.", blocks: view.blocks || [], generated: true },
    resumeLens ? { id: resumeLens.id, title: resumeLens.title || "Resume Lens", blocks: [{ type: "brief", title: "Summary", summary: resumeLens.summary }, { type: "node-list", title: "Important", items: resumeLens.important || [] }] } : null,
    ...(graph.authored_views || graph.views || []).map((item) => ({ ...item, authored: true }))
  ].filter(Boolean);
  const selectedId = parsed.parts[1] ? safeDecodeURIComponent(parsed.parts[1]) : "";
  const selected = selectedId ? generated.find((item) => item.id === selectedId) : undefined;
  if (selectedId && !selected) return '<section class="panel"><h2>Missing view</h2><p>No authored view exists for <code>' + esc(selectedId) + '</code>.</p><p><a class="button" href="#/views">Browse views</a></p></section>';
  if (selected) return '<article class="surface view-detail"><header class="node-hero"><div><div class="chip-row">' + badge(selected.audience || "human", "type") + '<code>' + esc(selected.id) + '</code></div><h2>' + esc(selected.title) + '</h2>' + (selected.summary ? '<p class="muted">' + esc(selected.summary) + '</p>' : "") + '</div><div class="node-hero-actions"><a class="button" href="#/views">All views</a></div></header><div class="node-sections">' + ((selected.blocks || []).length ? selected.blocks.map((block) => renderViewSurfaceBlock(selected, block)).join("") : '<p class="muted">No renderable blocks.</p>') + '</div></article>';
  return '<div class="surface-grid">' + generated.map((item) => '<section class="panel"><div class="chip-row">' + badge(item.audience || "human", "type") + '<code>' + esc(item.id) + '</code></div><h2><a href="#/views/' + encodeURIComponent(item.id) + '">' + esc(item.title) + '</a></h2>' + (item.summary ? '<p>' + esc(item.summary) + '</p>' : "") + '<p class="muted">' + esc(String((item.blocks || []).length)) + ' blocks</p>' + ((item.blocks || []).slice(0, 2).map((block) => renderViewSurfaceBlock(item, block)).join("") || '<p class="muted">No renderable blocks.</p>') + '</section>').join("") + '</div>';
}

function renderSettingsRoute() {
  return '<section class="panel settings-panel"><label class="field-label">Theme</label><select data-control="settings-theme">' + themes.map(([value, label]) => '<option value="' + value + '"' + (settings.theme === value ? " selected" : "") + '>' + label + '</option>').join("") + '</select><label class="field-label">Density</label><select data-control="settings-density">' + optionList(["comfortable", "compact"], settings.density || "comfortable") + '</select><label class="field-label">Default graph depth</label><select data-control="settings-depth">' + optionList(["1", "2", "3"], String(settings.graphDepth || 1)) + '</select><button class="button danger" data-control="settings-reset" type="button">Reset local UI settings</button></section>';
}

function renderNodeDetail(id) {
  const node = byId.get(id);
  if (!node) return '<section class="panel"><h2>Missing node</h2><p class="muted">No node exists for <code>' + esc(id) + '</code>.</p><p><a href="#/nodes">Browse nodes</a></p></section>';
  const outgoing = graph.edges.filter((edge) => edge.from === id);
  const incoming = graph.edges.filter((edge) => edge.to === id);
  const nodeDiagnostics = diagnosticsByNode.get(id) || [];
  const evidenceCount = Array.isArray(node.evidence) ? node.evidence.length : 0;
  const nodeEvents = (graph.events || []).filter((event) => event.target === id);
  const nodeCoordination = (coordination.claims || []).filter((claim) => (claim.nodeIds || []).includes(id) || (claim.targetIds || []).includes(id));
  const sections = [
    nodeCoordination.length ? nodeSection("Coordination", nodeCoordination.map(renderCoordinationClaim).join("")) : "",
    Array.isArray(node.fields?.crossVaultRefs) ? nodeSection("Cross-Vault References", renderKeyValueTable({ crossVaultRefs: node.fields.crossVaultRefs })) : "",
    nodeDiagnostics.length ? nodeSection("Health", renderDiagnostics(nodeDiagnostics)) : "",
    Array.isArray(node.blocks) && node.blocks.length ? nodeSection("Structured View", node.blocks.map(renderNodeAuthoredBlock).join("")) : "",
    outgoing.length || incoming.length ? nodeSection("Connected work", renderRelationshipIndex(outgoing, incoming)) : "",
    evidenceCount ? nodeSection("Evidence", renderEvidence(node.evidence)) : "",
    Array.isArray(node.anchors) && node.anchors.length ? nodeSection("Anchors", renderAnchors(node.anchors)) : "",
    node.freshness ? nodeSection("Freshness", renderKeyValueTable(node.freshness)) : "",
    node.fields && Object.keys(node.fields).length ? nodeSection("Fields", renderKeyValueTable(node.fields)) : "",
    node.body ? nodeSection("Body", renderBodyOutline(node.body)) : "",
    nodeEvents.length ? nodeSection("Activity", renderEventsForNode(node.id, nodeEvents)) : "",
    nodeSection("Run attribution", renderNodeRuns(node.id)),
    nodeSection("Use this node", '<div class="action-bar"><button class="button" data-copy="' + esc(node.title + "\\n" + node.summary) + '">Copy prompt snippet</button><a class="button" href="#/nodes?type=' + encodeURIComponent(node.type) + '">Same type</a><a class="button" href="#/nodes?status=' + encodeURIComponent(node.status) + '">Same status</a><a class="button" href="#/health?id=' + encodeURIComponent(node.id) + '">Related health</a></div>')
  ].join("");
  return '<article class="node-detail surface"><header class="node-hero"><div><div class="chip-row">' + renderNodeBadges(node) + '</div><h2>' + esc(node.title) + '</h2><p class="node-id">' + esc(node.id) + '</p>' + renderNodeMeta(node) + '</div><div class="node-hero-actions"><a class="button" href="#/graph?focus=' + encodeURIComponent(node.id) + '">Open graph</a><button class="button" data-copy="' + esc(node.id) + '">Copy reference</button></div></header><p class="node-summary">' + esc(node.summary) + '</p><div class="node-kpis">' + nodeKpi("Importance", pct(node.importance), "#/nodes?sortBy=importance") + nodeKpi("Confidence", pct(node.confidence), "#/nodes?sortBy=confidence") + nodeKpi("Diagnostics", nodeDiagnostics.length, "#/health?id=" + encodeURIComponent(node.id)) + nodeKpi("Evidence", evidenceCount, "#/node/" + encodeURIComponent(node.id)) + '</div><div class="node-sections">' + sections + '</div><details class="raw-panel"><summary>Raw JSON</summary><pre>' + esc(rawJsonPreview(node)) + '</pre></details></article>';
}

function renderNodeBadges(node) {
  return [
    badge(node.type, "type"),
    badge(node.status, "status"),
    node.evidence_required ? badge("evidence required", "status") : "",
    Array.isArray(node.anchors) && node.anchors.length ? badge(node.anchors.length + " anchors", "type") : "",
    node.freshness?.state ? badge("freshness: " + node.freshness.state, "status") : ""
  ].join("");
}

function renderNodeRuns(id) {
  const summaries = (graph.run_summaries || []).filter((summary) => (summary.touchedNodeIds || []).includes(id) || (summary.createdNodeIds || []).includes(id));
  if (!summaries.length) return '<p class="muted">No run attribution recorded.</p>';
  return '<div class="chip-row">' + summaries.slice(0, 8).map((summary) => '<a class="badge type" href="#/runs">' + esc(summary.runId) + '</a>').join("") + '</div>';
}

function renderBlock(block) {
  const renderer = Object.prototype.hasOwnProperty.call(blockRenderers, block?.type) ? blockRenderers[block.type] : undefined;
  if (typeof renderer !== "function") return '<section class="block unsupported"><h2>' + esc(unsupportedBlock(block)) + '</h2><pre>' + esc(rawJsonPreview(block)) + '</pre></section>';
  try {
    return renderer(block);
  } catch (error) {
    return '<section class="block unsupported"><h2>Malformed block</h2><p class="muted">' + esc(error instanceof Error ? error.message : String(error)) + '</p><pre>' + esc(rawJsonPreview(block)) + '</pre></section>';
  }
}

function renderNodeAuthoredBlock(block) {
  const renderer = Object.prototype.hasOwnProperty.call(nodeBlockRenderers, block?.type) ? nodeBlockRenderers[block.type] : undefined;
  if (typeof renderer !== "function") return '<section class="block unsupported"><h2>' + esc(unsupportedBlock(block)) + '</h2><pre>' + esc(rawJsonPreview(block)) + '</pre></section>';
  try {
    return renderer(block);
  } catch (error) {
    return '<section class="block unsupported"><h2>Malformed block</h2><p class="muted">' + esc(error instanceof Error ? error.message : String(error)) + '</p><pre>' + esc(rawJsonPreview(block)) + '</pre></section>';
  }
}

function renderAuthoredViewBlock(block) {
  if (!authoredViewBlockTypes.has(block?.type)) return '<section class="block unsupported"><h2>' + esc(unsupportedBlock(block)) + '</h2><pre>' + esc(rawJsonPreview(block)) + '</pre></section>';
  return renderBlock(block);
}

function renderViewSurfaceBlock(viewItem, block) {
  return viewItem?.authored ? renderAuthoredViewBlock(block) : renderBlock(block);
}

function renderBodyOutline(body) {
  const lines = String(body || "").replace(/\\r\\n?/g, "\\n").split("\\n").map((line) => line.trimEnd());
  const html = [];
  let paragraph = [];
  let listType = "";
  let listItems = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push("<p>" + renderInlineText(paragraph.join(" ")) + "</p>");
    paragraph = [];
  };
  const flushList = () => {
    if (!listType || !listItems.length) return;
    html.push("<" + listType + ">" + listItems.map((item) => "<li>" + renderInlineText(item) + "</li>").join("") + "</" + listType + ">");
    listType = "";
    listItems = [];
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const bullet = trimmed.match(/^[-*]\\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(bullet[1]);
      continue;
    }
    const numbered = trimmed.match(/^\\d+[.)]\\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(numbered[1]);
      continue;
    }
    const heading = outlineHeading(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      html.push("<h4>" + renderInlineText(heading) + "</h4>");
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return '<div class="prose outline-body">' + (html.length ? html.join("") : '<p class="muted">No body content.</p>') + "</div>";
}

function outlineHeading(line) {
  const markdown = line.match(/^#{1,4}\\s+(.+)$/);
  if (markdown) return markdown[1].trim();
  if (/^[A-Z][A-Za-z0-9 /&(),'"-]{2,80}:$/.test(line)) return line.slice(0, -1);
  return "";
}

function renderInlineText(value) {
  const text = String(value || "");
  let output = "";
  let cursor = 0;
  const tick = String.fromCharCode(96);
  const pattern = new RegExp(tick + "([^" + tick + "]{1,160})" + tick, "g");
  let match;
  while ((match = pattern.exec(text))) {
    output += esc(text.slice(cursor, match.index)) + "<code>" + esc(match[1]) + "</code>";
    cursor = match.index + match[0].length;
  }
  return output + esc(text.slice(cursor));
}

function renderBriefBlock(block) {
  if (Array.isArray(block.data?.items)) {
    return '<section class="' + blockClass(block) + '"><h2>' + esc(block.title || "Brief") + '</h2><div class="card-list">' + block.data.items.slice(0, 8).map((item) => '<article class="node-card"><strong>' + esc(item.label || "Note") + '</strong><p>' + esc(item.text || item.summary || "") + '</p></article>').join("") + '</div></section>';
  }
  const text = typeof block.data === "string" ? block.data : typeof block.summary === "string" ? block.summary : typeof block.data?.text === "string" ? block.data.text : "No summary available.";
  return '<section class="' + blockClass(block) + '"><h2>' + esc(block.title || "Brief") + '</h2><p>' + esc(text) + '</p></section>';
}

function renderSummaryBlock(block) {
  const source = objectRecord(block.data) || objectRecord(block.summary);
  if (source) return renderStatsGridBlock({ ...block, title: block.title || "Summary", data: source });
  return renderBriefBlock(block);
}

function renderCalloutBlock(block) {
  const text = typeof block.data === "string" ? block.data : block.data?.text || block.summary || "";
  return '<section class="' + blockClass(block, "callout callout-" + toneClass(block.tone)) + '"><h2>' + esc(block.title || "Callout") + '</h2><p>' + esc(text) + '</p></section>';
}

function renderStatsGridBlock(block) {
  const source = block.data || block.summary || diagnostics.summary || {};
  const entries = Array.isArray(source.items) ? source.items.map((item) => [item.label || item.key || "Metric", item.value]) : Object.entries(source);
  return '<section class="' + blockClass(block, "block-metrics") + '"><h2>' + esc(block.title || "Stats") + '</h2><div class="metric-row">' + entries.slice(0, 8).map(([key, value]) => metric(String(key).replaceAll("_", " "), value, "#/health")).join("") + '</div></section>';
}

function renderTableBlock(block) {
  const allRows = Array.isArray(block.data?.rows) ? block.data.rows : Array.isArray(block.data) ? block.data : [];
  const rows = allRows.slice(0, 100);
  const columns = normalizeTableColumns(block.data?.columns, rows);
  if (!rows.length || !columns.length) return '<section class="' + blockClass(block) + '"><h2>' + esc(block.title || "Table") + '</h2><p class="muted">No table rows.</p></section>';
  const capped = allRows.length > rows.length ? '<p class="muted">Showing first ' + rows.length + ' of ' + allRows.length + ' rows.</p>' : "";
  return '<section class="' + blockClass(block) + '"><h2>' + esc(block.title || "Table") + '</h2><div class="table-wrap"><table><thead><tr>' + columns.map((column) => '<th>' + esc(column.label) + '</th>').join("") + '</tr></thead><tbody>' + rows.map((row) => '<tr>' + columns.map((column) => '<td>' + esc(cellValue(row?.[column.key])) + '</td>').join("") + '</tr>').join("") + '</tbody></table></div>' + capped + '</section>';
}

function renderChecklistBlock(block) {
  const items = Array.isArray(block.data?.items) ? block.data.items : Array.isArray(block.data) ? block.data : [];
  return '<section class="' + blockClass(block) + '"><h2>' + esc(block.title || "Checklist") + '</h2>' + (items.length ? '<ul class="checklist">' + items.map((item) => {
    const objectItem = item && typeof item === "object" && !Array.isArray(item) ? item : undefined;
    const checked = objectItem ? Boolean(objectItem.done || objectItem.checked || ["done", "completed"].includes(objectItem.status)) : false;
    const label = objectItem ? objectItem.label || objectItem.title || objectItem.summary : item;
    return '<li><span class="checkmark">' + (checked ? "x" : "") + '</span><span>' + esc(label) + '</span></li>';
  }).join("") + '</ul>' : '<p class="muted">No checklist items.</p>') + '</section>';
}

function renderTimelineBlock(block) {
  const items = Array.isArray(block.data?.items) ? block.data.items : Array.isArray(block.data) ? block.data : [];
  return '<section class="' + blockClass(block) + '"><h2>' + esc(block.title || "Timeline") + '</h2>' + (items.length ? '<div class="timeline">' + items.map((item) => {
    const objectItem = item && typeof item === "object" && !Array.isArray(item) ? item : {};
    return '<div class="timeline-row"><time>' + esc(objectItem.at || objectItem.date || "") + '</time><strong>' + esc(objectItem.title || objectItem.label || "") + '</strong><p>' + esc(objectItem.summary || objectItem.body || (typeof item === "string" ? item : "")) + '</p></div>';
  }).join("") + '</div>' : '<p class="muted">No timeline items.</p>') + '</section>';
}

function renderNodeListBlock(block) {
  const items = resolveBlockItems(block).slice(0, block.limit || 8);
  const title = String(block.title || "").toLowerCase();
  const isReview = ["attention-list", "decision-review", "risk-review", "question-review", "task-review", "task-queue", "risk-list", "decision-list"].includes(block.type) || title.includes("recently completed");
  if (isReview) return renderReviewBlock(block, items);
  return '<section class="' + blockClass(block) + '"><h2>' + esc(block.title || "Nodes") + '</h2>' + (items.length ? '<div class="card-list">' + items.map(renderNodeCard).join("") + '</div>' : '<p class="muted">No matching nodes.</p>') + '</section>';
}

function renderReviewBlock(block, items) {
  const title = block.title || "Review";
  const href = reviewBlockRoute(block);
  return '<section class="' + blockClass(block, "review-block review-" + reviewTone(block)) + '"><header class="review-header"><div><h2>' + esc(title) + '</h2></div><a class="review-count" href="' + href + '"><strong>' + items.length + '</strong></a></header>' + (items.length ? '<div class="review-list">' + items.map(renderReviewRow).join("") + '</div>' : '<p class="muted">No matching nodes.</p>') + '</section>';
}

function renderReviewRow(node) {
  const nodeDiagnostics = diagnosticsByNode.get(node.id) || [];
  const tags = (node.tags || []).slice(0, 3).map((tag) => '<span class="review-tag">' + esc(tag) + '</span>').join("");
  const diagnostic = nodeDiagnostics.length ? '<span class="review-signal review-signal-warning">' + nodeDiagnostics.length + ' health</span>' : "";
  return '<a class="review-row" href="#/node/' + encodeURIComponent(node.id) + '"><span class="review-marker status-' + esc(String(node.status).replaceAll("_", "-")) + '"></span><span class="review-main"><strong>' + esc(node.title) + '</strong><small>' + esc(node.summary) + '</small></span><span class="review-status">' + statusPill(node.status) + '</span><span class="review-type">' + esc(node.type) + '</span><span class="review-score">' + pct(node.importance) + '</span><span class="review-health">' + diagnostic + '</span><span class="review-tags">' + tags + '</span></a>';
}

function reviewBlockRoute(block) {
  if (String(block.title || "").toLowerCase().includes("recently completed")) return "#/nodes?statuses=completed,resolved";
  if (block.type === "decision-review") return "#/nodes?type=decision&open=true";
  if (block.type === "risk-review") return "#/nodes?type=risk";
  if (block.type === "question-review") return "#/nodes?type=question&open=true";
  if (block.type === "task-review") return "#/kanban";
  if (block.type === "attention-list") {
    const title = String(block.title || "").toLowerCase();
    return title.includes("attention") ? "#/nodes?needsAttention=true" : "#/nodes?sortBy=importance";
  }
  return "#/nodes";
}

function reviewTone(block) {
  if (String(block.title || "").toLowerCase().includes("recently completed")) return "completed";
  if (block.type === "decision-review") return "decision";
  if (block.type === "risk-review") return "risk";
  if (block.type === "question-review") return "question";
  if (block.type === "task-review") return "task";
  return "attention";
}

function renderNodeTableBlock(block) {
  return '<section class="' + blockClass(block) + '"><h2>' + esc(block.title || "Node Table") + '</h2>' + renderNodeTable(resolveBlockItems(block)) + '</section>';
}

function renderDiagnosticListBlock(block) {
  const items = Array.isArray(block.items) ? block.items : Array.isArray(block.data?.items) ? block.data.items : Array.isArray(block.data) ? block.data : block.data?.query ? queryDiagnostics(block.data.query) : diagnostics.diagnostics || [];
  return '<section class="' + blockClass(block) + '"><h2>' + esc(block.title || "Diagnostics") + '</h2>' + (block.summary ? '<div class="metric-row">' + Object.entries(block.summary).slice(0, 4).map(([key, value]) => metric(key.replaceAll("_", " "), value, "#/health")).join("") + '</div>' : "") + renderDiagnostics(items) + '</section>';
}

function renderEvidenceListBlock(block) {
  const items = Array.isArray(block.items) ? block.items : Array.isArray(block.data?.items) ? block.data.items : Array.isArray(block.data) ? block.data : [];
  return '<section class="' + blockClass(block) + '"><h2>' + esc(block.title || "Evidence") + '</h2>' + renderEvidence(items) + '</section>';
}

function renderKanbanBlock(block) {
  return '<section class="' + blockClass(block) + '"><h2>Kanban</h2>' + renderKanbanColumns(kanbanColumns(false)) + '</section>';
}

function renderGraphBlock(block) {
  const config = block.data && typeof block.data === "object" && !Array.isArray(block.data) ? { ...block.data, ...block } : block;
  const neighborhood = graphNeighborhood(config.focus || config.focusNodeId || byId.keys().next().value, { depth: config.depth || 1, limit: config.limit || 80, types: config.types, statuses: config.statuses, rels: config.rels });
  if (!neighborhood.focus) return '<p class="muted">No graph focus available.</p>';
  const nodePositions = layoutGraph(neighborhood.nodes);
  const edgeLines = neighborhood.edges.map((edge) => {
    const a = nodePositions.get(edge.from);
    const b = nodePositions.get(edge.to);
    if (!a || !b) return "";
    return '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"></line><text x="' + ((a.x + b.x) / 2) + '" y="' + ((a.y + b.y) / 2 - 5) + '">' + esc(edge.rel) + '</text>';
  }).join("");
  const nodeEls = neighborhood.nodes.map((node) => {
    const p = nodePositions.get(node.id);
    return '<a href="#/node/' + encodeURIComponent(node.id) + '"><g class="' + (node.id === neighborhood.focus.id ? "focus" : "") + '"><circle cx="' + p.x + '" cy="' + p.y + '" r="25"></circle><text x="' + p.x + '" y="' + (p.y + 42) + '">' + esc(shortTitle(node.title)) + '</text></g></a>';
  }).join("");
  const capped = neighborhood.capped ? '<p class="muted">Graph display capped; narrow filters or lower depth.</p>' : "";
  return '<div class="graph-wrap"><svg class="graph-svg" viewBox="0 0 720 420" role="img" aria-label="Graph neighborhood">' + edgeLines + nodeEls + '</svg>' + capped + '</div>';
}

function renderRunSummaryBlock(block) {
  const source = block.data && typeof block.data === "object" && !Array.isArray(block.data) ? block.data : {};
  const metrics = source.metrics && typeof source.metrics === "object" && !Array.isArray(source.metrics) ? source.metrics : source;
  const notes = Array.isArray(source.notes) ? source.notes : [];
  return '<section class="' + blockClass(block) + '"><h2>' + esc(block.title || "Run Summary") + '</h2>' + (source.summary ? '<p>' + esc(source.summary) + '</p>' : "") + '<div class="metric-row">' + Object.entries(metrics).filter(([key]) => key !== "notes" && key !== "summary").slice(0, 6).map(([key, value]) => metric(key.replaceAll("_", " "), value, "#/runs")).join("") + '</div>' + (notes.length ? '<div class="activity-table">' + notes.slice(0, 8).map((note) => '<article class="activity-row"><time>' + esc(note.at || "") + '</time><strong>' + esc(note.type || "note") + '</strong><span>' + esc(note.summary || note.message || note) + '</span><em>' + esc(note.by || "") + '</em></article>').join("") + '</div>' : "") + '</section>';
}

function renderCurrentEffortBlock(block) {
  const runs = deriveRuns();
  const current = runs.find((run) => run.status === "in_progress") || runs[0];
  const summaries = new Map((graph.run_summaries || []).map((summary) => [summary.runId, summary]));
  const summary = current ? summaries.get(current.id) || {} : {};
  const template = graph.operating_templates || {};
  const warningCount = (summary.diagnostics || []).filter((diag) => diag.severity === "warning" || diag.severity === "fatal").length + ((template.conflicts || []).length);
  if (!current) return '<section class="' + blockClass(block) + '"><h2>' + esc(block.title || "Current Effort") + '</h2><p class="muted">No run has been recorded yet.</p></section>';
  return '<section class="' + blockClass(block, "review-block review-attention") + '"><header class="review-header"><div><h2>' + esc(block.title || "Current Effort") + '</h2><p class="muted">' + esc(current.goal || "Untitled run") + '</p></div><a class="review-count" href="#/runs"><strong>' + esc(current.status || "run") + '</strong></a></header><div class="metric-row">' + metric("Created", (summary.createdNodeIds || []).length, "#/runs") + metric("Touched", (summary.touchedNodeIds || []).length, "#/runs") + metric("Evidence", (summary.evidenceNodeIds || []).length, "#/runs") + metric("Warnings", warningCount, "#/health") + '</div><div class="overview-brief"><p><strong>Template:</strong> ' + esc(template.activeTemplateId || "none") + '</p><p><strong>Template issues:</strong> ' + esc(((template.warnings || []).length + (template.missingSections || []).length + (template.conflicts || []).length)) + '</p>' + (current.summary ? '<p>' + esc(current.summary) + '</p>' : "") + '</div></section>';
}

function renderAnchors(anchors) {
  return '<div class="table-wrap"><table><thead><tr><th>Kind</th><th>Reference</th><th>Label</th></tr></thead><tbody>' + anchors.map((anchor) => {
    const value = anchor.url || anchor.path || anchor.name || anchor.label || "";
    const reference = anchor.url && safeAnchorHref(anchor.url) ? '<a href="' + esc(anchor.url) + '">' + esc(anchor.url) + '</a>' : '<code>' + esc(value) + '</code>';
    return '<tr><td>' + esc(anchor.kind || "") + '</td><td>' + reference + '</td><td>' + esc(anchor.label || "") + '</td></tr>';
  }).join("") + '</tbody></table></div>';
}

function safeAnchorHref(value) {
  try {
    const parsed = new URL(value, window.location.href);
    return ["http:", "https:", "file:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function renderRawJsonBlock(block) {
  return '<section class="' + blockClass(block) + '"><h2>' + esc(block.title || "Raw JSON") + '</h2><pre>' + esc(rawJsonPreview(block.data || block)) + '</pre></section>';
}

function normalizeTableColumns(columns, rows) {
  const raw = Array.isArray(columns) ? columns : Array.from(new Set(rows.flatMap((row) => row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row) : [])));
  return raw.map((column) => {
    if (column && typeof column === "object" && !Array.isArray(column)) {
      const key = String(column.key || "");
      return key ? { key, label: String(column.label || key).replaceAll("_", " ") } : null;
    }
    const key = String(column || "");
    return key ? { key, label: key.replaceAll("_", " ") } : null;
  }).filter(Boolean);
}

function renderKeyValueTable(value) {
  return '<div class="table-wrap"><table><tbody>' + Object.entries(value || {}).map(([key, item]) => '<tr><th>' + esc(key.replaceAll("_", " ")) + '</th><td><code>' + esc(cellValue(item)) + '</code></td></tr>').join("") + '</tbody></table></div>';
}

function cellValue(value) {
  const text = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
  return text.length > 240 ? text.slice(0, 237) + "..." : text;
}

function blockClass(block, extra) {
  const compact = block?.layout === "compact" || block?.width === "compact";
  return ["block", extra || "", compact ? "block-compact" : ""].filter(Boolean).join(" ");
}

function toneClass(value) {
  const tone = String(value || "info").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return ["info", "success", "warning", "danger", "neutral"].includes(tone) ? tone : "info";
}

function resolveBlockItems(block) {
  if (Array.isArray(block.items)) return block.items.map(normalizeBlockNode).filter(Boolean);
  if (Array.isArray(block.data?.nodeIds)) return block.data.nodeIds.map(normalizeBlockNode).filter(Boolean);
  if (Array.isArray(block.data?.items)) return block.data.items.map(normalizeBlockNode).filter(Boolean);
  if (block.query) return queryNodes(block.query);
  if (block.data?.query) return queryNodes(block.data.query);
  return [];
}

function rawJsonPreview(value) {
  const json = JSON.stringify(value, null, 2);
  return json.length > 12000 ? json.slice(0, 12000) + "\\n... truncated ..." : json;
}

function normalizeBlockNode(item) {
  if (typeof item === "string") return byId.get(item) || missingBlockNode(item);
  if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
  const id = typeof item.id === "string" && item.id ? item.id : undefined;
  if (!id) return undefined;
  const source = byId.has(id) ? { ...byId.get(id), ...item } : item;
  return {
    id,
    title: String(source.title || id),
    summary: String(source.summary || (byId.has(id) ? "" : "Referenced by a block but not present in the compiled graph.")),
    type: String(source.type || "artifact"),
    status: String(source.status || (byId.has(id) ? "active" : "needs_review")),
    importance: numeric(source.importance, 0),
    confidence: numeric(source.confidence, 0),
    created_at: source.created_at,
    updated_at: source.updated_at,
    tags: Array.isArray(source.tags) ? source.tags : [],
    evidence: Array.isArray(source.evidence) ? source.evidence : undefined
  };
}

function missingBlockNode(id) {
  return {
    id,
    title: "Missing node reference",
    summary: id,
    type: "artifact",
    status: "needs_review",
    importance: 0,
    confidence: 0,
    tags: []
  };
}

function queryNodes(query) {
  let result = graph.nodes.filter((node) => {
    if (query.type && node.type !== query.type) return false;
    if (query.types?.length && !query.types.includes(node.type)) return false;
    if (query.status && node.status !== query.status) return false;
    if (query.statuses?.length && !query.statuses.includes(node.status)) return false;
    if (query.tag && !(node.tags || []).includes(query.tag)) return false;
    if (query.tags?.length && !query.tags.some((tag) => (node.tags || []).includes(tag))) return false;
    if (query.importance_gte !== undefined && node.importance < Number(query.importance_gte)) return false;
    if (query.confidence_gte !== undefined && node.confidence < Number(query.confidence_gte)) return false;
    if (query.confidence_lte !== undefined && node.confidence > Number(query.confidence_lte)) return false;
    if (query.hasDiagnostics && !(diagnosticsByNode.get(node.id) || []).length) return false;
    if (query.needsAttention && !["blocked", "needs_review", "stale"].includes(node.status)) return false;
    if (query.open && isClosedStatus(node.status)) return false;
    if (query.stale && node.status !== "stale" && !(diagnosticsByNode.get(node.id) || []).some((diag) => diag.code === "stale_node")) return false;
    if (query.needsReview && !["needs_review", "stale"].includes(node.status)) return false;
    return true;
  });
  result = sortNodes(result, query.sortBy || "importance");
  return query.limit ? result.slice(0, Number(query.limit)) : result;
}

function queryDiagnostics(query) {
  const source = diagnostics.diagnostics || [];
  if (!query || typeof query !== "object" || Array.isArray(query)) return source;
  let result = source.filter((diag) => {
    if (query.severity && diag.severity !== query.severity) return false;
    if (query.code && diag.code !== query.code) return false;
    if (query.id && diag.id !== query.id) return false;
    return true;
  });
  return query.limit ? result.slice(0, Number(query.limit)) : result;
}

function sortNodes(nodes, sortBy) {
  const updated = (node) => Date.parse(node.updated_at || node.created_at || "") || 0;
  return [...nodes].sort((a, b) => {
    if (sortBy === "updated") return updated(b) - updated(a) || a.title.localeCompare(b.title);
    if (sortBy === "created") return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || a.title.localeCompare(b.title);
    if (sortBy === "confidence") return b.confidence - a.confidence || a.title.localeCompare(b.title);
    if (sortBy === "title") return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    if (sortBy === "type") return a.type.localeCompare(b.type) || a.title.localeCompare(b.title);
    if (sortBy === "status") return a.status.localeCompare(b.status) || a.title.localeCompare(b.title);
    if (sortBy === "diagnosticSeverity") return diagRank(b) - diagRank(a) || a.title.localeCompare(b.title);
    if (sortBy === "staleFirst") return Number(b.status === "stale") - Number(a.status === "stale") || updated(a) - updated(b) || a.title.localeCompare(b.title);
    if (sortBy === "blockedFirst") return Number(b.status === "blocked") - Number(a.status === "blocked") || b.importance - a.importance || a.title.localeCompare(b.title);
    return b.importance - a.importance || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}

function graphNeighborhood(focusNodeId, options = {}) {
  const visible = (node) => node && !["archived", "superseded"].includes(node.status) && (!options.types?.length || options.types.includes(node.type)) && (!options.statuses?.length || options.statuses.includes(node.status));
  const requested = byId.get(focusNodeId);
  if (focusNodeId && !requested) return { nodes: [], edges: [], capped: false, missingFocus: true };
  const focus = visible(requested) ? requested : graph.nodes.find(visible);
  if (!visible(focus)) return { nodes: [], edges: [], capped: false, missingFocus: Boolean(focusNodeId) };
  const maxDepth = clamp(Number(options.depth || 1), 1, 3);
  const limit = Number(options.limit || 80);
  const selected = new Map([[focus.id, 0]]);
  const queue = [focus.id];
  for (let i = 0; i < queue.length; i += 1) {
    const id = queue[i];
    const depth = selected.get(id);
    if (depth >= maxDepth) continue;
    for (const edge of graph.edges) {
      if (options.rels?.length && !options.rels.includes(edge.rel)) continue;
      if (edge.from !== id && edge.to !== id) continue;
      const nextId = edge.from === id ? edge.to : edge.from;
      const next = byId.get(nextId);
      if (selected.has(nextId) || !visible(next)) continue;
      selected.set(nextId, depth + 1);
      queue.push(nextId);
      if (selected.size >= limit) break;
    }
    if (selected.size >= limit) break;
  }
  const nodeSet = new Set(selected.keys());
  return {
    focus,
    nodes: [...selected.keys()].map((id) => byId.get(id)).filter(Boolean).sort((a, b) => (selected.get(a.id) || 0) - (selected.get(b.id) || 0) || a.title.localeCompare(b.title)),
    edges: graph.edges.filter((edge) => nodeSet.has(edge.from) && nodeSet.has(edge.to) && (!options.rels?.length || options.rels.includes(edge.rel))),
    capped: selected.size >= limit,
    missingFocus: false
  };
}

function kanbanColumns(includeArchived) {
  const definitions = [
    ["proposed", "Proposed", ["draft", "proposed"], false],
    ["active", "Active", ["active", "accepted"], false],
    ["in_progress", "In Progress", ["in_progress"], false],
    ["blocked", "Blocked", ["blocked"], false],
    ["needs_review", "Needs Review", ["needs_review", "stale"], false],
    ["done", "Done", ["completed", "resolved"], false],
    ["archived", "Archived", ["archived", "superseded", "rejected"], true]
  ];
  const workflow = new Set(["task", "decision", "risk", "question", "claim", "requirement", "artifact"]);
  return definitions.filter(([, , , hidden]) => includeArchived || !hidden).map(([id, title, statuses, hidden]) => ({ id, title, hidden, nodes: sortNodes(graph.nodes.filter((node) => workflow.has(node.type) && statuses.includes(node.status)), "blockedFirst") }));
}

function renderKanbanColumns(columns) {
  return '<div class="kanban">' + columns.map((column) => '<section class="kanban-column column-' + esc(column.id).replaceAll("_", "-") + '"><h2>' + esc(column.title) + ' <span>' + column.nodes.length + '</span></h2>' + (column.nodes.length ? column.nodes.map(renderNodeCard).join("") : '<p class="muted">No items.</p>') + '</section>').join("") + '</div>';
}

function renderNodeCard(node) {
  const nodeDiagnostics = diagnosticsByNode.get(node.id) || [];
  const blockers = graph.edges.filter((edge) => edge.rel === "blocks" && (edge.from === node.id || edge.to === node.id)).length;
  return '<article class="node-card"><a class="card-title" href="#/node/' + encodeURIComponent(node.id) + '"><strong>' + esc(node.title) + '</strong></a><p>' + esc(node.summary) + '</p><div class="chip-row">' + badge(node.type, "type") + badge(node.status, "status") + chip("Imp " + pct(node.importance), "#/nodes?sortBy=importance") + chip("Conf " + pct(node.confidence), "#/nodes?sortBy=confidence") + (nodeDiagnostics.length ? chip(nodeDiagnostics.length + " diagnostics", "#/health?id=" + encodeURIComponent(node.id)) : "") + (Array.isArray(node.evidence) ? chip(node.evidence.length + " evidence", "#/node/" + encodeURIComponent(node.id)) : "") + (blockers ? chip(blockers + " blockers/risks", "#/graph?focus=" + encodeURIComponent(node.id)) : "") + '</div><small>Updated ' + esc(shortDate(node.updated_at)) + '</small></article>';
}

function renderNodeSummary(node) {
  return '<h2>' + esc(node.title) + '</h2><p>' + esc(node.summary) + '</p><div class="chip-row">' + badge(node.type, "type") + badge(node.status, "status") + '</div><p><a href="#/node/' + encodeURIComponent(node.id) + '">Open full detail</a></p>';
}

function renderGraphFooterNode(node) {
  return '<div class="graph-footer-node"><div><h2>' + esc(node.title) + '</h2><p>' + esc(node.summary) + '</p></div><div class="chip-row">' + badge(node.type, "type") + badge(node.status, "status") + '<a class="button" href="#/node/' + encodeURIComponent(node.id) + '">Open detail</a></div></div>';
}

function renderNodeTable(nodes) {
  if (!nodes.length) return '<p class="muted">No matching nodes.</p>';
  return '<div class="table-wrap"><table><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Importance</th><th>Updated</th></tr></thead><tbody>' + nodes.map((node) => '<tr><td><a href="#/node/' + encodeURIComponent(node.id) + '">' + esc(node.title) + '</a><small>' + esc(node.summary) + '</small></td><td>' + badge(node.type, "type") + '</td><td>' + badge(node.status, "status") + '</td><td>' + pct(node.importance) + '</td><td>' + esc(shortDate(node.updated_at)) + '</td></tr>').join("") + '</tbody></table></div>';
}

function renderDiagnostics(items) {
  const safeItems = Array.isArray(items) ? items.filter((diag) => diag && typeof diag === "object") : [];
  if (!safeItems.length) return '<p class="muted">No diagnostics.</p>';
  return '<div class="diagnostic-list">' + safeItems.map((diag) => '<a class="diagnostic-row severity-' + esc(diag.severity || "info") + '" href="' + diagnosticTarget(diag) + '"><span class="diagnostic-severity">' + esc(diag.severity || "info") + '</span><span class="diagnostic-main"><strong>' + esc((diag.code || "unknown").replaceAll("_", " ")) + '</strong><small>' + esc(diag.message || "Malformed diagnostic entry.") + '</small></span></a>').join("") + '</div>';
}

function diagnosticTarget(diag) {
  return byId.has(diag.id) ? "#/node/" + encodeURIComponent(diag.id) : "#/health?code=" + encodeURIComponent(diag.code);
}

function renderEvidence(evidence) {
  if (!Array.isArray(evidence) || !evidence.length) return '<p class="muted">No evidence recorded.</p>';
  return '<div class="evidence-list">' + evidence.map((item) => {
    const entry = item && typeof item === "object" && !Array.isArray(item) ? item : { label: item, summary: "", source: "" };
    const label = entry.label || entry.title || entry.source || "Evidence";
    const summary = entry.summary || entry.note || "";
    const source = entry.source || entry.url || "";
    return '<article class="evidence-row"><span class="evidence-marker"></span><span class="evidence-main"><strong>' + esc(label) + '</strong>' + (summary ? '<small>' + esc(summary) + '</small>' : "") + (source ? '<code>' + esc(source) + '</code>' : "") + '</span></article>';
  }).join("") + '</div>';
}

function renderEdges(edges, side) {
  if (!edges.length) return '<p class="muted">No links.</p>';
  return '<ul>' + edges.map((edge) => '<li><code>' + esc(edge.rel) + '</code> <a href="#/node/' + encodeURIComponent(edge[side]) + '">' + esc(edge[side]) + '</a></li>').join("") + '</ul>';
}

function renderRelationshipIndex(outgoing, incoming) {
  const rows = [
    ...outgoing.map((edge) => ({ direction: "Outgoing", edge, nodeId: edge.to })),
    ...incoming.map((edge) => ({ direction: "Incoming", edge, nodeId: edge.from }))
  ];
  if (!rows.length) return '<p class="muted">No relationships recorded.</p>';
  return '<div class="relationship-index"><p class="relationship-count">' + rows.length + ' ' + (rows.length === 1 ? "relationship" : "relationships") + '</p><div class="relationship-list">' + rows.map(({ direction, edge, nodeId }) => {
    const related = byId.get(nodeId);
    return '<a class="relationship-row" href="#/node/' + encodeURIComponent(nodeId) + '"><span class="relationship-direction">' + esc(direction === "Outgoing" ? "Out" : "In") + '</span><span class="relationship-rel">' + esc(edge.rel) + '</span><span class="relationship-node"><strong>' + esc(related?.title || nodeId) + '</strong></span><span class="relationship-status">' + (related ? statusPill(related.status) : '<span class="muted">missing</span>') + '</span></a>';
  }).join("") + '</div></div>';
}

function renderEventsForNode(id, providedEvents) {
  const events = providedEvents || (graph.events || []).filter((event) => event.target === id);
  return events.length ? '<div class="activity-table">' + events.slice().sort((a, b) => (Date.parse(b.at || "") || 0) - (Date.parse(a.at || "") || 0)).map((event) => '<article class="activity-row"><time title="' + esc(humanDate(event.at)) + '">' + esc(relativeTime(event.at)) + '</time><strong>' + esc(event.type.replaceAll("_", " ").replaceAll("-", " ")) + '</strong><span>' + esc(event.summary || event.message || "") + '</span><em>' + esc(event.by || "") + '</em></article>').join("") + '</div>' : '<p class="muted">No events recorded.</p>';
}

function layoutGraph(nodes) {
  const positions = new Map();
  const centerX = 360;
  const centerY = 200;
  const radius = Math.min(160, 60 + nodes.length * 8);
  nodes.forEach((node, index) => {
    if (index === 0) positions.set(node.id, { x: centerX, y: centerY });
    else {
      const angle = ((index - 1) / Math.max(1, nodes.length - 1)) * Math.PI * 2 - Math.PI / 2;
      positions.set(node.id, { x: Math.round(centerX + Math.cos(angle) * radius), y: Math.round(centerY + Math.sin(angle) * radius) });
    }
  });
  return positions;
}

function wireRouteControls(root, route) {
  root.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", () => navigator.clipboard?.writeText(button.dataset.copy || "")));
  if (route === "graph") {
    root.querySelectorAll("[data-control^='graph-']").forEach((control) => control.addEventListener("change", updateGraphHash));
  }
  if (route === "nodes") {
    root.querySelectorAll("[data-control^='nodes-']").forEach((control) => control.addEventListener("change", updateNodesHash));
    root.querySelector("[data-control='nodes-q']")?.addEventListener("input", debounce(updateNodesHash, 200));
  }
  if (route === "maintenance") {
    root.querySelectorAll("[data-control^='maintenance-']").forEach((control) => control.addEventListener("change", updateMaintenanceHash));
  }
  if (route === "queues") {
    root.querySelectorAll("[data-control^='queue-']").forEach((control) => control.addEventListener("change", updateQueueHash));
  }
  if (route === "settings") {
    root.querySelector("[data-control='settings-theme']")?.addEventListener("change", (event) => updateSetting("theme", event.target.value));
    root.querySelector("[data-control='settings-density']")?.addEventListener("change", (event) => updateSetting("density", event.target.value));
    root.querySelector("[data-control='settings-depth']")?.addEventListener("change", (event) => updateSetting("graphDepth", event.target.value));
    root.querySelector("[data-control='settings-reset']")?.addEventListener("click", () => { localStorage.removeItem("awg.viewer.settings"); location.reload(); });
  }
}

function syncReviewColumns(root) {
  const rows = [...root.querySelectorAll(".review-row")];
  if (!rows.length) return;
  const specs = [
    ["status", ".review-status"],
    ["type", ".review-type"],
    ["score", ".review-score"],
    ["health", ".review-health"],
    ["tags", ".review-tags"]
  ];
  for (const [name, selector] of specs) {
    const width = Math.ceil(Math.max(...rows.map((row) => row.querySelector(selector)?.scrollWidth || 0), 0));
    root.style.setProperty("--review-" + name + "-w", Math.max(width, 1) + "px");
  }
}

function updateGraphHash() {
  const params = new URLSearchParams();
  const map = { focus: "graph-focus", depth: "graph-depth", rel: "graph-rel", type: "graph-type", status: "graph-status" };
  for (const [key, control] of Object.entries(map)) {
    const value = document.querySelector("[data-control='" + control + "']")?.value;
    if (value) params.set(key, value);
  }
  location.hash = "#/graph" + (params.size ? "?" + params.toString() : "");
}

function updateNodesHash() {
  const params = new URLSearchParams();
  const map = { q: "nodes-q", type: "nodes-type", status: "nodes-status", tag: "nodes-tag", sortBy: "nodes-sort" };
  for (const [key, control] of Object.entries(map)) {
    const value = document.querySelector("[data-control='" + control + "']")?.value;
    if (value) params.set(key, value);
  }
  location.hash = "#/nodes" + (params.size ? "?" + params.toString() : "");
}

function updateMaintenanceHash() {
  const params = new URLSearchParams();
  const map = { kind: "maintenance-kind", severity: "maintenance-severity" };
  for (const [key, control] of Object.entries(map)) {
    const value = document.querySelector("[data-control='" + control + "']")?.value;
    if (value) params.set(key, value);
  }
  location.hash = "#/maintenance" + (params.size ? "?" + params.toString() : "");
}

function updateQueueHash() {
  const params = new URLSearchParams();
  const value = document.querySelector("[data-control='queue-id']")?.value;
  if (value) params.set("queue", value);
  location.hash = "#/queues" + (params.size ? "?" + params.toString() : "");
}

function updateSetting(key, value) {
  settings[key] = value;
  localStorage.setItem("awg.viewer.settings", JSON.stringify(settings));
  if (key === "theme") applyTheme(value);
  if (key === "density") document.documentElement.dataset.density = value;
  renderRoute();
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem("awg.viewer.settings") || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  document.documentElement.dataset.density = settings.density || "comfortable";
}

function groupDiagnostics(items) {
  const map = new Map();
  for (const item of items) {
    if (!item.id) continue;
    const list = map.get(item.id) || [];
    list.push(item);
    map.set(item.id, list);
  }
  return map;
}

function isClosedStatus(status) {
  return ["completed", "resolved", "rejected", "superseded", "archived"].includes(status);
}

function unsupportedBlock(block) {
  return "Unsupported block type: " + (block?.type || "unknown");
}

function metric(label, value, href) { return '<a class="metric metric-' + metricTone(label) + '" href="' + href + '"><span class="metric-label">' + esc(label) + '</span><span class="metric-state"><i aria-hidden="true"></i>' + esc(metricState(label)) + '</span><strong>' + esc(String(value)) + '</strong></a>'; }
function nodeKpi(label, value, href) { return '<a class="node-kpi metric-' + metricTone(label) + '" href="' + href + '"><span>' + esc(label) + '</span><strong>' + esc(String(value)) + '</strong></a>'; }
function nodeSection(title, body) { return '<section class="node-section"><header><h3>' + esc(title) + '</h3></header><div class="node-section-body">' + body + '</div></section>'; }
function metricTone(label) {
  const key = String(label).toLowerCase();
  if (key.includes("fatal") || key.includes("error") || key.includes("blocked")) return "danger";
  if (key.includes("warning") || key.includes("stale") || key.includes("review")) return "warning";
  if (key.includes("complete") || key.includes("resolved") || key.includes("ok")) return "success";
  return "info";
}
function metricState(label) {
  const key = String(label).toLowerCase();
  if (key.includes("node")) return "Tracked graph item";
  if (key.includes("edge")) return "Relationship link";
  if (key.includes("fatal") || key.includes("error")) return "Needs correction";
  if (key.includes("warning")) return "Review signal";
  if (key.includes("stale")) return "Past review date";
  if (key.includes("orphan")) return "Missing relationship";
  if (key.includes("question")) return "Awaiting answer";
  if (key.includes("importance")) return "Priority score";
  if (key.includes("confidence")) return "Confidence score";
  if (key.includes("diagnostic")) return "Health signal";
  if (key.includes("evidence")) return "Evidence count";
  return "Current signal";
}
function badge(value, kind) { return '<a class="badge badge-' + esc(kind) + ' status-' + esc(String(value).replaceAll("_", "-")) + '" href="' + (kind === "status" ? "#/nodes?status=" : kind === "type" ? "#/nodes?type=" : "#/health?severity=") + encodeURIComponent(value) + '">' + esc(displayLabel(value)) + '</a>'; }
function statusPill(value) { return '<span class="badge badge-status status-' + esc(String(value).replaceAll("_", "-")) + '">' + esc(displayLabel(value)) + '</span>'; }
function chip(label, href) { return '<a class="chip" href="' + href + '">' + esc(label) + '</a>'; }
function relativeMeta(label, value) { return '<span title="' + esc(humanDate(value)) + '">' + esc(label) + ' ' + esc(relativeTime(value)) + '</span>'; }
function renderNodeMeta(node) {
  const items = [];
  if (sameInstant(node.created_at, node.updated_at)) items.push(relativeMeta("Created", node.created_at));
  else items.push(relativeMeta("Updated", node.updated_at));
  const reviewAfter = node.freshness?.review_after || node.review_after;
  if (reviewAfter) items.push(relativeMeta("Review", reviewAfter));
  return items.length ? '<div class="node-meta-line">' + items.join("") + '</div>' : "";
}
function metaItem(label, value) { return '<div class="meta-item"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>'; }
function def(label, value) { return '<dt>' + esc(label) + '</dt><dd>' + esc(value) + '</dd>'; }
function selected(value, expected) { return Number(value) === Number(expected) ? " selected" : ""; }
function optionList(values, selectedValue) { return values.map((value) => '<option value="' + esc(value) + '"' + (value === selectedValue ? " selected" : "") + '>' + esc(value) + '</option>').join(""); }
function unique(values) { return [...new Set(values.filter(Boolean))].sort(); }
function firstGraphFocus(options) { return (graph.nodes.find((node) => !["archived", "superseded"].includes(node.status) && (!options.types?.length || options.types.includes(node.type)) && (!options.statuses?.length || options.statuses.includes(node.status))) || graph.nodes.find((node) => !["archived", "superseded"].includes(node.status)))?.id; }
function pct(value) { return Math.round(Number(value || 0) * 100) + "%"; }
function numeric(value, fallback) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function objectRecord(value) { return value && typeof value === "object" && !Array.isArray(value) ? value : undefined; }
function shortDate(value) { return value ? String(value).slice(0, 10) : "unknown"; }
function humanDate(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function relativeTime(value) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const abs = Math.abs(seconds);
  const units = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) {
    if (abs >= size) {
      const amount = Math.round(abs / size);
      return amount + " " + unit + (amount === 1 ? "" : "s") + (seconds >= 0 ? " ago" : " from now");
    }
  }
  return abs <= 5 ? "just now" : abs + " seconds" + (seconds >= 0 ? " ago" : " from now");
}
function sameInstant(a, b) {
  const left = Date.parse(a || "");
  const right = Date.parse(b || "");
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}
function shortTitle(value) { return String(value).length > 18 ? String(value).slice(0, 16) + "..." : String(value); }
function displayLabel(value) {
  const label = String(value || "");
  if (label === "needs_review") return "review";
  return label.replaceAll("_", " ");
}
function diagRank(node) { return Math.max(0, ...(diagnosticsByNode.get(node.id) || []).map((diag) => diag.severity === "fatal" ? 3 : diag.severity === "warning" ? 2 : 1)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }
function debounce(fn, wait) { let timer; return () => { clearTimeout(timer); timer = setTimeout(fn, wait); }; }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function safeDecodeURIComponent(value) { try { return decodeURIComponent(value); } catch { return value; } }
`;
}

function viewerCss(): string {
  return `:root{
  color-scheme:light;
  --font-sans:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --font-mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
  --space-1:4px;--space-2:8px;--space-3:12px;--space-4:16px;--space-5:24px;--space-6:32px;
  --radius-1:4px;--radius-2:8px;--shadow-1:0 1px 2px rgb(15 23 42 / .06);--panel-shadow:var(--shadow-1);--border-width:1px;--duration-fast:140ms;
  --bg:#f6f7f4;--bg-subtle:#eceee8;--surface:#ffffff;--surface-raised:#ffffff;--border:#d8ddd2;--border-strong:#aab3a2;
  --bg-wash:linear-gradient(180deg,#f8faf7 0%,#eef2e8 100%);--surface-filter:none;--topbar-bg:var(--surface);
  --text:#1e251d;--text-muted:#586152;--text-subtle:#788171;--accent:#1d6f6f;--accent-muted:#d7eeee;
  --danger:#b42318;--warning:#996600;--success:#1f7a4d;--info:#2463a6;
  --status-draft:#6b7280;--status-proposed:#7c5a1d;--status-active:#1d6f6f;--status-accepted:#25633f;--status-in-progress:#2463a6;
  --status-blocked:#b42318;--status-needs-review:#8a4f12;--status-stale:#735f00;--status-completed:#1f7a4d;--status-resolved:#25633f;
  --status-rejected:#8c2f39;--status-superseded:#5b6472;--status-archived:#687076;
  --diagnostic-info:#2463a6;--diagnostic-warning:#996600;--diagnostic-error:#b42318;
  --sidebar-bg:#e7ebe2;--card-bg:#ffffff;--card-border:#d8ddd2;--badge-bg:#eef2ea;--kanban-column-bg:#eef2ea;
  --nav-active-bg:#dbe7f7;--nav-active-border:#b9cbe6;--metric-bg:#ffffff;--box-grid-bg:#ffffff;--box-grid-border:#d8ddd2;--metric-divider:#d8ddd2;--control-bg:#ffffff;--card-shadow:none;--sidebar-shadow:none;
  --graph-node-bg:#ffffff;--graph-edge-color:#8f9a88;--graph-focus-color:#1d6f6f;
}
:root[data-theme="dark"]{
  color-scheme:dark;--bg:#050b14;--bg-subtle:#0a1420;--surface:rgb(12 22 35 / .88);--surface-raised:rgb(16 28 44 / .94);--border:#1c2a3c;--border-strong:#30445f;
  --bg-wash:linear-gradient(145deg,#050a12 0%,#07111e 50%,#09131d 100%);--surface-filter:blur(14px) saturate(1.08);--topbar-bg:rgb(5 11 20 / .62);
  --shadow-1:0 18px 48px rgb(0 0 0 / .34),inset 0 1px 0 rgb(255 255 255 / .03);--panel-shadow:var(--shadow-1);
  --text:#f5f8fc;--text-muted:#b7c3d3;--text-subtle:#7f8ba0;--accent:#4fa1ff;--accent-muted:#0b2c50;
  --danger:#ff625a;--warning:#f6b942;--success:#36d576;--info:#4fa1ff;
  --status-draft:#8a95a6;--status-proposed:#9d6cff;--status-active:#4fa1ff;--status-accepted:#3bd37d;--status-in-progress:#4f8cff;
  --status-blocked:#ff625a;--status-needs-review:#f6b942;--status-stale:#f59e0b;--status-completed:#36d576;--status-resolved:#41d68c;
  --status-rejected:#ef4444;--status-superseded:#8b95a8;--status-archived:#667085;
  --diagnostic-info:#4fa1ff;--diagnostic-warning:#f6b942;--diagnostic-error:#ff625a;
  --sidebar-bg:rgb(6 13 23 / .92);--card-bg:rgb(15 27 43 / .84);--card-border:#20314a;--badge-bg:rgb(21 35 56 / .86);--kanban-column-bg:rgb(10 20 34 / .78);
  --nav-active-bg:linear-gradient(135deg,rgb(34 94 185 / .58),rgb(40 69 130 / .52));--nav-active-border:#2f68bd;--metric-bg:rgb(13 24 39 / .88);--box-grid-bg:rgb(9 15 24 / .72);--box-grid-border:#242d3a;--metric-divider:#263240;--control-bg:rgb(10 19 32 / .92);
  --card-shadow:inset 0 1px 0 rgb(255 255 255 / .03),0 12px 32px rgb(0 0 0 / .22);--sidebar-shadow:inset -1px 0 0 rgb(255 255 255 / .03),12px 0 40px rgb(0 0 0 / .22);
  --graph-node-bg:#13233a;--graph-edge-color:#324960;--graph-focus-color:#4fa1ff;
}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg-wash),var(--bg);color:var(--text);font-family:var(--font-sans);line-height:1.45}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}code,pre{font-family:var(--font-mono)}pre{overflow:auto;background:var(--bg-subtle);padding:var(--space-4);border-radius:var(--radius-2)}
.awg-app{min-height:100vh;display:grid;grid-template-columns:240px 1fr}.sidebar{background:var(--sidebar-bg);border-right:var(--border-width) solid var(--border);box-shadow:var(--sidebar-shadow);backdrop-filter:var(--surface-filter);padding:var(--space-5);position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:var(--space-5)}.brand{display:grid;color:var(--text);font-size:22px;font-weight:750;line-height:1.1}.brand small{color:var(--text-muted);font-size:12px;font-weight:500;margin-top:3px}nav{display:grid;gap:var(--space-1)}nav a{color:var(--text-muted);padding:9px 10px;border:var(--border-width) solid transparent;border-radius:var(--radius-1);transition:background var(--duration-fast),border-color var(--duration-fast),color var(--duration-fast)}nav a.active,nav a:hover{background:var(--nav-active-bg);border-color:var(--nav-active-border);color:var(--text);text-decoration:none}.sidebar-footer{margin-top:auto}.main{min-width:0}.topbar{display:flex;justify-content:space-between;gap:var(--space-5);align-items:stretch;border-bottom:var(--border-width) solid var(--border);padding:0 var(--space-6);background:var(--topbar-bg);backdrop-filter:var(--surface-filter)}.topbar>div:first-child{padding:var(--space-5) 0}.eyebrow{margin:0;color:var(--text-subtle);font-size:12px;text-transform:uppercase;letter-spacing:.08em}h1{margin:4px 0 0;font-size:28px}h2{margin:0 0 var(--space-3);font-size:18px}h3{margin:var(--space-4) 0 var(--space-2);font-size:15px}.route-root{padding:var(--space-6)}.surface,.panel,.block{background:var(--surface);border:var(--border-width) solid var(--border);border-radius:var(--radius-2);box-shadow:var(--panel-shadow);backdrop-filter:var(--surface-filter);padding:var(--space-5)}.block{grid-column:1 / -1}.block-compact{grid-column:span 1;align-self:start}.block-metrics{grid-column:1 / -1;align-self:start;padding:0;overflow:hidden}.block-metrics h2{margin:0;padding:var(--space-5);border-bottom:var(--border-width) solid var(--box-grid-border)}.block-metrics .metric-row{border:0;border-radius:0;box-shadow:none}.block-metrics .metric{min-height:168px}.surface-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-4)}.three-pane{display:grid;grid-template-columns:260px minmax(360px,1fr) 300px;gap:var(--space-4);align-items:start}.split{display:grid;grid-template-columns:1fr 1fr;gap:var(--space-4)}.chip-row{display:flex;flex-wrap:wrap;gap:var(--space-2);align-items:center}.top-summary{align-self:stretch;display:grid;grid-template-columns:repeat(5,minmax(92px,1fr));gap:0;background:var(--box-grid-bg);border-left:var(--border-width) solid var(--box-grid-border);border-right:var(--border-width) solid var(--box-grid-border);overflow:hidden}.metric-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:0;align-items:stretch;background:var(--box-grid-bg);border:var(--border-width) solid var(--box-grid-border);border-radius:calc(var(--radius-2) + 10px);box-shadow:var(--panel-shadow);overflow:hidden}.metric{position:relative;display:grid;align-content:start;gap:14px;min-height:142px;background:transparent;border:0;border-radius:0;box-shadow:1px 0 0 var(--metric-divider),0 1px 0 var(--metric-divider);padding:var(--space-5);color:var(--text);text-decoration:none}.metric:hover{background:color-mix(in srgb,var(--accent),transparent 92%);text-decoration:none}.metric-label{color:var(--text-subtle);font-size:12px;font-weight:800;letter-spacing:.22em;text-transform:uppercase}.metric-state{display:flex;align-items:center;gap:10px;color:var(--text-muted);font-size:14px;font-weight:650}.metric-state i{display:inline-block;width:8px;height:8px;border-radius:999px;background:var(--metric-signal,var(--text-subtle));box-shadow:0 0 0 3px color-mix(in srgb,var(--metric-signal,var(--text-subtle)),transparent 82%)}.metric strong{font-size:36px;line-height:1;letter-spacing:0}.metric-info{--metric-signal:var(--info)}.metric-warning{--metric-signal:var(--warning)}.metric-danger{--metric-signal:var(--danger)}.metric-success{--metric-signal:var(--success)}.top-summary .metric{min-height:100%;min-width:0;gap:2px;background:transparent;border:0;border-radius:0;box-shadow:1px 0 0 var(--metric-divider);padding:var(--space-4) 14px;align-content:center}.top-summary .metric-label{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.top-summary .metric-state{display:none}.top-summary .metric strong{font-size:18px}.graph-surface{background:var(--surface);border:var(--border-width) solid var(--border);border-radius:var(--radius-2);box-shadow:var(--panel-shadow);backdrop-filter:var(--surface-filter);overflow:hidden}.graph-toolbar{display:grid;grid-template-columns:minmax(220px,1.6fr) repeat(4,minmax(120px,1fr));gap:var(--space-3);align-items:end;padding:var(--space-4) var(--space-5);background:var(--box-grid-bg);border-bottom:var(--border-width) solid var(--box-grid-border)}.graph-toolbar label{display:grid;gap:6px;color:var(--text-muted);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}.graph-toolbar select{width:100%;min-width:0}.graph-main{padding:0}.graph-footer{padding:var(--space-4) var(--space-5);border-top:var(--border-width) solid var(--border);background:var(--bg-subtle)}.graph-footer-node{display:flex;justify-content:space-between;gap:var(--space-5);align-items:center}.graph-footer-node h2{margin:0 0 4px;font-size:16px}.graph-footer-node p{margin:0;color:var(--text-muted);max-width:720px}.graph-footer-node .chip-row{justify-content:flex-end;flex-shrink:0}.health-surface{background:var(--surface);border:var(--border-width) solid var(--border);border-radius:var(--radius-2);box-shadow:var(--panel-shadow);backdrop-filter:var(--surface-filter);overflow:hidden}.health-kpis{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));background:var(--box-grid-bg);border-bottom:var(--border-width) solid var(--box-grid-border)}.health-kpis .metric{min-height:96px;border-radius:0;box-shadow:1px 0 0 var(--metric-divider);padding:var(--space-5) var(--space-6);align-content:center}.health-kpis .metric-label{letter-spacing:.08em}.health-kpis .metric-state{display:none}.health-kpis .metric strong{font-size:28px}.health-body{padding:var(--space-6)}.badge,.chip{display:inline-flex;align-items:center;min-height:24px;border-radius:999px;border:var(--border-width) solid var(--border);background:var(--badge-bg);color:var(--text);padding:3px 8px;font-size:12px;font-weight:650}.badge-status{border-color:color-mix(in srgb,var(--status-active),var(--border) 65%)}.status-proposed{color:var(--status-proposed)}.status-active{color:var(--status-active)}.status-in-progress{color:var(--status-in-progress)}.status-blocked{color:var(--danger);border-color:color-mix(in srgb,var(--danger),var(--border) 55%);background:color-mix(in srgb,var(--danger),var(--badge-bg) 86%)}.status-needs-review,.status-stale{color:var(--warning);border-color:color-mix(in srgb,var(--warning),var(--border) 55%);background:color-mix(in srgb,var(--warning),var(--badge-bg) 88%)}.status-completed,.status-resolved{color:var(--success);border-color:color-mix(in srgb,var(--success),var(--border) 60%);background:color-mix(in srgb,var(--success),var(--badge-bg) 88%)}.severity-fatal,.severity-error{border-left:3px solid var(--diagnostic-error)}.severity-warning{border-left:3px solid var(--diagnostic-warning)}.severity-info{border-left:3px solid var(--diagnostic-info)}.review-block{padding:0;overflow:hidden}.review-block h2{margin:0;font-size:18px}.review-header{display:flex;justify-content:space-between;gap:var(--space-4);align-items:stretch;background:var(--box-grid-bg);border-bottom:var(--border-width) solid var(--box-grid-border)}.review-header>div{padding:16px var(--space-5)}.review-count{display:grid;align-content:center;justify-items:center;min-width:86px;padding:12px var(--space-4);border-left:var(--border-width) solid var(--metric-divider);color:var(--text);text-decoration:none}.review-count:hover{background:color-mix(in srgb,var(--accent),transparent 92%);text-decoration:none}.review-count strong{font-size:24px;line-height:1}.review-list{display:grid}.review-row{display:grid;grid-template-columns:28px minmax(0,1fr) var(--review-status-w,max-content) var(--review-type-w,max-content) var(--review-score-w,max-content) var(--review-health-w,max-content) var(--review-tags-w,max-content);gap:var(--space-3);align-items:center;min-height:58px;padding:10px var(--space-5) 10px 12px;border-bottom:var(--border-width) solid var(--border);color:var(--text);text-decoration:none}.review-row:last-child{border-bottom:0}.review-row:hover{background:color-mix(in srgb,var(--accent),transparent 94%);text-decoration:none}.review-marker{justify-self:center;width:8px;height:8px;border-radius:999px;color:var(--status-active);background:currentColor;box-shadow:0 0 0 3px color-mix(in srgb,currentColor,transparent 84%)}.review-marker.status-draft{color:var(--status-draft)}.review-marker.status-proposed{color:var(--status-proposed)}.review-marker.status-active{color:var(--status-active)}.review-marker.status-accepted{color:var(--status-accepted)}.review-marker.status-in-progress{color:var(--status-in-progress)}.review-marker.status-blocked{color:var(--danger)}.review-marker.status-needs-review{color:var(--warning)}.review-marker.status-stale{color:var(--warning)}.review-marker.status-completed{color:var(--success)}.review-marker.status-resolved{color:var(--success)}.review-marker.status-rejected{color:var(--status-rejected)}.review-marker.status-superseded{color:var(--status-superseded)}.review-marker.status-archived{color:var(--status-archived)}.review-main{min-width:0}.review-main strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.review-main small{display:block;margin-top:3px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.review-status,.review-type,.review-score,.review-health,.review-tags{min-width:0;color:var(--text-subtle);font-size:12px}.review-status{justify-self:stretch;display:flex;justify-content:center}.review-type,.review-score{text-align:left;white-space:nowrap}.review-health{min-height:22px}.review-tags{display:flex;gap:var(--space-2);justify-content:flex-end;overflow:hidden}.review-tag,.review-signal{display:inline-flex;align-items:center;min-height:22px;border-radius:999px;background:var(--bg-subtle);border:var(--border-width) solid var(--border);padding:2px 7px;color:var(--text-muted);font-size:11px;font-weight:700;white-space:nowrap}.review-signal-warning{color:var(--warning);border-color:color-mix(in srgb,var(--warning),var(--border) 55%)}.overview-brief{padding:var(--space-5);display:grid;gap:var(--space-4)}.overview-brief p{margin:0;color:var(--text);font-size:16px}.review-risk .review-header{box-shadow:inset 3px 0 0 var(--danger)}.review-decision .review-header{box-shadow:inset 3px 0 0 var(--status-proposed)}.review-question .review-header{box-shadow:inset 3px 0 0 var(--warning)}.review-attention .review-header{box-shadow:inset 3px 0 0 var(--accent)}.review-completed .review-header{box-shadow:inset 3px 0 0 var(--success)}.review-brief .review-header{box-shadow:inset 3px 0 0 var(--info)}.card-list{display:grid;gap:var(--space-3)}.node-card{display:block;background:var(--card-bg);border:var(--border-width) solid var(--card-border);border-radius:var(--radius-2);box-shadow:var(--card-shadow);padding:var(--space-3);color:var(--text)}.card-title{display:inline-block;color:var(--text)}.node-card p{margin:6px 0;color:var(--text-muted)}.node-card small,td small{display:block;color:var(--text-subtle);margin-top:4px}.kanban{display:grid;grid-template-columns:repeat(6,minmax(220px,1fr));gap:var(--space-3);overflow:auto}.kanban-column{position:relative;min-width:220px;background:var(--kanban-column-bg);border:var(--border-width) solid var(--border);border-radius:var(--radius-2);box-shadow:var(--card-shadow);overflow:hidden;padding:var(--space-3)}.kanban-column::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--column-accent,var(--border-strong))}.column-proposed{--column-accent:var(--status-proposed)}.column-active{--column-accent:var(--status-active)}.column-in-progress{--column-accent:var(--status-in-progress)}.column-blocked{--column-accent:var(--status-blocked)}.column-needs-review{--column-accent:var(--status-needs-review)}.column-done{--column-accent:var(--status-completed)}.column-archived{--column-accent:var(--status-archived)}.kanban-column h2{position:relative;display:flex;justify-content:space-between;font-size:14px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:var(--border-width) solid var(--border);padding:10px;vertical-align:top}th{color:var(--text-muted);font-size:12px;text-transform:uppercase}.filters,.toolbar{display:flex;flex-wrap:wrap;gap:var(--space-2);margin-bottom:var(--space-4)}input,select,.button{min-height:36px;border:var(--border-width) solid var(--border-strong);border-radius:var(--radius-1);background:var(--control-bg);color:var(--text);padding:0 10px;font:inherit}.button{display:inline-flex;align-items:center}.danger{color:var(--danger)}.field-label{display:block;margin:var(--space-3) 0 var(--space-1);font-size:12px;color:var(--text-muted);font-weight:700}.diagnostic-list{display:grid;gap:var(--space-2)}.diagnostic{background:var(--bg-subtle);border:var(--border-width) solid var(--border);border-radius:var(--radius-1);padding:var(--space-3)}.diagnostic p{margin:6px 0}.node-detail{max-width:1080px;margin:0 auto;padding:0;overflow:hidden}.node-hero{display:flex;justify-content:space-between;gap:var(--space-5);align-items:flex-start;padding:var(--space-6) var(--space-6) var(--space-5);border-bottom:var(--border-width) solid var(--border)}.node-hero h2{margin:var(--space-3) 0 var(--space-1);font-size:28px;line-height:1.15}.node-id{margin:0;color:var(--text-subtle);font-family:var(--font-mono);font-size:13px}.node-meta-line{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:var(--space-3);color:var(--text-muted);font-size:13px}.node-meta-line span{white-space:nowrap}.node-hero-actions{display:flex;gap:var(--space-2);flex-wrap:wrap;justify-content:flex-end}.node-summary{margin:0;padding:var(--space-5) var(--space-6);font-size:18px;line-height:1.55;color:var(--text);background:var(--bg-subtle);border-bottom:var(--border-width) solid var(--border)}.node-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-bottom:var(--border-width) solid var(--box-grid-border);background:var(--box-grid-bg)}.node-kpi{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);min-height:56px;padding:12px var(--space-5);color:var(--text);box-shadow:1px 0 0 var(--metric-divider);text-decoration:none}.node-kpi:hover{background:color-mix(in srgb,var(--accent),transparent 92%);text-decoration:none}.node-kpi span{color:var(--text-muted);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}.node-kpi strong{font-size:22px;line-height:1}.node-sections{display:grid;padding:var(--space-2) var(--space-6) var(--space-6)}.node-section{padding:var(--space-5) 0}.node-section+.node-section{padding-top:var(--space-4)}.node-section header{margin-bottom:var(--space-3)}.node-section header h3{margin:0;font-size:18px;color:var(--text);letter-spacing:0;text-transform:none}.node-section-body{min-width:0}.evidence-list{display:grid}.evidence-row,.diagnostic-row{display:grid;gap:var(--space-3);align-items:start;padding:12px 0;border-bottom:var(--border-width) solid var(--border);color:var(--text);text-decoration:none}.evidence-row{grid-template-columns:10px minmax(0,1fr)}.evidence-marker{width:8px;height:8px;margin-top:6px;border-radius:999px;background:var(--success);box-shadow:0 0 0 3px color-mix(in srgb,var(--success),transparent 84%)}.evidence-main,.diagnostic-main{min-width:0}.evidence-main strong,.diagnostic-main strong{display:block}.evidence-main small,.diagnostic-main small{display:block;margin-top:3px;color:var(--text-muted)}.evidence-main code{display:inline-block;max-width:100%;margin-top:6px;color:var(--text-subtle);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.diagnostic-list{display:grid}.diagnostic-row{grid-template-columns:92px minmax(0,1fr)}.diagnostic-row:hover{background:color-mix(in srgb,var(--accent),transparent 94%);text-decoration:none}.diagnostic-severity{width:max-content;border-radius:999px;padding:3px 8px;background:var(--badge-bg);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.severity-warning .diagnostic-severity{color:var(--warning)}.severity-fatal .diagnostic-severity,.severity-error .diagnostic-severity{color:var(--danger)}.severity-info .diagnostic-severity{color:var(--info)}.activity-table{display:grid}.activity-row{display:grid;grid-template-columns:96px minmax(120px,170px) minmax(0,1fr) minmax(80px,120px);gap:var(--space-3);align-items:center;min-height:34px;padding:5px 0;border-bottom:var(--border-width) solid var(--border);font-size:13px}.activity-row time{color:var(--text-muted);white-space:nowrap}.activity-row strong,.activity-row span,.activity-row em{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.activity-row strong{font-weight:650}.activity-row span{color:var(--text-muted)}.activity-row em{color:var(--text-subtle);font-style:normal;text-align:right}.relationship-index{display:grid;gap:var(--space-2)}.relationship-count{margin:0;color:var(--text-muted);font-size:13px}.relationship-list{}.relationship-row{display:grid;grid-template-columns:44px minmax(96px,140px) minmax(0,1fr) max-content;gap:var(--space-3);align-items:center;min-height:42px;padding:6px 0;border-bottom:var(--border-width) solid var(--border);color:var(--text);text-decoration:none}.relationship-row:hover{background:color-mix(in srgb,var(--accent),transparent 94%);text-decoration:none}.relationship-direction{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:22px;border-radius:999px;background:var(--bg-subtle);color:var(--text-muted);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em}.relationship-rel{color:var(--text-muted);font-family:var(--font-mono);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.relationship-node{min-width:0}.relationship-node strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.relationship-status{justify-self:end}.node-section ul{margin:0;padding-left:18px}.node-section li+li{margin-top:7px}.action-bar{display:flex;flex-wrap:wrap;gap:var(--space-2)}.raw-panel{margin:0 var(--space-6) var(--space-6);border-top:var(--border-width) solid var(--border);padding-top:var(--space-4)}.detail-header{display:flex;justify-content:space-between;gap:var(--space-4)}dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 12px}dt{color:var(--text-muted)}dd{margin:0}.graph-wrap{min-height:520px}.graph-svg{display:block;width:100%;height:520px;background:var(--bg-subtle);border:0;border-radius:0}.graph-svg line{stroke:var(--graph-edge-color);stroke-width:1.5}.graph-svg circle{fill:var(--graph-node-bg);stroke:var(--border-strong);stroke-width:2}.graph-svg .focus circle{stroke:var(--graph-focus-color);stroke-width:4}.graph-svg text{fill:var(--text-muted);font-size:11px;text-anchor:middle}.empty{max-width:560px;background:var(--surface);border:var(--border-width) solid var(--border);border-radius:var(--radius-2);padding:var(--space-6)}.muted{color:var(--text-muted)}.unsupported{border-color:var(--warning)}
.prose{display:grid;gap:var(--space-3);max-width:78ch}.prose h4{margin:var(--space-3) 0 0;color:var(--text);font-size:15px;font-weight:800}.prose h4:first-child{margin-top:0}.prose p{margin:0;color:var(--text);line-height:1.62}.prose ul,.prose ol{margin:0;padding-left:22px;color:var(--text);line-height:1.55}.prose li+li{margin-top:6px}.prose code{padding:1px 5px;border:var(--border-width) solid var(--border);border-radius:var(--radius-1);background:var(--bg-subtle);font-size:12px}
.callout{border-left:3px solid var(--info);background:color-mix(in srgb,var(--info),var(--surface) 94%)}.callout-success{border-left-color:var(--success);background:color-mix(in srgb,var(--success),var(--surface) 94%)}.callout-warning{border-left-color:var(--warning);background:color-mix(in srgb,var(--warning),var(--surface) 94%)}.callout-danger{border-left-color:var(--danger);background:color-mix(in srgb,var(--danger),var(--surface) 94%)}.callout-neutral{border-left-color:var(--border-strong)}.checklist{display:grid;gap:8px;list-style:none;margin:0;padding:0}.checklist li{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;align-items:start;margin:0}.checkmark{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;border:var(--border-width) solid var(--border-strong);color:var(--success);font-size:12px;font-weight:800;background:var(--bg-subtle)}.timeline{display:grid;border-left:var(--border-width) solid var(--border);margin-left:8px}.timeline-row{display:grid;grid-template-columns:minmax(96px,150px) minmax(0,1fr);gap:6px var(--space-3);position:relative;padding:0 0 var(--space-4) var(--space-4)}.timeline-row::before{content:"";position:absolute;left:-5px;top:5px;width:9px;height:9px;border-radius:999px;background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent),transparent 84%)}.timeline-row time{color:var(--text-muted);font-size:12px}.timeline-row strong{min-width:0}.timeline-row p{grid-column:2;margin:0;color:var(--text-muted)}
:root[data-density="compact"] .route-root{padding:var(--space-4)}:root[data-density="compact"] .surface,:root[data-density="compact"] .panel,:root[data-density="compact"] .block{padding:var(--space-3)}:root[data-density="compact"] .node-card{padding:var(--space-2)}
@media(max-width:1000px){.awg-app{grid-template-columns:1fr}.sidebar{position:static;height:auto}.block-metrics,.block-compact{grid-column:1 / -1}.three-pane,.split,.relationship-index,.graph-toolbar{grid-template-columns:1fr}.graph-footer-node{display:grid}.graph-footer-node .chip-row{justify-content:flex-start}.kanban{grid-template-columns:repeat(3,minmax(220px,1fr))}.topbar{display:block;padding:var(--space-5) var(--space-6)}.topbar>div:first-child{padding:0}.top-summary{margin-top:var(--space-3);border:var(--border-width) solid var(--box-grid-border);border-radius:var(--radius-2)}.health-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:760px){.review-row{grid-template-columns:10px minmax(0,1fr);align-items:start}.review-status,.review-type,.review-score,.review-health,.review-tags{grid-column:2;justify-self:start}.review-tags{justify-content:flex-start;flex-wrap:wrap}.review-header{display:grid}.review-count{border-left:0;border-top:var(--border-width) solid var(--metric-divider);justify-items:start}}
@media(max-width:640px){.route-root,.topbar,.sidebar{padding:var(--space-4)}.surface-grid{grid-template-columns:1fr}.kanban,.node-kpis,.relationship-row,.health-kpis{grid-template-columns:1fr}.node-hero{display:grid;padding:var(--space-5)}.node-hero-actions,.relationship-status{justify-content:flex-start;justify-self:start}.node-summary,.node-sections{padding:var(--space-5)}.raw-panel{margin:0 var(--space-5) var(--space-5)}h1{font-size:24px}}
`;
}
