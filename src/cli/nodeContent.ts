import { readFileSync } from "node:fs";
import { assertCliPresentationBlocks } from "../core/blocks.js";
import type { AwgAnchor, AwgFreshness, AwgNode, AwgPresentationBlock } from "../core/types.js";
import { arr, str, type ParsedArgs } from "./args.js";

const ANCHOR_KINDS = new Set(["file", "symbol", "url", "command", "doc", "external"]);
const FRESHNESS_STATES = new Set(["current", "historical", "proposed", "superseded", "stale", "needs_review", "unknown", "not_applicable"]);

export interface RichNodePatch {
  patch: Partial<AwgNode>;
  replaceFields?: boolean;
  unsetFields: string[];
  appendBlocks: AwgPresentationBlock[];
  replaceBlocks?: AwgPresentationBlock[];
  clearBlocks?: boolean;
  replaceAnchors?: AwgAnchor[];
  unsetAnchors: AwgAnchor[];
  warnings: string[];
}

export function richNodePatch(parsed: ParsedArgs): RichNodePatch {
  const patch: Partial<AwgNode> = {};
  const warnings: string[] = [];
  const body = str(parsed.flags, "body");
  if (body !== undefined) patch.body = body;
  const fields = parseFields(parsed);
  if (fields.fields) patch.fields = fields.fields;
  const freshness = parseFreshness(parsed);
  if (freshness !== undefined) patch.freshness = freshness;
  const reviewAfter = str(parsed.flags, "review-after");
  if (reviewAfter !== undefined) patch.freshness = { ...(patch.freshness ?? {}), review_after: reviewAfter };
  const appendBlocks = arr(parsed.flags, "block-json").flatMap((value) => parseBlocks(value, "--block-json"));
  const replaceBlocksValue = stringFlag(parsed, "blocks-json");
  const replaceBlocks = replaceBlocksValue !== undefined ? parseBlocks(replaceBlocksValue, "--blocks-json") : undefined;
  const replaceAnchorsValue = stringFlag(parsed, "anchors-json");
  const replaceAnchors = replaceAnchorsValue !== undefined ? parseAnchorsJson(replaceAnchorsValue) : undefined;
  const anchors = arr(parsed.flags, "anchor").map(parseAnchor);
  if (anchors.length) patch.anchors = anchors;
  return {
    patch,
    replaceFields: fields.replaceFields,
    unsetFields: arr(parsed.flags, "unset-field"),
    appendBlocks,
    replaceBlocks,
    clearBlocks: Boolean(parsed.flags["clear-blocks"]),
    replaceAnchors,
    unsetAnchors: arr(parsed.flags, "unset-anchor").map(parseAnchor),
    warnings
  };
}

export function applyRichNodePatch(prior: AwgNode | undefined, rich: RichNodePatch): { patch: Partial<AwgNode>; updatedKeys: string[]; warnings: string[] } {
  const patch: Partial<AwgNode> = { ...rich.patch };
  const updatedKeys = new Set(Object.keys(patch));
  if (patch.fields !== undefined && !rich.replaceFields) patch.fields = { ...(prior?.fields ?? {}), ...patch.fields };
  if (rich.unsetFields.length) {
    const nextFields = { ...(patch.fields ?? prior?.fields ?? {}) };
    for (const key of rich.unsetFields) delete nextFields[key];
    patch.fields = nextFields;
    updatedKeys.add("fields");
  }
  if (rich.clearBlocks) {
    patch.blocks = [];
    updatedKeys.add("blocks");
  }
  if (rich.replaceBlocks) {
    patch.blocks = rich.replaceBlocks;
    updatedKeys.add("blocks");
  } else if (rich.appendBlocks.length) {
    patch.blocks = [...(rich.clearBlocks ? [] : prior?.blocks ?? []), ...rich.appendBlocks];
    updatedKeys.add("blocks");
  }
  if (patch.anchors) patch.anchors = mergeAnchors(prior?.anchors ?? [], patch.anchors);
  if (rich.replaceAnchors) {
    patch.anchors = rich.replaceAnchors;
    updatedKeys.add("anchors");
  }
  if (rich.unsetAnchors.length) {
    patch.anchors = (patch.anchors ?? prior?.anchors ?? []).filter((anchor) => !rich.unsetAnchors.some((remove) => anchorKey(remove) === anchorKey(anchor)));
    updatedKeys.add("anchors");
  }
  if (patch.freshness && prior?.freshness) patch.freshness = { ...prior.freshness, ...patch.freshness };
  if (patch.freshness) updatedKeys.add("freshness");
  return { patch, updatedKeys: [...updatedKeys].sort(), warnings: rich.warnings };
}

