import type {
  AwgNode,
  OperatingTemplateConflict,
  OperatingTemplateIndex,
  OperatingTemplateMissingSection,
  OperatingTemplateSummary,
  OperatingTemplateWarning
} from "./types.js";

const TEMPLATE_TAGS = new Set(["template", "operating-template", "template:operating"]);
const ACTIVE_TEMPLATE_STATUSES = new Set(["active", "accepted"]);
const REQUIRED_SECTIONS = ["purpose", "taxonomy", "freshness_rules", "agent_rules"];

export function buildOperatingTemplateIndex(nodes: AwgNode[], goal?: string): OperatingTemplateIndex {
  const templates = nodes.filter(isTemplateNode).sort(templateSort);
  const activeTemplates = templates.filter((node) => ACTIVE_TEMPLATE_STATUSES.has(node.status)).map(templateSummary);
  const selectedTemplate = selectTemplate(activeTemplates, goal);
  const missingSections = activeTemplates.flatMap(missingRecommendedSections);
  const conflicts = findTemplateConflicts(activeTemplates);
  const warnings: OperatingTemplateWarning[] = [
    ...(!activeTemplates.length ? [{
      code: "AWG_TEMPLATE_NO_ACTIVE_TEMPLATE",
      severity: "warning" as const,
      message: "No active operating template is available for this vault.",
      suggestedCommands: ["awg add node --type process --title \"Operating template\" --summary \"...\" --status active --tag operating-template"]
    }] : []),
    ...missingSections.map((item) => ({
      code: "AWG_TEMPLATE_MISSING_SECTION",
      severity: item.severity,
      message: `Operating template ${item.templateId} is missing ${item.section}.`,
      nodeIds: [item.templateId],
      suggestedCommands: [`awg update node ${item.templateId} --field ${item.section}=...`]
    })),
    ...activeTemplates.filter((template) => template.needsReview).map((template) => ({
      code: "AWG_TEMPLATE_NEEDS_REVIEW",
      severity: "warning" as const,
      message: `Operating template ${template.id} needs human review before it should be treated as settled.`,
      nodeIds: [template.id],
      suggestedCommands: [`awg update node ${template.id} --field review_state=reviewed --field human_approved=true`]
    }))
  ];

  const unresolvedReviewCount = activeTemplates.filter((template) => template.needsReview).length;
  return {
    ok: activeTemplates.length > 0 && conflicts.length === 0 && missingSections.length === 0 && unresolvedReviewCount === 0,
    activeTemplateId: selectedTemplate?.id ?? activeTemplates[0]?.id ?? null,
    selectedTemplate: selectedTemplate ?? null,
    activeTemplates,
    rootsByScope: groupByScope(activeTemplates),
    missingSections,
    conflicts,
    warnings,
    suggestedCommands: ["awg template status --json", "awg search operating-template", "awg lens task --goal \"template governance\""]
  };
}

export function isTemplateNode(node: AwgNode): boolean {
  const tags = node.tags ?? [];
  return node.type === "template" || tags.some((tag) => TEMPLATE_TAGS.has(tag));
}

export function templateSummary(node: AwgNode): OperatingTemplateSummary {
  const fields = safeFields(node);
  const appliesTo = objectField(fields.appliesTo) ?? objectField(fields.applies_to) ?? {};
  const sections = sectionIds(fields);
  const missingSections = REQUIRED_SECTIONS.filter((section) => !hasSection(fields, sections, section));
  const reviewState = stringField(fields.review_state) ?? stringField(fields.reviewState);
  const humanApproved = fields.human_approved === true || fields.humanApproved === true;
  const humanReviewRequired = fields.human_review_required === true || fields.humanReviewRequired === true;
  return {
    id: node.id,
    title: node.title,
    summary: node.summary,
    status: node.status,
    type: node.type,
    scope: stringField(fields.scope) ?? "vault",
    selectorKey: selectorKey(appliesTo),
    appliesTo,
    sectionIds: sections,
    missingSections,
    needsReview: ["draft", "needs_review", "proposed", "unreviewed"].includes(String(reviewState ?? node.status)) || humanReviewRequired && !humanApproved,
    humanReviewRequired,
    humanApproved,
    updated_at: node.updated_at
  };
}

