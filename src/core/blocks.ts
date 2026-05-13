import type { AwgNode, AwgPresentationBlock, Diagnostic } from "./types.js";

export const MVP_BLOCK_TYPES = [
  "brief",
  "callout",
  "metric-row",
  "table",
  "checklist",
  "task-queue",
  "risk-list",
  "decision-list",
  "evidence-list",
  "timeline",
  "run-summary",
  "node-list"
] as const;

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
  else diagnostics.push(...validateBlockDataShape(typed, path, nodeId, severity));
  if (typed.sourceNodeIds !== undefined && !isStringArray(typed.sourceNodeIds)) diagnostics.push({ severity, code: "invalid_block_refs", message: `Block sourceNodeIds must be an array of strings: ${path}`, id: nodeId });
  if (typed.targetNodeIds !== undefined && !isStringArray(typed.targetNodeIds)) diagnostics.push({ severity, code: "invalid_block_refs", message: `Block targetNodeIds must be an array of strings: ${path}`, id: nodeId });
  return diagnostics;
}

export function assertCliPresentationBlocks(blocks: AwgPresentationBlock[], flag: string): void {
  blocks.forEach((block, index) => {
    const diagnostics = validatePresentationBlock(block, "cli", index);
    const blocking = diagnostics.filter((diag) => ["invalid_block", "invalid_block_schema_version", "invalid_block_type", "unsupported_block_type", "invalid_block_data", "invalid_block_refs"].includes(diag.code));
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
    if (typeof data !== "string" && !(data && typeof data === "object" && !Array.isArray(data) && typeof (data as { text?: unknown }).text === "string")) diagnostics.push({ severity, code: "invalid_block_data", message: `${block.type} block data must be a string or object with text: ${path}`, id: nodeId });
  }
  if (block.type === "metric-row") {
    if (!data || typeof data !== "object" || Array.isArray(data)) diagnostics.push({ severity, code: "invalid_block_data", message: `metric-row block data must be an object: ${path}`, id: nodeId });
  }
  if (block.type === "table") {
    const rows = Array.isArray((data as { rows?: unknown } | undefined)?.rows) ? (data as { rows: unknown[] }).rows : Array.isArray(data) ? data : undefined;
    if (!rows) diagnostics.push({ severity, code: "invalid_block_data", message: `table block data must be an array or object with rows: ${path}`, id: nodeId });
    const columns = (data as { columns?: unknown } | undefined)?.columns;
    if (columns !== undefined && (!Array.isArray(columns) || !columns.every(isTableColumn))) diagnostics.push({ severity, code: "invalid_block_data", message: `table block columns must be strings or objects with key: ${path}`, id: nodeId });
  }
  if (block.type === "checklist" || block.type === "timeline") {
    const items = Array.isArray((data as { items?: unknown } | undefined)?.items) ? (data as { items: unknown[] }).items : Array.isArray(data) ? data : undefined;
    if (!items) diagnostics.push({ severity, code: "invalid_block_data", message: `${block.type} block data must be an array or object with items: ${path}`, id: nodeId });
  }
  if (block.type === "node-list" || block.type === "task-queue" || block.type === "risk-list" || block.type === "decision-list") {
    const hasItems = Array.isArray((block as { items?: unknown }).items) || Array.isArray((data as { items?: unknown } | undefined)?.items);
    const hasQuery = Boolean((block as { query?: unknown }).query) || Boolean((data as { query?: unknown } | undefined)?.query);
    if (!hasItems && !hasQuery) diagnostics.push({ severity, code: "invalid_block_data", message: `${block.type} block data must provide items or query: ${path}`, id: nodeId });
  }
  if (block.type === "evidence-list") {
    const items = Array.isArray((data as { items?: unknown } | undefined)?.items) ? (data as { items: unknown[] }).items : Array.isArray(data) ? data : undefined;
    if (!items) diagnostics.push({ severity, code: "invalid_block_data", message: `evidence-list block data must be an array or object with items: ${path}`, id: nodeId });
  }
  if (block.type === "run-summary") {
    if (!data || typeof data !== "object" || Array.isArray(data)) diagnostics.push({ severity, code: "invalid_block_data", message: `run-summary block data must be an object: ${path}`, id: nodeId });
  }
  return diagnostics;
}

function isTableColumn(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as { key?: unknown }).key === "string" && (value as { key: string }).key.trim());
}
