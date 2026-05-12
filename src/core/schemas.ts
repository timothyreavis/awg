import { AWG_VERSION, CORE_EDGE_RELS, CORE_KINDS, CORE_NODE_TYPES, CORE_STATUSES } from "./constants.js";

const base = {
  type: "object",
  required: ["awg", "kind"],
  properties: {
    awg: { const: AWG_VERSION },
    kind: { enum: CORE_KINDS }
  },
  additionalProperties: true
} as const;

export const schemas = {
  node: {
    ...base,
    required: ["awg", "kind", "id", "type", "title", "summary", "status", "importance", "confidence", "created_at", "updated_at"],
    properties: {
      ...base.properties,
      kind: { const: "node" },
      id: { type: "string", pattern: "^n:.+" },
      type: { type: "string" },
      title: { type: "string", minLength: 1 },
      summary: { type: "string", minLength: 1 },
      status: { enum: CORE_STATUSES },
      importance: { type: "number", minimum: 0, maximum: 1 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      created_at: { type: "string" },
      updated_at: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
      aliases: { type: "array", items: { type: "string" } }
    }
  },
  edge: {
    ...base,
    required: ["awg", "kind", "id", "from", "rel", "to", "created_at"],
    properties: {
      ...base.properties,
      kind: { const: "edge" },
      id: { type: "string", pattern: "^e:.+" },
      from: { type: "string", pattern: "^n:.+" },
      rel: { enum: CORE_EDGE_RELS },
      to: { type: "string", pattern: "^n:.+" },
      created_at: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 }
    }
  },
  event: {
    ...base,
    required: ["awg", "kind", "type", "target", "by", "at"],
    properties: { ...base.properties, kind: { const: "event" }, type: { type: "string" }, target: { type: "string" }, by: { type: "string" }, at: { type: "string" } }
  },
  view: {
    ...base,
    required: ["awg", "kind", "id", "title", "audience", "blocks"],
    properties: { ...base.properties, kind: { const: "view" }, id: { type: "string", pattern: "^v:.+" }, title: { type: "string" }, audience: { type: "string" }, blocks: { type: "array" } }
  },
  lens: {
    ...base,
    required: ["awg", "kind", "id", "title", "purpose", "include"],
    properties: { ...base.properties, kind: { const: "lens" }, id: { type: "string", pattern: "^lens:.+" }, title: { type: "string" }, purpose: { type: "string" }, include: { type: "array" } }
  },
  response: {
    ...base,
    required: ["awg", "kind", "id", "type", "target", "summary", "by", "at"],
    properties: { ...base.properties, kind: { const: "response" }, id: { type: "string", pattern: "^r:.+" }, type: { type: "string" }, target: { type: "string" }, summary: { type: "string" }, by: { type: "string" }, at: { type: "string" } }
  },
  policy: {
    ...base,
    required: ["awg", "kind", "id", "title", "summary", "status"],
    properties: { ...base.properties, kind: { const: "policy" }, id: { type: "string", pattern: "^policy:.+" }, title: { type: "string" }, summary: { type: "string" }, status: { type: "string" } }
  },
  operation: {
    type: "object",
    description: "Reserved for future operation wrappers. V1 JSONL uses direct AWG objects.",
    additionalProperties: true
  }
};

export function schemaForFile(name: string): object {
  return schemas[name as keyof typeof schemas] ?? schemas.operation;
}

export { CORE_EDGE_RELS, CORE_NODE_TYPES, CORE_STATUSES };
