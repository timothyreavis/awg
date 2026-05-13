import type { AwgNode, CompiledGraph } from "./types.js";

export interface SearchOptions {
  type?: string;
  status?: string;
  tag?: string;
  limit?: number;
}

export interface SearchResult {
  id: string;
  type: string;
  title: string;
  summary: string;
  status: string;
  score: number;
  matches: string[];
  updated_at?: string;
}

const inactive = new Set(["archived", "completed", "rejected", "resolved", "superseded"]);

export function searchGraph(graph: CompiledGraph, query: string, options: SearchOptions = {}): SearchResult[] {
  const q = normalize(query);
  const terms = q.split(/\s+/).filter(Boolean);
  const queryMatchesInactive = [...inactive].some((status) => normalize(status).includes(q));
  const asOf = Date.parse(graph.generated_at);
  const out: SearchResult[] = [];
  for (const node of graph.nodes) {
    if (options.type && node.type !== options.type) continue;
    if (options.status && node.status !== options.status) continue;
    if (options.tag && !(node.tags ?? []).includes(options.tag)) continue;
    const scored = scoreNode(node, q, terms, queryMatchesInactive, Number.isFinite(asOf) ? asOf : 0);
    if (q && scored.matches.length === 0) continue;
    if (scored.score <= 0 && q) continue;
    out.push(scored);
  }
  out.sort((a, b) => b.score - a.score || (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || a.id.localeCompare(b.id));
  return out.slice(0, Math.max(1, options.limit ?? 20));
}

function scoreNode(node: AwgNode, q: string, terms: string[], queryMatchesInactive: boolean, asOf: number): SearchResult {
  let score = 0;
  const matches = new Set<string>();
  const add = (field: string, value: unknown, exact: number, partial: number) => {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item !== "string") continue;
      const normalized = normalize(item);
      if (!normalized) continue;
      if (q && normalized === q) {
        score += exact;
        matches.add(field);
      } else if (q && normalized.includes(q)) {
        score += partial;
        matches.add(field);
      } else if (terms.length && terms.some((term) => normalized.includes(term))) {
        score += Math.max(1, Math.floor(partial / 2));
        matches.add(field);
      }
    }
  };
  add("id", node.id, 1000, 450);
  add("slug", node.slug, 950, 400);
  add("title", node.title, 700, 320);
  add("summary", node.summary, 360, 140);
  add("tag", node.tags, 240, 100);
  add("type", node.type, 180, 80);
  add("status", node.status, 160, 70);
  const anchors = Array.isArray(node.anchors) ? node.anchors : [];
  for (const anchor of anchors) add("anchors", [anchor.path, anchor.name, anchor.url, anchor.label], 220, 90);
  score += Math.round((node.importance ?? 0) * 80);
  const updated = Date.parse(node.updated_at);
  if (Number.isFinite(updated) && asOf > 0) score += Math.max(0, 40 - Math.floor((asOf - updated) / 86_400_000 / 7));
  if (!queryMatchesInactive && inactive.has(node.status)) score -= 60;
  if (!inactive.has(node.status)) score += 35;
  return { id: node.id, type: node.type, title: node.title, summary: node.summary, status: node.status, score, matches: [...matches].sort(), updated_at: node.updated_at };
}

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase().trim();
}
