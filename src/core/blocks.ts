import type { AwgNode, AwgPresentationBlock, Diagnostic } from "./types.js";

export const MVP_BLOCK_TYPES = [
  "brief",
  "callout",
  "metric-row",
  "table",
  "checklist",
  "timeline",
  "node-list"
] as const;

const MAX_BLOCK_DATA_BYTES = 100_000;
const MAX_BLOCK_DATA_DEPTH = 8;
const BLOCK_DIAGNOSTIC_CODES = new Set([
  "invalid_node_blocks",
  "invalid_block",
  "invalid_block_schema_version",
  "invalid_block_type",
  "unsupported_block_type",
  "invalid_block_data",
  "invalid_block_refs",
  "oversized_block_data"
]);

export function isBlockDiagnosticCode(code: string): boolean {
  return BLOCK_DIAGNOSTIC_CODES.has(code);
}

const MVP_BLOCK_TYPE_SET = new Set<string>(MVP_BLOCK_TYPES);

export function validateNodeBlocks(node: AwgNode, severity: Diagnostic["severity"] = "warning"): Diagnostic[] {
  if (node.blocks === undefined) return [];
  if (!Array.isArray(node.blocks)) {
    return [{ severity, code: "invalid_node_blocks", message: `Node blocks must be an array: ${node.id}`, id: node.id }];
  }
  const diagnostics: Diagnostic[] = [];
  node.blocks.forEach((block, index) => {
    diagnostics.push(...validatePresentationBlock(block, node.id, index, severity));
  });
  return diagnostics;
}

export function validatePresentationBlock(block: unknown, nodeId = "node", index = 0, severity: Diagnostic["severity"] = "warning"): Diagnostic[] {
  const path = `${nodeId}.blocks[${index}]`;
  if (!block || typeof block !== "object" || Array.isArray(block)) return [{ severity, code: "invalid_block", message: `Block must be an object: ${path}`, id: nodeId }];
  const typed = block as Partial<AwgPresentationBlock>;
  const diagnostics: Diagnostic[] = [];
  if (typed.schemaVersion !== 1) diagnostics.push({ severity, code: "invalid_block_schema_version", message: `Block schemaVersion must be 1: ${path}`, id: nodeId });
  if (typeof typed.type !== "string" || !typed.type.trim()) diagnostics.push({ severity, code: "invalid_block_type", message: `Block type must be a non-empty string: ${path}`, id: nodeId });
  else if (!MVP_BLOCK_TYPE_SET.has(typed.type)) diagnostics.push({ severity, code: "unsupported_block_type", message: `Unsupported block type "${typed.type}": ${path}`, id: nodeId });
  if (!("data" in typed)) diagnostics.push({ severity, code: "invalid_block_data", message: `Block data is required: ${path}`, id: nodeId });
  else {
    diagnostics.push(...validateBlockGuardrails(typed.data, path, nodeId, severity));
    diagnostics.push(...validateBlockDataShape(typed, path, nodeId, severity));
  }
  if (typed.sourceNodeIds !== undefined && !isStringArray(typed.sourceNodeIds)) diagnostics.push({ severity, code: "invalid_block_refs", message: `Block sourceNodeIds must be an array of strings: ${path}`, id: nodeId });
  if (typed.targetNodeIds !== undefined && !isStringArray(typed.targetNodeIds)) diagnostics.push({ severity, code: "invalid_block_refs", message: `Block targetNodeIds must be an array of strings: ${path}`, id: nodeId });
  return diagnostics;
}

