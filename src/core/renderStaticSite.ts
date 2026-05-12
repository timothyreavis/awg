import type { CompiledGraph, CurrentViewOutput, DiagnosticsReport } from "./types.js";

export function renderStaticSite(graph: CompiledGraph, view: CurrentViewOutput, diagnostics: DiagnosticsReport): { html: string; js: string; css: string } {
  const data = JSON.stringify({ graph, view, diagnostics }).replace(/</g, "\\u003c");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AWG Current Review</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <header>
    <p class="eyebrow">Agent Work Graph</p>
    <h1>Current Review</h1>
    <div id="health"></div>
  </header>
  <main>
    <section id="blocks"></section>
    <section>
      <h2>Node Browser</h2>
      <div class="layout">
        <table id="nodes"><thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Importance</th></tr></thead><tbody></tbody></table>
        <article id="detail"></article>
      </div>
    </section>
  </main>
  <script>window.AWG_DATA = ${data};</script>
  <script src="./app.js"></script>
</body>
</html>
`;
  const js = `"use strict";
const data = window.AWG_DATA;
const graph = data.graph;
const diagnostics = data.diagnostics;
const byId = new Map(graph.nodes.map((node) => [node.id, node]));
const links = new Map();
for (const edge of graph.edges) {
  links.set(edge.from, [...(links.get(edge.from) || []), edge]);
  links.set(edge.to, [...(links.get(edge.to) || []), edge]);
}
document.getElementById("health").innerHTML = [
  ["Nodes", diagnostics.summary.node_count],
  ["Edges", diagnostics.summary.edge_count],
  ["Warnings", diagnostics.summary.warning_count],
  ["Fatal", diagnostics.summary.fatal_error_count]
].map(([label, value]) => '<span class="pill">' + label + ': ' + value + '</span>').join("");
const blocks = document.getElementById("blocks");
for (const block of data.view.blocks.filter((b) => b.type !== "node-list")) {
  const section = document.createElement("section");
  const items = block.items || [];
  section.innerHTML = '<h2>' + escapeHtml(block.title) + '</h2>' + (items.length ? '<ul>' + items.slice(0, 12).map(renderNodeLine).join("") + '</ul>' : '<p class="muted">' + renderSummary(block.summary) + '</p>');
  blocks.appendChild(section);
}
const tbody = document.querySelector("#nodes tbody");
for (const node of graph.nodes) {
  const tr = document.createElement("tr");
  tr.innerHTML = '<td>' + escapeHtml(node.title) + '</td><td>' + escapeHtml(node.type) + '</td><td>' + escapeHtml(node.status) + '</td><td>' + node.importance + '</td>';
  tr.addEventListener("click", () => selectNode(node.id));
  tbody.appendChild(tr);
}
if (graph.nodes[0]) selectNode(graph.nodes[0].id);
function selectNode(id) {
  const node = byId.get(id);
  const edges = links.get(id) || [];
  document.getElementById("detail").innerHTML = '<h2>' + escapeHtml(node.title) + '</h2><p><code>' + escapeHtml(node.id) + '</code></p><p>' + escapeHtml(node.summary) + '</p><dl><dt>Type</dt><dd>' + escapeHtml(node.type) + '</dd><dt>Status</dt><dd>' + escapeHtml(node.status) + '</dd><dt>Confidence</dt><dd>' + node.confidence + '</dd></dl><h3>Edges</h3>' + (edges.length ? '<ul>' + edges.map((edge) => '<li><code>' + escapeHtml(edge.rel) + '</code> ' + escapeHtml(edge.from === id ? edge.to : edge.from) + '</li>').join("") + '</ul>' : '<p class="muted">No edges.</p>');
}
function renderNodeLine(node) { return '<li><button type="button" data-id="' + escapeHtml(node.id) + '" onclick="selectNode(this.dataset.id)">' + escapeHtml(node.title) + '</button> <span class="muted">' + escapeHtml(node.status) + '</span></li>'; }
function renderSummary(value) { return value ? escapeHtml(JSON.stringify(value)) : "No items."; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
`;
  const css = `:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;line-height:1.45}body{margin:0;background:#f7f7f4;color:#20201d}header,main{max-width:1120px;margin:0 auto;padding:28px}header{border-bottom:1px solid #d9d8d0}.eyebrow{margin:0 0 6px;color:#62645f;text-transform:uppercase;font-size:12px;letter-spacing:.08em}h1{font-size:34px;margin:0 0 18px}h2{font-size:18px;margin:0 0 12px}section{margin:24px 0}.pill{display:inline-block;margin:0 8px 8px 0;padding:5px 9px;border:1px solid #c9c8be;border-radius:999px;background:#fff}ul{padding-left:20px}.muted{color:#656762}button{border:0;background:transparent;color:#135e96;text-decoration:underline;cursor:pointer;font:inherit;padding:0}.layout{display:grid;grid-template-columns:1.2fr .8fr;gap:20px;align-items:start}table{width:100%;border-collapse:collapse;background:#fff}th,td{border-bottom:1px solid #deddd4;padding:9px;text-align:left}tr{cursor:pointer}tr:hover{background:#f0f4f8}article{background:#fff;border:1px solid #deddd4;padding:18px;min-height:220px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}@media(max-width:800px){header,main{padding:18px}.layout{grid-template-columns:1fr}table{font-size:14px}}@media(prefers-color-scheme:dark){body{background:#181916;color:#eee}.pill,table,article{background:#22231f;border-color:#3a3b35}th,td{border-color:#3a3b35}.muted{color:#aaa}button{color:#8bbbe8}tr:hover{background:#262b30}header{border-color:#3a3b35}}`;
  return { html, js, css };
}