function templateSort(a: AwgNode, b: AwgNode): number {
  return Number(ACTIVE_TEMPLATE_STATUSES.has(b.status)) - Number(ACTIVE_TEMPLATE_STATUSES.has(a.status))
    || b.importance - a.importance
    || b.updated_at.localeCompare(a.updated_at)
    || a.title.localeCompare(b.title)
    || a.id.localeCompare(b.id);
}

function selectTemplate(templates: OperatingTemplateSummary[], goal?: string): OperatingTemplateSummary | undefined {
  if (!templates.length) return undefined;
  if (!goal) return templates.find((template) => template.scope === "vault") ?? templates[0];
  const terms = normalizeTerms(goal);
  return [...templates].sort((a, b) => scoreTemplate(b, terms) - scoreTemplate(a, terms) || a.id.localeCompare(b.id))[0];
}

function scoreTemplate(template: OperatingTemplateSummary, terms: string[]): number {
  const haystack = [template.id, template.title, template.summary, template.scope, template.selectorKey, ...template.sectionIds].join(" ").toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0) + (template.scope === "vault" ? 1 : 0);
}

function normalizeTerms(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9:_/-]+/).filter(Boolean);
}

function groupByScope(templates: OperatingTemplateSummary[]): Record<string, string[]> {
  const grouped: Record<string, string[]> = {};
  for (const template of templates) (grouped[template.scope] ||= []).push(template.id);
  for (const ids of Object.values(grouped)) ids.sort();
  return Object.fromEntries(Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)));
}

function missingRecommendedSections(template: OperatingTemplateSummary): OperatingTemplateMissingSection[] {
  return template.missingSections.map((section) => ({ templateId: template.id, section, required: true, severity: "warning" }));
}

function findTemplateConflicts(templates: OperatingTemplateSummary[]): OperatingTemplateConflict[] {
  const groups = new Map<string, OperatingTemplateSummary[]>();
  for (const template of templates) {
    const key = `${template.scope}\0${template.selectorKey}`;
    groups.set(key, [...(groups.get(key) ?? []), template]);
  }
  return [...groups.entries()].filter(([, items]) => items.length > 1).map(([key, items]) => {
    const [scope, selector] = key.split("\0");
    const templateIds = items.map((template) => template.id).sort();
    return {
      scope,
      selectorKey: selector,
      templateIds,
      message: `Multiple active operating templates match scope ${scope} selector ${selector}: ${templateIds.join(", ")}`
    };
  }).sort((a, b) => a.scope.localeCompare(b.scope) || a.selectorKey.localeCompare(b.selectorKey));
}

function safeFields(node: AwgNode): Record<string, unknown> {
  return node.fields && typeof node.fields === "object" && !Array.isArray(node.fields) ? node.fields : {};
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function sectionIds(fields: Record<string, unknown>): string[] {
  const raw = Array.isArray(fields.sections) ? fields.sections : Array.isArray(fields.sectionIds) ? fields.sectionIds : [];
  return raw.flatMap((section) => {
    if (typeof section === "string") return section;
    if (section && typeof section === "object" && !Array.isArray(section)) {
      const id = (section as { id?: unknown; key?: unknown; name?: unknown }).id ?? (section as { key?: unknown }).key ?? (section as { name?: unknown }).name;
      return typeof id === "string" && id.trim() ? id : [];
    }
    return [];
  }).map((section) => section.toLowerCase()).sort();
}

function hasSection(fields: Record<string, unknown>, sections: string[], section: string): boolean {
  return fields[section] !== undefined || sections.includes(section) || sections.includes(section.replaceAll("_", "-"));
}

function selectorKey(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  if (!keys.length) return "*";
  return keys.map((key) => `${key}:${stableValue(value[key])}`).join("|");
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${key}:${stableValue(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