export function parseAnchor(value: string): AwgAnchor {
  const separator = value.indexOf(":");
  const kind = separator >= 0 ? value.slice(0, separator) : value;
  const rest = separator >= 0 ? value.slice(separator + 1) : "";
  if (!ANCHOR_KINDS.has(kind)) throw new Error("--anchor must start with file:, symbol:, url:, command:, doc:, or external:");
  if (kind === "url") return { kind, url: rest };
  if (kind === "command") return { kind, label: rest };
  if (kind === "symbol") return { kind, name: rest, label: rest };
  return { kind: kind as AwgAnchor["kind"], path: rest || undefined, label: rest || undefined };
}

function parseFields(parsed: ParsedArgs): { fields?: Record<string, unknown>; replaceFields?: boolean } {
  let fields: Record<string, unknown> | undefined;
  for (const value of arr(parsed.flags, "field")) {
    const equals = value.indexOf("=");
    if (equals <= 0) throw new Error("--field must use key=value");
    fields = { ...(fields ?? {}), [value.slice(0, equals)]: parseScalar(value.slice(equals + 1)) };
  }
  const fieldJson = parseObjectFlag(parsed, "field-json");
  if (fieldJson !== undefined) fields = { ...(fields ?? {}), ...fieldJson };
  const fieldsJson = parseObjectFlag(parsed, "fields-json");
  if (fieldsJson !== undefined) fields = fieldsJson;
  return { fields, replaceFields: fieldsJson !== undefined };
}

function parseObjectFlag(parsed: ParsedArgs, key: string): Record<string, unknown> | undefined {
  const value = stringFlag(parsed, key);
  if (value === undefined) return undefined;
  const parsedValue = parseJsonInput(value, `--${key}`);
  if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) throw new Error(`--${key} must be a JSON object`);
  return parsedValue as Record<string, unknown>;
}

function stringFlag(parsed: ParsedArgs, key: string): string | undefined {
  if (!(key in parsed.flags)) return undefined;
  const value = str(parsed.flags, key);
  if (value === undefined) throw new Error(`--${key} requires a JSON value or @file`);
  return value;
}

function parseFreshness(parsed: ParsedArgs): AwgFreshness | undefined {
  const freshness = parseObjectFlag(parsed, "freshness-json");
  if (freshness === undefined) return undefined;
  if (freshness.state !== undefined && (typeof freshness.state !== "string" || !FRESHNESS_STATES.has(freshness.state))) throw new Error(`--freshness-json state must be one of: ${[...FRESHNESS_STATES].join(", ")}`);
  for (const key of ["last_verified", "review_after", "verified_by", "source_of_truth", "stale_reason", "superseded_by", "superseded_at"]) {
    if (freshness[key] !== undefined && typeof freshness[key] !== "string") throw new Error(`--freshness-json ${key} must be a string`);
  }
  if (freshness.supersedes !== undefined && !isStringArray(freshness.supersedes)) throw new Error("--freshness-json supersedes must be an array of strings");
  return freshness as AwgFreshness;
}

function parseBlocks(value: string, flag: string): AwgPresentationBlock[] {
  const parsed = parseJsonInput(value, flag);
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  for (const block of blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) throw new Error(`${flag} must contain a block object or array of block objects`);
  }
  assertCliPresentationBlocks(blocks as AwgPresentationBlock[], flag);
  return blocks as AwgPresentationBlock[];
}

function parseAnchorsJson(value: string): AwgAnchor[] {
  const parsed = parseJsonInput(value, "--anchors-json");
  if (!Array.isArray(parsed)) throw new Error("--anchors-json must be a JSON array");
  return parsed.map((anchor, index) => validateAnchorObject(anchor, `--anchors-json[${index}]`));
}

function validateAnchorObject(value: unknown, path: string): AwgAnchor {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an anchor object`);
  const anchor = value as Record<string, unknown>;
  if (typeof anchor.kind !== "string" || !ANCHOR_KINDS.has(anchor.kind)) throw new Error(`${path}.kind must be one of: ${[...ANCHOR_KINDS].join(", ")}`);
  for (const key of ["path", "name", "url", "label"]) {
    if (anchor[key] !== undefined && typeof anchor[key] !== "string") throw new Error(`${path}.${key} must be a string`);
  }
  return anchor as unknown as AwgAnchor;
}

function parseJsonInput(value: string, flag: string): unknown {
  const body = value.startsWith("@") ? readFileSync(value.slice(1), "utf8") : value;
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`${flag} contains malformed JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (value !== "" && Number.isFinite(Number(value))) return Number(value);
  return value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function mergeAnchors(existing: AwgAnchor[], incoming: AwgAnchor[]): AwgAnchor[] {
  const byKey = new Map(existing.map((anchor) => [anchorKey(anchor), anchor]));
  for (const anchor of incoming) byKey.set(anchorKey(anchor), anchor);
  return [...byKey.values()];
}

function anchorKey(anchor: AwgAnchor): string {
  return [anchor.kind, anchor.path ?? "", anchor.name ?? "", anchor.url ?? "", anchor.label ?? ""].join("\0");
}
