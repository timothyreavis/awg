export const AWG_VERSION = "0.1";

export const CORE_KINDS = ["node", "edge", "event", "view", "lens", "response", "policy"] as const;

export const CORE_NODE_TYPES = [
  "note",
  "concept",
  "entity",
  "task",
  "issue",
  "decision",
  "question",
  "answer",
  "claim",
  "evidence",
  "risk",
  "blocker",
  "artifact",
  "policy",
  "standard",
  "process",
  "requirement",
  "preference",
  "constraint"
] as const;

export const CORE_STATUSES = [
  "draft",
  "proposed",
  "active",
  "accepted",
  "blocked",
  "in_progress",
  "completed",
  "resolved",
  "rejected",
  "superseded",
  "archived",
  "needs_review",
  "stale"
] as const;

export const CORE_EDGE_RELS = [
  "relates_to",
  "depends_on",
  "blocks",
  "supports",
  "contradicts",
  "answers",
  "asks",
  "implements",
  "affects",
  "supersedes",
  "derived_from",
  "part_of",
  "caused_by",
  "requires",
  "recommends",
  "references",
  "owned_by",
  "applies_to"
] as const;
