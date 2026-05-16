import { CORE_EDGE_RELS } from "./constants.js";

export interface RelationHelp {
  id: typeof CORE_EDGE_RELS[number];
  description: string;
  example: string;
}

const DESCRIPTIONS: Record<typeof CORE_EDGE_RELS[number], string> = {
  relates_to: "General contextual relationship.",
  depends_on: "Source cannot proceed or stay valid without target.",
  blocks: "Source is preventing progress on target.",
  supports: "Source provides support or evidence for target.",
  duplicate_of: "Source duplicates target.",
  canonical_for: "Source is the canonical record for target.",
  contradicts: "Source conflicts with target.",
  answers: "Source answers target.",
  asks: "Source asks or raises target.",
  implements: "Source implements target.",
  affects: "Source changes or influences target.",
  supersedes: "Source replaces target.",
  superseded_by: "Source has been replaced by target.",
  resolved_by: "Source is resolved by target.",
  verified_by: "Source is verified by target.",
  derived_from: "Source was derived from target.",
  intentionally_open: "Source is intentionally carried forward by target.",
  part_of: "Source is part of target.",
  caused_by: "Source was caused by target.",
  requires: "Source requires target.",
  recommends: "Source recommends target.",
  references: "Source cites or points at target.",
  owned_by: "Source is owned by target.",
  applies_to: "Source applies to target."
};

export const RELATION_HELP: RelationHelp[] = CORE_EDGE_RELS.map((id) => ({
  id,
  description: DESCRIPTIONS[id],
  example: `awg add edge --from n:source --rel ${id} --to n:target`
}));

export function relationError(rel: string): string {
  return `--rel must be one of: ${CORE_EDGE_RELS.join(", ")}. Run awg rels to list allowed relations with examples.`;
}
