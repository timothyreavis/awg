export type AwgKind = "node" | "edge" | "event" | "view" | "lens" | "response" | "policy";

export interface AwgBase {
  awg: string;
  kind: AwgKind;
  id?: string;
  [key: `x-${string}`]: unknown;
  [key: string]: unknown;
}

export interface AwgNode extends AwgBase {
  kind: "node";
  id: string;
  type: string;
  title: string;
  summary: string;
  status: string;
  importance: number;
  confidence: number;
  created_at: string;
  updated_at: string;
  tags?: string[];
  aliases?: string[];
  evidence?: unknown[];
  review_after?: string;
  superseded_by?: string;
}

export interface AwgEdge extends AwgBase {
  kind: "edge";
  id: string;
  from: string;
  rel: string;
  to: string;
  created_at: string;
  reason?: string;
  confidence?: number;
  created_by?: string;
}

export interface AwgEvent extends AwgBase {
  kind: "event";
  type: string;
  target: string;
  by: string;
  at: string;
}

export interface AwgView extends AwgBase {
  kind: "view";
  id: string;
  title: string;
  audience: string;
  blocks: unknown[];
}

export interface AwgLens extends AwgBase {
  kind: "lens";
  id: string;
  title: string;
  purpose: string;
  include: unknown[];
}

export interface AwgResponse extends AwgBase {
  kind: "response";
  id: string;
  type: string;
  target: string;
  summary: string;
  by: string;
  at: string;
}

export interface AwgPolicy extends AwgBase {
  kind: "policy";
  id: string;
  title: string;
  summary: string;
  status: string;
}

export type AwgObject = AwgNode | AwgEdge | AwgEvent | AwgView | AwgLens | AwgResponse | AwgPolicy;

export interface RawLogEntry {
  file: string;
  line: number;
  raw: string;
}

export type DiagnosticSeverity = "fatal" | "warning" | "info";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  file?: string;
  line?: number;
  id?: string;
}

export interface DiagnosticsSummary {
  ok: boolean;
  fatal_error_count: number;
  warning_count: number;
  node_count: number;
  edge_count: number;
  orphan_node_count: number;
  stale_node_count: number;
  unverified_completion_count: number;
  dangling_edge_count: number;
  unanswered_question_count: number;
}

export interface DiagnosticsReport {
  awg: string;
  generated_at: string;
  summary: DiagnosticsSummary;
  diagnostics: Diagnostic[];
}

export interface BuildResult {
  graph: CompiledGraph;
  diagnostics: DiagnosticsReport;
  resumeLens: ResumeLensOutput;
  currentView: CurrentViewOutput;
}

export interface CompiledGraph {
  awg: string;
  generated_at: string;
  source: { log_files: string[]; entry_count: number };
  stats: Record<string, number>;
  nodes: AwgNode[];
  edges: AwgEdge[];
  events: AwgEvent[];
  views: AwgView[];
  lenses: AwgLens[];
  responses: AwgResponse[];
  policies: AwgPolicy[];
  diagnostics: DiagnosticsReport;
}

export interface ResumeLensOutput {
  awg: string;
  kind: "lens-output";
  id: "lens:resume";
  generated_at: string;
  summary: string;
  important: AwgNode[];
  open_decisions: AwgNode[];
  active_tasks: AwgNode[];
  active_risks: AwgNode[];
  unanswered_questions: AwgNode[];
  recent_responses: AwgResponse[];
  diagnostics_summary: DiagnosticsSummary;
  recommended_maintenance: string[];
}

export interface CurrentViewOutput {
  awg: string;
  kind: "view-output";
  id: "v:current";
  generated_at: string;
  title: "Current Review";
  blocks: Array<{ type: string; title: string; items?: unknown[]; summary?: unknown }>;
}
