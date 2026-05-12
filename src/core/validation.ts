import AjvModule from "ajv";
import { CORE_EDGE_RELS, CORE_KINDS, CORE_NODE_TYPES, CORE_STATUSES } from "./constants.js";
import { schemas } from "./schemas.js";
import type { AwgObject, Diagnostic, RawLogEntry } from "./types.js";

export interface ParsedEntry {
  raw: RawLogEntry;
  object?: AwgObject;
}

type Validator = ((value: unknown) => boolean) & { errors?: unknown };
const Ajv = AjvModule as unknown as new (options: { allErrors: boolean; strict: boolean }) => { compile: (schema: object) => Validator; errorsText: (errors: unknown, options: { separator: string }) => string };
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = Object.fromEntries(Object.entries(schemas).map(([kind, schema]) => [kind, ajv.compile(schema)]));

export function parseAndValidate(entries: RawLogEntry[], options: { strict: boolean; allowUnknownNodeTypes: boolean }, schemaOverrides?: Record<string, unknown>): { parsed: ParsedEntry[]; diagnostics: Diagnostic[] } {
  const parsed: ParsedEntry[] = [];
  const diagnostics: Diagnostic[] = [];
  const activeValidators = schemaOverrides ? buildValidators(schemaOverrides) : validators;

  for (const entry of entries) {
    let value: unknown;
    try {
      value = JSON.parse(entry.raw);
    } catch (error) {
      diagnostics.push({ severity: "fatal", code: "invalid_json", message: `Malformed JSON: ${(error as Error).message}`, file: entry.file, line: entry.line });
      parsed.push({ raw: entry });
      continue;
    }

    if (!value || typeof value !== "object" || !("kind" in value)) {
      diagnostics.push({ severity: "fatal", code: "missing_kind", message: "Log entry must be an AWG object with kind.", file: entry.file, line: entry.line });
      parsed.push({ raw: entry });
      continue;
    }

    const kind = String((value as { kind: unknown }).kind);
    if (!CORE_KINDS.includes(kind as never)) {
      diagnostics.push({ severity: "fatal", code: "unknown_kind", message: `Unknown AWG object kind: ${kind}`, file: entry.file, line: entry.line });
      parsed.push({ raw: entry });
      continue;
    }

    const validate = activeValidators[kind];
    if (!validate(value)) {
      const maybeId = (value as Record<string, unknown>).id;
      diagnostics.push({
        severity: "fatal",
        code: "schema_error",
        message: ajv.errorsText(validate.errors, { separator: "; " }),
        file: entry.file,
        line: entry.line,
        id: typeof maybeId === "string" ? maybeId : undefined
      });
      parsed.push({ raw: entry });
      continue;
    }

    const typed = value as Record<string, unknown>;
    if (kind === "node" && typeof typed.type === "string" && !CORE_NODE_TYPES.includes(typed.type as never)) {
      diagnostics.push({
        severity: options.strict || !options.allowUnknownNodeTypes ? "fatal" : "warning",
        code: "unknown_node_type",
        message: `Unknown node type: ${typed.type}`,
        file: entry.file,
        line: entry.line,
        id: typeof typed.id === "string" ? typed.id : undefined
      });
    }
    if (kind === "node" && typeof typed.status === "string" && !CORE_STATUSES.includes(typed.status as never)) {
      diagnostics.push({
        severity: "fatal",
        code: "unknown_status",
        message: `Unknown node status: ${typed.status}`,
        file: entry.file,
        line: entry.line,
        id: typeof typed.id === "string" ? typed.id : undefined
      });
    }
    if (kind === "edge" && typeof typed.rel === "string" && !CORE_EDGE_RELS.includes(typed.rel as never)) {
      diagnostics.push({
        severity: "fatal",
        code: "unknown_edge_rel",
        message: `Unknown edge relation: ${typed.rel}`,
        file: entry.file,
        line: entry.line,
        id: typeof typed.id === "string" ? typed.id : undefined
      });
    }

    parsed.push({ raw: entry, object: value as AwgObject });
  }

  return { parsed, diagnostics };
}

function buildValidators(schemaOverrides: Record<string, unknown>): Record<string, Validator> {
  const merged: Record<string, object> = { ...schemas };
  for (const [fileName, schema] of Object.entries(schemaOverrides)) {
    const kind = fileName.replace(/\.schema\.json$/, "");
    if (kind in merged && schema && typeof schema === "object") merged[kind] = schema as object;
  }
  const localAjv = new Ajv({ allErrors: true, strict: false });
  return Object.fromEntries(Object.entries(merged).map(([kind, schema]) => [kind, localAjv.compile(schema)]));
}
