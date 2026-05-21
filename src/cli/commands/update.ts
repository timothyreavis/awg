import { AWG_VERSION, CORE_STATUSES } from "../../core/constants.js";
import { assertCliViewBlocks } from "../../core/blocks.js";
import { buildAwg } from "../../core/compiler.js";
import { isTemplateNode } from "../../core/operatingTemplates.js";
import { LENS_STATUSES, normalizeLensSections, validateLens } from "../../core/lensConfigs.js";
import { attachRun, resolveWriteRunId } from "../../core/runAttribution.js";
import type { AwgEvent, AwgLens, AwgLensSection, AwgNode, AwgPresentationBlock, AwgView } from "../../core/types.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { nowIso } from "../../util/time.js";
import { arr, str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";
import { applyRichNodePatch, parseJsonInput, richNodePatch } from "../nodeContent.js";

export async function updateCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub, id] = parsed.positionals;
  if (sub === "view" && id) return updateView(parsed, id);
  if (sub === "lens" && id) return updateLens(parsed, id);
  if (sub !== "node" || !id) throw new Error("Usage: awg update node <node-id> [--title ...] [--summary ...] [--status ...] [--type ...] [--json] | awg update view <view-id> ... | awg update lens <lens-id> ...");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const runId = resolveWriteRunId(graph, parsed.flags);
  const prior = graph.nodes.find((node) => node.id === id);
  if (!prior) throw new Error(`Node not found: ${id}`);
  const at = nowIso();
  const rich = richNodePatch(parsed);
  const basePatch = nodePatch(parsed);
  rich.patch = { ...rich.patch, ...basePatch };
  const applied = applyRichNodePatch(prior, rich);
  const patch = applied.patch;
  const unsetTags = arr(parsed.flags, "unset-tag");
  if (Object.keys(patch).length === 0 && unsetTags.length === 0) throw new Error("No update fields provided.");
  if (patch.tags || unsetTags.length) patch.tags = [...new Set([...(prior.tags ?? []), ...(patch.tags ?? [])])].filter((tag) => !unsetTags.includes(tag)).sort();
  guardTemplateSelfApproval(prior, patch, str(parsed.flags, "by", "agent:codex") ?? "agent:codex");
  const updatedKeys = [...new Set([...applied.updatedKeys, ...(patch.tags ? ["tags"] : [])])].sort();
  const next: AwgNode = { ...prior, ...patch, updated_at: at };
  await storage.appendLogEntry(next);
  const eventId = `ev:${id.replace(/^n:/, "")}:update:${at.replace(/[^0-9]/g, "")}`;
  const event: AwgEvent = attachRun({ awg: AWG_VERSION, kind: "event", id: eventId, type: "node_updated", target: id, by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex", at, fields: updatedKeys }, runId);
  await storage.appendLogEntry(event);
  const output = { ok: true, nodeId: id, eventId, updated: patch, updatedKeys, node: next, warnings: applied.warnings };
  if (parsed.flags.json) return printJson(output);
  console.log(`Updated node ${id}`);
}

function guardTemplateSelfApproval(prior: AwgNode, patch: Partial<AwgNode>, by: string): void {
  const tags = new Set([...(prior.tags ?? []), ...(patch.tags ?? [])]);
  const isTemplate = prior.type === "template" || ["process", "standard", "policy"].includes(patch.type ?? prior.type) && ["template", "operating-template", "template:operating"].some((tag) => tags.has(tag));
  const nextFields = { ...(prior.fields ?? {}), ...(patch.fields ?? {}) };
  const priorFields = prior.fields ?? {};
  const priorApprovedTemplate = isTemplateNode(prior) && (priorFields.human_approved === true || priorFields.humanApproved === true) && (priorFields.review_state === "reviewed" || priorFields.reviewState === "reviewed");
  if (priorApprovedTemplate && Object.keys(patch).length > 0 && !/^(human|user|owner):/.test(by)) {
    throw new Error("Reviewed human-approved operating template updates require --by human:<name>, user:<name>, or owner:<name>; agents cannot revise approved template policy.");
  }
  const approvalChanged = nextFields.human_approved === true && priorFields.human_approved !== true
    || nextFields.humanApproved === true && priorFields.humanApproved !== true
    || nextFields.review_state === "reviewed" && priorFields.review_state !== "reviewed"
    || nextFields.reviewState === "reviewed" && priorFields.reviewState !== "reviewed";
  const next: AwgNode = { ...prior, ...patch, fields: nextFields };
  const approvedTemplateBecomesSelectable = isTemplateNode(next) && !isTemplateNode(prior) && (nextFields.human_approved === true || nextFields.humanApproved === true || nextFields.review_state === "reviewed" || nextFields.reviewState === "reviewed");
  if (!isTemplate && !approvedTemplateBecomesSelectable) return;
  if (!approvalChanged && !approvedTemplateBecomesSelectable) return;
  if (/^(human|user|owner):/.test(by)) return;
  throw new Error("Operating template approval requires --by human:<name>, user:<name>, or owner:<name>; agents cannot self-approve templates.");
}

async function updateLens(parsed: ParsedArgs, lensId: string): Promise<void> {
  if (!/^lens:.+/.test(lensId)) throw new Error("Lens id must start with lens: and include a non-empty slug");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const runId = resolveWriteRunId(graph, parsed.flags);
  const prior = graph.lenses.find((lens) => lens.id === lensId);
  if (!prior) throw new Error(`Lens not found: ${lensId}`);
  const patch: Partial<AwgLens> = {};
  for (const key of ["title", "purpose", "summary", "status", "scope", "audience"] as const) {
    const value = str(parsed.flags, key);
    if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
  }
  if (patch.status && !LENS_STATUSES.includes(patch.status as never)) throw new Error(`--status must be one of: ${LENS_STATUSES.join(", ")}`);
  const tags = arr(parsed.flags, "tag");
  if (tags.length) patch.tags = [...new Set([...(prior.tags ?? []), ...tags])].sort();
  if (parsed.flags["clear-sections"]) patch.sections = [];
  const replaceSections = str(parsed.flags, "sections-json");
  if (replaceSections !== undefined) patch.sections = parseLensSections(replaceSections, "--sections-json");
  const appendSections = arr(parsed.flags, "section-json").flatMap((value) => parseLensSectionInput(value, "--section-json"));
  if (appendSections.length) patch.sections = [...(patch.sections ?? normalizeLensSections(prior)), ...appendSections];
  const selector = parseObjectInput(parsed, "selector-json");
  if (selector !== undefined) patch.selector = selector;
  const budget = parseObjectInput(parsed, "budget-json");
  if (budget !== undefined) patch.budget = budget;
  if (Object.keys(patch).length === 0) throw new Error("No update fields provided.");
  const at = nowIso();
  const next: AwgLens = attachRun({ ...prior, ...patch, updated_at: at }, runId);
  const blocking = validateLens(next, graph, "fatal").filter((diag) => diag.severity === "fatal");
  if (blocking.length) throw new Error(blocking[0].message);
  await storage.appendLogEntry(next);
  const eventId = `ev:${lensId.replace(/^lens:/, "")}:update:${at.replace(/[^0-9]/g, "")}`;
  const event: AwgEvent = attachRun({ awg: AWG_VERSION, kind: "event", id: eventId, type: "lens_updated", target: lensId, by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex", at, fields: Object.keys(patch).sort() }, runId);
  await storage.appendLogEntry(event);
  if (parsed.flags.json) return printJson({ ok: true, lensId, eventId, updated: patch, updatedKeys: Object.keys(patch).sort(), lens: next });
  console.log(`Updated lens ${lensId}`);
}

async function updateView(parsed: ParsedArgs, viewId: string): Promise<void> {
  if (!/^v:.+/.test(viewId)) throw new Error("View id must start with v: and include a non-empty slug");
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const runId = resolveWriteRunId(graph, parsed.flags);
  const prior = graph.views.find((view) => view.id === viewId);
  if (!prior) throw new Error(`View not found: ${viewId}`);
  const patch: Partial<AwgView> = {};
  for (const key of ["title", "summary", "audience"] as const) {
    const value = str(parsed.flags, key);
    if (value !== undefined) patch[key] = value;
  }
  if (patch.audience && !["human", "agent", "reviewer"].includes(String(patch.audience))) throw new Error("--audience must be one of: human, agent, reviewer");
  const tags = arr(parsed.flags, "tag");
  if (tags.length) patch.tags = [...new Set([...(prior.tags ?? []), ...tags])].sort();
  if (parsed.flags["clear-blocks"]) patch.blocks = [];
  const replaceBlocks = str(parsed.flags, "blocks-json");
  if (replaceBlocks !== undefined) patch.blocks = parseViewBlockInput(replaceBlocks, "--blocks-json");
  const appendBlocks = arr(parsed.flags, "block-json").flatMap((value) => parseViewBlockInput(value, "--block-json"));
  if (appendBlocks.length) patch.blocks = [...(patch.blocks ?? prior.blocks ?? []), ...appendBlocks];
  if (patch.blocks) assertCliViewBlocks(patch.blocks, "--blocks-json");
  if (Object.keys(patch).length === 0) throw new Error("No update fields provided.");
  const at = nowIso();
  const next: AwgView = attachRun({ ...prior, ...patch, updated_at: at }, runId);
  await storage.appendLogEntry(next);
  const eventId = `ev:${viewId.replace(/^v:/, "")}:update:${at.replace(/[^0-9]/g, "")}`;
  const event: AwgEvent = attachRun({ awg: AWG_VERSION, kind: "event", id: eventId, type: "view_updated", target: viewId, by: str(parsed.flags, "by", "agent:codex") ?? "agent:codex", at, fields: Object.keys(patch).sort() }, runId);
  await storage.appendLogEntry(event);
  if (parsed.flags.json) return printJson({ ok: true, viewId, eventId, updated: patch, updatedKeys: Object.keys(patch).sort(), view: next });
  console.log(`Updated view ${viewId}`);
}

function nodePatch(parsed: ParsedArgs): Partial<AwgNode> {
  const patch: Partial<AwgNode> = {};
  for (const key of ["title", "summary", "status", "type"] as const) {
    const value = str(parsed.flags, key);
    if (value !== undefined) (patch as Record<string, unknown>)[key.replace(/-/g, "_")] = value;
  }
  if (patch.status && !CORE_STATUSES.includes(patch.status as never)) throw new Error(`--status must be one of: ${CORE_STATUSES.join(", ")}`);
  if (patch.type !== undefined && !String(patch.type).trim()) throw new Error("--type must not be empty");
  for (const key of ["importance", "confidence"] as const) {
    const value = str(parsed.flags, key);
    if (value !== undefined) {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`--${key} must be a number between 0 and 1`);
      patch[key] = number;
    }
  }
  const tags = arr(parsed.flags, "tag");
  if (tags.length) patch.tags = tags;
  const evidenceRequired = str(parsed.flags, "evidence-required");
  if (evidenceRequired !== undefined) patch.evidence_required = evidenceRequired === "true" || evidenceRequired === "1" || evidenceRequired === "yes";
  return patch;
}

function parseViewBlockInput(value: string, flag: string): AwgPresentationBlock[] {
  const parsed = parseJsonInput(value, flag);
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  for (const block of blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) throw new Error(`${flag} must contain a block object or array of block objects`);
  }
  return blocks as AwgPresentationBlock[];
}

function parseObjectInput(parsed: ParsedArgs, key: string): Record<string, unknown> | undefined {
  const value = str(parsed.flags, key);
  if (value === undefined) return undefined;
  const parsedValue = parseJsonInput(value, `--${key}`);
  if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) throw new Error(`--${key} must be a JSON object`);
  return parsedValue as Record<string, unknown>;
}

function parseLensSections(value: string, flag: string): AwgLensSection[] {
  const parsed = parseJsonInput(value, flag);
  if (!Array.isArray(parsed)) throw new Error(`${flag} must be a JSON array`);
  return parsed.map((section, index) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) throw new Error(`${flag}[${index}] must be a section object`);
    return section as AwgLensSection;
  });
}

function parseLensSectionInput(value: string, flag: string): AwgLensSection[] {
  const parsed = parseJsonInput(value, flag);
  const sections = Array.isArray(parsed) ? parsed : [parsed];
  return sections.map((section, index) => {
    if (!section || typeof section !== "object" || Array.isArray(section)) throw new Error(`${flag}[${index}] must be a section object`);
    return section as AwgLensSection;
  });
}
