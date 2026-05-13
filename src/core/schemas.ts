import { createHash } from "node:crypto";
import { AWG_VERSION, CORE_EDGE_RELS, CORE_KINDS, CORE_NODE_TYPES, CORE_STATUSES } from "./constants.js";
import { stableStringify } from "../util/json.js";

export const coreSchemaNames = ["node", "edge", "event", "view", "lens", "response", "policy", "operation"] as const;

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
      aliases: { type: "array", items: { type: "string" } },
      anchors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { enum: ["file", "symbol", "url", "command", "doc", "external"] },
            path: { type: "string" },
            name: { type: "string" },
            url: { type: "string" },
            label: { type: "string" }
          },
          required: ["kind"],
          additionalProperties: true
        }
      },
      body: { type: "string" },
      fields: { type: "object", additionalProperties: true },
      blocks: {
        type: "array",
        items: {
          type: "object",
          required: ["schemaVersion", "type", "data"],
          properties: {
            schemaVersion: { const: 1 },
            type: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            tone: { type: "string" },
            data: {},
            sourceNodeIds: { type: "array", items: { type: "string" } },
            targetNodeIds: { type: "array", items: { type: "string" } }
          },
          additionalProperties: true
        }
      },
      freshness: {
        type: "object",
        properties: {
          state: { enum: ["current", "historical", "proposed", "superseded", "stale", "needs_review", "unknown", "not_applicable"] },
          last_verified: { type: "string" },
          review_after: { type: "string" },
          verified_by: { type: "string" },
          source_of_truth: { type: "string" },
          stale_reason: { type: "string" },
          supersedes: { type: "array", items: { type: "string" } },
          superseded_by: { type: "string" },
          superseded_at: { type: "string" }
        },
        additionalProperties: true
      }
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

export function schemaBodyForFile(name: string): string {
  return stableStringify(schemaForFile(name));
}

export function schemaContentHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

const preManifestSchemaHashes: Record<string, string[]> = {
  node: [
    "ca72a817708e8e32f0b78fa3c2a34237d7f21db728c343d5ce913ff8ec6e9594",
    "bc942985d74a12464fea0629d2b9ad617c8f7ceae69e8dadbcc8751a9e906265",
    "115c3d6323f763469828cba6444abfae1bfae516ed7820bb83c93c0007d6798c"
  ],
  edge: [
    "47ff22398b3e6504e66546ce7c2f0dcd27f3e7273f9b21829dfda95675b59041",
    "ac0fb699fa3fbb55d90b14771b9813463e2f1c98c2b0554729e842a5786ee365",
    "7cedace9695d4c95b49e92a7665ba9d5e82a8b39cd59cee1d8292cd9831afde1"
  ],
  event: [
    "1b1c57fbb42cbb1780ec032e003a122cf02dfb2673681380e40ded70f6659b54",
    "07e23aab500629487b709315e7385d872dbc87f5787a93417f4e5b796e44d5c8"
  ],
  view: [
    "4943bdfad8a164a1448d7e1a62c3874af537321c00a47fa27fe2ed167b17f500",
    "5f2f1f62dd66a83601d00647fe3c8bffdc2143b1299aae8684781d7b40c62f1e"
  ],
  lens: [
    "7ac05358ecc4c83d94817ff95dd7709b01bb3cf2b092e7353ac426d1ade2db18",
    "9c2d417ed57da967147dd021f9a3fc7ce805cf75c43e2f27acd2fa83727bd603"
  ],
  response: [
    "509876d7c346e3b5c5f3c8edade4dd29a3e93760979d661ed87369becfe2ca55",
    "9e3b4d2225d594c4df41eeae2375cb8e6b991ef9a1ef181a4b7c9b4991975102"
  ],
  policy: [
    "98658a07218963e4bf27a2e6bdc4144bf1db868cc78b31231536b53df4571ff3",
    "c6578eece4770fab5b3bbaa664e5366fbea908ae3aa82326996d196af624cd0a"
  ],
  operation: [
    "08d11a3d3055bf899df5e8e6f8f750789c8813bb5ce314ebbd18661effcca464",
    "b8908166c471ebad1158aeb50f98f79f32200ad601c98f287b94aad9cda36868"
  ]
};

export function isKnownAwgManagedSchemaBody(name: string, body: string): boolean {
  return preManifestSchemaHashes[name]?.includes(schemaContentHash(body)) ?? false;
}

export function currentSchemaManifest(): object {
  const entries = Object.fromEntries(coreSchemaNames.map((name) => [name, { hash: schemaContentHash(schemaBodyForFile(name)) }]));
  return { version: AWG_VERSION, managedBy: "awg", hashAlgorithm: "sha256", schemas: entries };
}

export { CORE_EDGE_RELS, CORE_NODE_TYPES, CORE_STATUSES };
