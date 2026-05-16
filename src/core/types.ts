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
  anchors?: AwgAnchor[];
  body?: string;
  fields?: Record<string, unknown>;
  blocks?: AwgPresentationBlock[];
  freshness?: AwgFreshness;
  review_after?: string;
  superseded_by?: string;
}

export interface AwgFreshness {
  state?: "current" | "historical" | "proposed" | "superseded" | "stale" | "needs_review" | "unknown" | "not_applicable";
  last_verified?: string;
  review_after?: string;
  verified_by?: string;
  source_of_truth?: string;
  stale_reason?: string;
  supersedes?: string[];
  superseded_by?: string;
  superseded_at?: string;
  [key: string]: unknown;
}

export interface AwgPresentationBlock {
  schemaVersion: 1;
  type:
    | "brief"
    | "callout"
    | "metric-row"
    | "table"
    | "checklist"
    | "timeline"
    | "node-list"
    | string;
  title?: string;
  summary?: string;
  tone?: "info" | "success" | "warning" | "danger" | "neutral" | string;
  data: unknown;
  sourceNodeIds?: string[];
  targetNodeIds?: string[];
  [key: string]: unknown;
}

export type AwgViewAudience = "human" | "agent" | "reviewer" | string;

export interface AwgAnchor {
  kind: "file" | "symbol" | "url" | "command" | "doc" | "external";
  path?: string;
  name?: string;
  url?: string;
  label?: string;
}

export interface OperatingTemplateSummary {
  id: string;
  title: string;
  summary: string;
  status: string;
  type: string;
  scope: string;
  selectorKey: string;
  appliesTo: Record<string, unknown>;
  sectionIds: string[];
  missingSections: string[];
  needsReview: boolean;
  humanReviewRequired: boolean;
  humanApproved: boolean;
  updated_at: string;
}

export interface OperatingTemplateWarning {
  code: string;
  severity: DiagnosticSeverity;
  message: string;
  nodeIds?: string[];
  suggestedCommands?: string[];
}

export interface OperatingTemplateConflict {
  scope: string;
  selectorKey: string;
  templateIds: string[];
  message: string;
}

export interface OperatingTemplateMissingSection {
  templateId: string;
  section: string;
  required: boolean;
  severity: DiagnosticSeverity;
}

export interface OperatingTemplateIndex {
  ok: boolean;
  activeTemplateId: string | null;
  selectedTemplate: OperatingTemplateSummary | null;
  activeTemplates: OperatingTemplateSummary[];
  rootsByScope: Record<string, string[]>;
  missingSections: OperatingTemplateMissingSection[];
  conflicts: OperatingTemplateConflict[];
  warnings: OperatingTemplateWarning[];
  suggestedCommands: string[];
}

export interface AnchorIndexEntry {
  key: string;
  kind: AwgAnchor["kind"];
  value: string;
  nodeIds: string[];
}

export interface AnchorIndex {
  entries: AnchorIndexEntry[];
  byKind: Record<string, AnchorIndexEntry[]>;
  byNodeId: Record<string, AnchorIndexEntry[]>;
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
  id?: string;
  type: string;
  target: string;
  by: string;
  at: string;
}

export interface AwgView extends AwgBase {
  kind: "view";
  id: string;
  title: string;
  audience?: AwgViewAudience;
  summary?: string;
  blocks?: AwgPresentationBlock[];
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface AwgLens extends AwgBase {
  kind: "lens";
  id: string;
  title: string;
  purpose: string;
  summary?: string;
  status?: "active" | "proposed" | "needs_review" | "archived" | string;
  scope?: "vault" | "project" | "workflow" | string;
  audience?: "agent" | "human" | "reviewer" | string;
  selector?: Record<string, unknown>;
  sections?: AwgLensSection[];
  budget?: Record<string, unknown>;
  review?: Record<string, unknown>;
  tags?: string[];
  include?: unknown[];
  created_at?: string;
  updated_at?: string;
}

export interface AwgLensSection {
  id?: string;
  title?: string;
  source: string;
  query?: Record<string, unknown>;
  nodeIds?: string[];
  edgeIds?: string[];
  runIds?: string[];
  viewId?: string;
  text?: string;
  items?: unknown[];
  limit?: number;
  priority?: number;
  includeBody?: boolean;
  required?: boolean;
  [key: string]: unknown;
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
  fixSuggestion?: unknown;
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
  active_run_count?: number;
  stale_run_count?: number;
}

export interface DiagnosticsReport {
  awg: string;
  generated_at: string;
  summary: DiagnosticsSummary;
  diagnostics: Diagnostic[];
}

export type MaintenanceInboxKind =
  | "stale"
  | "needs_review"
  | "duplicates"
  | "orphans"
  | "evidence"
  | "questions"
  | "risks"
  | "blockers"
  | "decisions"
  | "topology"
  | "hygiene";

export type MaintenanceInboxSeverity = "info" | "warning" | "error";

export interface MaintenanceInboxItem {
  id: string;
  kind: MaintenanceInboxKind;
  code: string;
  severity: MaintenanceInboxSeverity;
  priority: number;
  message: string;
  nodeIds: string[];
  edgeIds: string[];
  runIds: string[];
  vaultIds: string[];
  relationshipIds: string[];
  reasons: string[];
  suggestedCommands: string[];
  autonomousSafe: boolean;
  needsHumanReview: boolean;
}

export interface MaintenanceInbox {
  awg: string;
  generated_at: string;
  items: MaintenanceInboxItem[];
  summary: {
    total: number;
    byKind: Record<string, number>;
    bySeverity: Record<string, number>;
    highPriority: number;
  };
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
  run_summaries?: unknown[];
  operating_templates?: OperatingTemplateIndex;
  anchor_index?: AnchorIndex;
  topology?: unknown;
  maintenance_inbox?: MaintenanceInbox;
  authored_views?: AuthoredViewOutput[];
  lens_index?: LensIndex;
}

export interface LensIndexEntry {
  id: string;
  title: string;
  purpose?: string;
  summary?: string;
  status: string;
  scope: string;
  audience: string;
  tags: string[];
  selector?: Record<string, unknown>;
  sectionCount: number;
  needsReview: boolean;
  updated_at?: string;
}

export interface LensIndex {
  awg: string;
  kind: "lens-index";
  generated_at: string;
  lenses: LensIndexEntry[];
}

export interface AuthoredViewOutput {
  awg: string;
  kind: "view-output";
  id: string;
  generated_at: string;
  title: string;
  summary?: string;
  audience: string;
  tags?: string[];
  blocks: AwgPresentationBlock[];
  source: { kind: "view"; id: string };
  diagnostics: Diagnostic[];
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
  maintenance_inbox?: MaintenanceInboxItem[];
}

export interface CurrentViewOutput {
  awg: string;
  kind: "view-output";
  id: "v:current";
  generated_at: string;
  title: "Current Review";
  blocks: Array<{ type: string; title: string; items?: unknown[]; summary?: unknown }>;
}
