"use strict";
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
