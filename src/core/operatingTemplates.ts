import type {
  AwgNode,
  OperatingTemplateConflict,
  OperatingTemplateIndex,
  OperatingTemplateMissingSection,
  OperatingTemplateSummary,
  OperatingTemplateWarning
} from "./types.js";
import { CLIENT_PILOT_FIELDS, REQUIRED_TEMPLATE_FIELDS, RECOMMENDED_TEMPLATE_FIELDS, TEMPLATE_FIELD_CONTRACT, adaptiveAuthoringGuide, explicitNotApplicable, fieldValue, isPlaceholderValue } from "./adaptiveTemplates.js";

const TEMPLATE_TAGS = new Set(["template", "operating-template", "template:operating"]);
const TEMPLATE_NODE_TYPES = new Set(["process", "standard", "policy", "template"]);
const DISALLOWED_TEMPLATE_TYPES = new Set(["artifact", "implementation-spec", "roadmap"]);
const DISALLOWED_TEMPLATE_TAGS = new Set(["implementation-plan", "spec-artifact", "roadmap"]);
const ACTIVE_TEMPLATE_STATUSES = new Set(["active", "accepted"]);
const PENDING_TEMPLATE_STATUSES = new Set(["needs_review", "proposed", "draft"]);
const CLOSED_TEMPLATE_STATUSES = new Set(["archived", "rejected", "superseded"]);

export function buildOperatingTemplateIndex(nodes: AwgNode[], goal?: string): OperatingTemplateIndex {
  const misTagged = nodes.filter(isMisTaggedTemplateNode).sort(templateSort);
  const templates = nodes.filter(isTemplateNode).sort(templateSort);
  const activeTemplates = templates.filter((node) => ACTIVE_TEMPLATE_STATUSES.has(node.status) && isSettledTemplate(node)).map(templateSummary);
  const pendingTemplates = templates.filter((node) => !CLOSED_TEMPLATE_STATUSES.has(node.status) && (PENDING_TEMPLATE_STATUSES.has(node.status) || !isSettledTemplate(node))).map(templateSummary);
  const selectedTemplate = selectTemplate(activeTemplates, goal);
  const missingSections = activeTemplates.flatMap((template) => template.missingRequiredFields?.map((section) => ({ templateId: template.id, section, required: true, severity: "warning" as const })) ?? []);
  const missingRecommendedFields = activeTemplates.flatMap((template) => template.missingRecommendedFields?.map((section) => ({ templateId: template.id, section, required: false, severity: "info" as const })) ?? []);
  const conflicts = findTemplateConflicts(activeTemplates);
  const warnings: OperatingTemplateWarning[] = [
    ...(!activeTemplates.length ? [{
      code: "AWG_TEMPLATE_NO_ACTIVE_TEMPLATE",
      severity: "warning" as const,
      message: "No active operating template is available for this vault.",
      suggestedCommands: ["awg template guide --json", "awg template scaffold --title \"Operating template\" --scope vault --json"]
    }] : []),
    ...missingSections.map((item) => ({
      code: "AWG_TEMPLATE_MISSING_SECTION",
      severity: item.severity,
      message: `Operating template ${item.templateId} is missing ${item.section}.`,
      nodeIds: [item.templateId],
      suggestedCommands: [`awg update node ${item.templateId} --field ${item.section}=...`]
    })),
    ...pendingTemplates.map((template) => ({
      code: "AWG_TEMPLATE_NEEDS_REVIEW",
      severity: "warning" as const,
      message: `Operating template ${template.id} needs human review before it should be treated as settled.`,
      nodeIds: [template.id],
      suggestedCommands: [`awg node show ${template.id} --json`, `awg template guide --json`]
    })),
    ...misTagged.map((node) => ({
      code: "AWG_TEMPLATE_MISTAGGED_ARTIFACT",
      severity: "warning" as const,
      message: `Node ${node.id} is tagged like an operating template but type ${node.type} cannot be selected as operating policy.`,
      nodeIds: [node.id],
      suggestedCommands: [`awg update node ${node.id} --unset-tag template:operating --unset-tag operating-template --unset-tag template`]
    }))
  ];

  const unresolvedReviewCount = activeTemplates.filter((template) => template.needsReview).length;
  const blockingReasons = [
    ...(!selectedTemplate ? ["No reviewed human-approved operating template."] : []),
    ...(selectedTemplate?.missingRequiredFields ?? []).map((field) => `Selected template is missing required field ${field}.`),
    ...(selectedTemplate?.missingClientPilotFields ?? []).map((field) => `Selected template is missing client-pilot field ${field}.`),
    ...(selectedTemplate?.placeholderFields ?? []).map((field) => `Selected template field ${field} still contains placeholder content.`)
  ];
  return {
    ok: activeTemplates.length > 0 && conflicts.length === 0 && missingSections.length === 0 && unresolvedReviewCount === 0,
    activeTemplateId: selectedTemplate?.id ?? activeTemplates[0]?.id ?? null,
    selectedTemplate: selectedTemplate ?? null,
    activeTemplates,
    pendingTemplates,
    candidateTemplates: pendingTemplates,
    rootsByScope: groupByScope(activeTemplates),
    missingSections,
    missingRecommendedFields,
    notApplicableFields: sortedUnique(activeTemplates.flatMap((template) => template.notApplicableFields ?? [])),
    placeholderFields: sortedUnique(activeTemplates.flatMap((template) => template.placeholderFields ?? [])),
    fieldContract: TEMPLATE_FIELD_CONTRACT,
    authoringGuidance: adaptiveAuthoringGuide(goal ?? null),
    pilotReadinessImpact: { ready: blockingReasons.length === 0, blockingReasons },
    conflicts,
    warnings,
    suggestedCommands: ["awg template guide --json", "awg template status --json", "awg search template:operating", "awg vault readiness --client-pilot --json"]
  };
}