export function assertCliPresentationBlocks(blocks: AwgPresentationBlock[], flag: string): void {
  blocks.forEach((block, index) => {
    const diagnostics = validatePresentationBlock(block, "cli", index);
    const blocking = diagnostics.filter((diag) => isBlockDiagnosticCode(diag.code));
    if (blocking.length) throw new Error(`${flag} invalid block at index ${index}: ${blocking[0].message}`);
  });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateBlockDataShape(block: Partial<AwgPresentationBlock>, path: string, nodeId: string, severity: Diagnostic["severity"]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const data = block.data;
  if (block.type === "brief" || block.type === "callout") {
    if (typeof data !== "string" && !(isPlainObject(data) && (typeof data.text === "string" || (Array.isArray(data.items) && data.items.every(isBriefItem))))) diagnostics.push({ severity, code: "invalid_block_data", message: `${block.type} block data must be a string, object with text, or object with items: ${path}`, id: nodeId });
  }
  if (block.type === "metric-row") {
    if (!isPlainObject(data) || !Array.isArray(data.items) || !data.items.every(isMetricItem)) diagnostics.push({ severity, code: "invalid_block_data", message: `metric-row block data must be an object with metric items: ${path}`, id: nodeId });
  }
  if (block.type === "table") {
    if (!isPlainObject(data) || !Array.isArray(data.rows)) diagnostics.push({ severity, code: "invalid_block_data", message: `table block data must be an object with rows: ${path}`, id: nodeId });
    const columns = isPlainObject(data) ? data.columns : undefined;
    if (columns !== undefined && (!Array.isArray(columns) || !columns.every(isTableColumn))) diagnostics.push({ severity, code: "invalid_block_data", message: `table block columns must be strings or objects with key: ${path}`, id: nodeId });
  }
  if (block.type === "checklist" || block.type === "timeline") {
    if (!isPlainObject(data) || !Array.isArray(data.items) || !(block.type === "checklist" ? data.items.every(isChecklistItem) : data.items.every(isTimelineItem))) diagnostics.push({ severity, code: "invalid_block_data", message: `${block.type} block data must be an object with valid items: ${path}`, id: nodeId });
  }
  if (block.type === "node-list") {
    if (!isPlainObject(data) || !(isStringArray(data.nodeIds) || (Array.isArray(data.items) && data.items.every(isNodeListItem)) || isPlainObject(data.query))) diagnostics.push({ severity, code: "invalid_block_data", message: `node-list block data must provide nodeIds, items, or query: ${path}`, id: nodeId });
  }
  return diagnostics;
}

function validateBlockGuardrails(value: unknown, path: string, nodeId: string, severity: Diagnostic["severity"]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const serialized = safeStringify(value);
  if (serialized.length > MAX_BLOCK_DATA_BYTES) diagnostics.push({ severity, code: "oversized_block_data", message: `Block data is too large: ${path}`, id: nodeId });
  if (maxDepth(value) > MAX_BLOCK_DATA_DEPTH) diagnostics.push({ severity, code: "oversized_block_data", message: `Block data is too deeply nested: ${path}`, id: nodeId });
  if (containsLargeBase64(value)) diagnostics.push({ severity, code: "oversized_block_data", message: `Block data appears to contain embedded binary/base64 content: ${path}`, id: nodeId });
  return diagnostics;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function maxDepth(value: unknown, depth = 0): number {
  if (!value || typeof value !== "object") return depth;
  const children = Array.isArray(value) ? value : Object.values(value);
  return Math.max(depth, ...children.slice(0, 100).map((child) => maxDepth(child, depth + 1)));
}

function containsLargeBase64(value: unknown): boolean {
  if (typeof value === "string") return value.length > 1200 && /^[A-Za-z0-9+/=\r\n]+$/.test(value);
  if (!value || typeof value !== "object") return false;
  const children = Array.isArray(value) ? value : Object.values(value);
  return children.slice(0, 100).some(containsLargeBase64);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isBriefItem(value: unknown): boolean {
  return isPlainObject(value) && typeof value.text === "string" && (value.label === undefined || typeof value.label === "string");
}

function isMetricItem(value: unknown): boolean {
  return isPlainObject(value) && typeof value.label === "string" && value.value !== undefined;
}

function isChecklistItem(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (!isPlainObject(value) || typeof value.label !== "string") return false;
  return value.status === undefined || ["pending", "in_progress", "done", "skipped", "blocked", "completed"].includes(String(value.status));
}

function isTimelineItem(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  if (!isPlainObject(value)) return false;
  return typeof value.label === "string" || typeof value.title === "string" || typeof value.summary === "string";
}

function isNodeListItem(value: unknown): boolean {
  return typeof value === "string" || isPlainObject(value) && typeof value.id === "string";
}

function isTableColumn(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as { key?: unknown }).key === "string" && (value as { key: string }).key.trim());
}