export function isTemplateNode(node: AwgNode): boolean {
  const tags = node.tags ?? [];
  if (!TEMPLATE_NODE_TYPES.has(node.type) || DISALLOWED_TEMPLATE_TYPES.has(node.type) || tags.some((tag) => DISALLOWED_TEMPLATE_TAGS.has(tag))) return false;
  return node.type === "template" || tags.some((tag) => TEMPLATE_TAGS.has(tag));
}

export function templateSummary(node: AwgNode): OperatingTemplateSummary {
  const fields = safeFields(node);
  const appliesTo = objectField(fields.appliesTo) ?? objectField(fields.applies_to) ?? {};
  const sections = sectionIds(fields);
  const missingRequiredFields = REQUIRED_TEMPLATE_FIELDS.filter((section) => !hasFieldOrSection(fields, sections, section));
  const missingRecommendedFields = RECOMMENDED_TEMPLATE_FIELDS.filter((section) => !hasFieldOrSection(fields, sections, section) && !explicitNotApplicable(fields, section));
  const missingClientPilotFields = CLIENT_PILOT_FIELDS.filter((section) => {
    const contract = TEMPLATE_FIELD_CONTRACT.find((item) => item.name === section);
    return !hasFieldOrSection(fields, sections, section) || isPlaceholderValue(contract ? fieldValue(fields, contract) : fields[section], contract);
  });
  const placeholderFields = TEMPLATE_FIELD_CONTRACT.filter((contract) => hasFieldOrSection(fields, sections, contract.name) && isPlaceholderValue(fieldValue(fields, contract), contract)).map((contract) => contract.name);
  const notApplicableFields = TEMPLATE_FIELD_CONTRACT.filter((contract) => explicitNotApplicable(fields, contract.name)).map((contract) => contract.name);
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
    missingSections: missingRequiredFields,
    missingRequiredFields,
    missingRecommendedFields,
    missingClientPilotFields,
    placeholderFields,
    notApplicableFields,
    reviewState: reviewState ?? null,
    policyText: JSON.stringify(fields).slice(0, 12000),
    needsReview: ["draft", "needs_review", "proposed", "unreviewed"].includes(String(reviewState ?? node.status)) || humanReviewRequired && !humanApproved,
    humanReviewRequired,
    humanApproved,
    updated_at: node.updated_at
  };
}

export function isMisTaggedTemplateArtifact(node: AwgNode): boolean {
  return isMisTaggedTemplateNode(node);
}

export function isMisTaggedTemplateNode(node: AwgNode): boolean {
  const tags = node.tags ?? [];
  return (!TEMPLATE_NODE_TYPES.has(node.type) || DISALLOWED_TEMPLATE_TYPES.has(node.type) || tags.some((tag) => DISALLOWED_TEMPLATE_TAGS.has(tag))) && tags.some((tag) => TEMPLATE_TAGS.has(tag));
}

export function isSettledTemplate(node: AwgNode): boolean {
  const summary = templateSummary(node);
  return !summary.needsReview && summary.humanApproved && summary.reviewState === "reviewed";
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

function hasFieldOrSection(fields: Record<string, unknown>, sections: string[], section: string): boolean {
  const contract = TEMPLATE_FIELD_CONTRACT.find((item) => item.name === section);
  return (contract ? fieldValue(fields, contract) !== undefined : fields[section] !== undefined) || sections.includes(section) || sections.includes(section.replaceAll("_", "-"));
}

function selectorKey(value: Record<string, unknown>): string {
  const keys = Object.keys(value).sort();
  if (!keys.length) return "*";
  return keys.map((key) => `${key}:${stableValue(value[key])}`).join("|");
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${key}:${stableValue(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
