import { AWG_VERSION } from "./constants.js";
import { evidenceIdsFromNode } from "./evidence.js";
import type { AwgEdge, AwgNode, ClaimIndex, ClaimIndexRecord, ClaimVerificationStatus, Diagnostic, EvidenceIndex, EvidenceIndexRecord } from "./types.js";

const CLAIM_STATUSES = new Set(["unverified", "supported", "verified", "contradicted", "stale", "expired", "not_applicable"]);
const HISTORICAL_STATUSES = new Set(["archived", "superseded", "rejected"]);

export function buildEvidenceIndex(nodes: AwgNode[], edges: AwgEdge[], generatedAt: string, asOf = Date.parse(generatedAt)): EvidenceIndex {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const evidence = [
    ...nodes.filter((node) => node.type === "evidence").map((node) => {
    const fields = fieldsOf(node);
    const rawEvidenceStatus = stringField(node, fields, "evidence_status");
    const record: EvidenceIndexRecord = {
      id: node.id,
      title: node.title,
      summary: node.summary,
      source: stringField(node, fields, "source"),
      evidenceStatus: rawEvidenceStatus ?? "unknown",
      evidenceStatusMissing: !rawEvidenceStatus,
      observedAt: stringField(node, fields, "observed_at") ?? node.created_at,
      reviewAfter: stringField(node, fields, "review_after"),
      expiresAt: stringField(node, fields, "expires_at"),
      expired: isPast(stringField(node, fields, "expires_at"), asOf),
      targetIds: [],
      supportsIds: [],
      contradictsIds: [],
      verifiesIds: [],
      derivedTargetIds: []
    };
    for (const edge of edges) {
      if (edge.from === node.id && ["supports", "contradicts"].includes(edge.rel)) record.targetIds.push(edge.to);
      if (edge.from === node.id && edge.rel === "supports") record.supportsIds.push(edge.to);
      if (edge.from === node.id && edge.rel === "contradicts") record.contradictsIds.push(edge.to);
      if (edge.to === node.id && edge.rel === "verified_by") record.verifiesIds.push(edge.from);
      if (edge.to === node.id && edge.rel === "derived_from") record.derivedTargetIds.push(edge.from);
    }
    for (const target of nodes) {
      if (evidenceIdsFromNode(target).has(node.id)) {
        record.targetIds.push(target.id);
        record.supportsIds.push(target.id);
      }
    }
    record.targetIds = sorted(record.targetIds);
    record.supportsIds = sorted(record.supportsIds);
    record.contradictsIds = sorted(record.contradictsIds);
    record.verifiesIds = sorted(record.verifiesIds);
    record.derivedTargetIds = sorted(record.derivedTargetIds);
    if (!byId.has(node.id)) return record;
    return record;
    }),
    ...nodes.flatMap((node) => inlineEvidenceRecords(node, asOf))
  ].sort((a, b) => evidenceSort(a, b));
  return {
    awg: AWG_VERSION,
    kind: "evidence-index",
    generated_at: generatedAt,
    evidence,
    summary: {
      total: evidence.length,
      passed: evidence.filter((item) => item.evidenceStatus === "passed").length,
      failed: evidence.filter((item) => item.evidenceStatus === "failed").length,
      unknown: evidence.filter((item) => item.evidenceStatus === "unknown").length,
      expired: evidence.filter((item) => item.expired).length
    }
  };
}

export function buildClaimIndex(nodes: AwgNode[], edges: AwgEdge[], evidenceIndex: EvidenceIndex, generatedAt: string, asOf = Date.parse(generatedAt)): ClaimIndex {
  const evidenceById = new Map(evidenceIndex.evidence.map((item) => [item.id, item]));
  const nodeIds = new Set(nodes.map((item) => item.id));
  const claimNodes = nodes.filter(isClaimBearingNode);
  const claims = claimNodes.map((node) => {
    const fields = fieldsOf(node);
    const inlineEvidence = [
      ...[...evidenceIdsFromNode(node)].map((id) => evidenceById.get(id)).filter((item): item is EvidenceIndexRecord => Boolean(item)),
      ...inlineEvidenceRecords(node, asOf)
    ];
    const supports = uniqueEvidence([...evidenceIndex.evidence.filter((evidence) => evidence.supportsIds.includes(node.id)), ...inlineEvidence]).filter((evidence) => ["passed", "unknown"].includes(evidence.evidenceStatus));
    const contradicts = evidenceIndex.evidence.filter((evidence) => evidence.contradictsIds.includes(node.id));
    const verifiedBy = evidenceIndex.evidence.filter((evidence) => evidence.verifiesIds.includes(node.id));
    const derivedFromIds = sorted(edges.filter((edge) => edge.from === node.id && edge.rel === "derived_from").map((edge) => edge.to));
    const expiredEvidenceIds = sorted([...supports, ...contradicts, ...verifiedBy].filter((evidence) => evidence.expired).map((evidence) => evidence.id));
    const reviewAfter = stringField(node, fields, "review_after") ?? node.freshness?.review_after ?? node.review_after;
    const expiresAt = stringField(node, fields, "expires_at");
    const stale = isPast(reviewAfter, asOf) || node.status === "stale" || node.freshness?.state === "stale" || node.freshness?.state === "needs_review";
    const expired = isPast(expiresAt, asOf);
    const fieldStatus = stringField(node, fields, "verification_status");
    const diagnostics: string[] = [];
    const active = !HISTORICAL_STATUSES.has(node.status);
    const sourceOfTruth = stringField(node, fields, "source_of_truth") ?? node.freshness?.source_of_truth;
    if (expired) diagnostics.push("claim_expired");
    if (stale && active) diagnostics.push("verification_stale");
    if (contradicts.some((evidence) => evidence.evidenceStatus !== "superseded" && !evidence.expired)) diagnostics.push("claim_contradicted");
    if (active && (node.evidence_required || node.type === "claim") && supports.length === 0 && verifiedBy.length === 0 && !stringField(node, fields, "verified_at")) diagnostics.push("claim_without_evidence", "claim_unverified");
    if (node.status === "active" && ["expired", "stale", "contradicted"].includes(fieldStatus ?? "")) diagnostics.push("claim_status_conflict");
    if (sourceOfTruthMissing(sourceOfTruth, nodeIds, nodes)) diagnostics.push("source_of_truth_missing");
    const verificationStatus = deriveVerificationStatus({
      fieldStatus,
      stale,
      expired,
      supports,
      contradicts,
      verifiedBy,
      verifiedAt: stringField(node, fields, "verified_at") ?? node.freshness?.last_verified
    });
    return {
      id: node.id,
      title: node.title,
      summary: node.summary,
      claim: stringField(node, fields, "claim") ?? node.summary,
      claimKind: stringField(node, fields, "claim_kind") ?? node.type,
      nodeStatus: node.status,
      verificationStatus,
      sourceOfTruth,
      supportingEvidenceIds: sorted(supports.map((item) => item.id)),
      contradictingEvidenceIds: sorted(contradicts.map((item) => item.id)),
      verifiedByEvidenceIds: sorted(verifiedBy.map((item) => item.id)),
      derivedFromIds,
      latestSupportingEvidenceAt: latestIso([...supports.map((item) => item.observedAt), ...verifiedBy.map((item) => item.observedAt)]),
      latestVerificationAt: latestIso([stringField(node, fields, "verified_at"), node.freshness?.last_verified, ...verifiedBy.map((item) => item.observedAt), ...supports.filter((item) => item.evidenceStatus === "passed").map((item) => item.observedAt)]),
      reviewAfter,
      expiresAt,
      expiredEvidenceIds,
      stale,
      expired,
      diagnostics: sorted(diagnostics.filter(Boolean))
    } satisfies ClaimIndexRecord;
  }).sort((a, b) => claimSort(a, b));
  return {
    awg: AWG_VERSION,
    kind: "claim-index",
    generated_at: generatedAt,
    claims,
    summary: {
      total: claims.length,
      verified: claims.filter((item) => item.verificationStatus === "verified").length,
      supported: claims.filter((item) => item.verificationStatus === "supported").length,
      unverified: claims.filter((item) => item.verificationStatus === "unverified").length,
      contradicted: claims.filter((item) => item.verificationStatus === "contradicted").length,
      stale: claims.filter((item) => item.stale || item.verificationStatus === "stale").length,
      expired: claims.filter((item) => item.expired || item.verificationStatus === "expired").length,
      needs_review: claims.filter((item) => item.nodeStatus === "needs_review").length
    }
  };
}

function inlineEvidenceRecords(node: AwgNode, asOf: number): EvidenceIndexRecord[] {
  if (!Array.isArray(node.evidence)) return [];
  return node.evidence.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (typeof record.id === "string" || typeof record.nodeId === "string") return [];
    const summary = typeof record.summary === "string" ? record.summary : "Inline evidence";
    const evidenceStatus = typeof record.status === "string" ? record.status : typeof record.evidence_status === "string" ? record.evidence_status : "unknown";
    const source = typeof record.source === "string" ? record.source : undefined;
    return [{
      id: `${node.id}:inline-evidence:${index + 1}`,
      title: summary.slice(0, 80),
      summary,
      source,
      evidenceStatus,
      evidenceStatusMissing: !("status" in record || "evidence_status" in record),
      observedAt: typeof record.at === "string" ? record.at : node.updated_at,
      reviewAfter: typeof record.review_after === "string" ? record.review_after : undefined,
      expiresAt: typeof record.expires_at === "string" ? record.expires_at : undefined,
      expired: isPast(typeof record.expires_at === "string" ? record.expires_at : undefined, asOf),
      targetIds: [node.id],
      supportsIds: [node.id],
      contradictsIds: [],
      verifiesIds: [],
      derivedTargetIds: []
    } satisfies EvidenceIndexRecord];
  });
}

export function claimDiagnostics(claimIndex: ClaimIndex, evidenceIndex: EvidenceIndex, edges: AwgEdge[], strict: boolean): Diagnostic[] {
  const severity = strict ? "fatal" : "warning";
  const diagnostics: Diagnostic[] = [];
  for (const claim of claimIndex.claims) {
    for (const code of claim.diagnostics) diagnostics.push({ severity, code, message: claimDiagnosticMessage(code, claim), id: claim.id, fixSuggestion: claimFixSuggestion(code, claim.id) });
  }
  for (const evidence of evidenceIndex.evidence) {
    if (!evidence.source) diagnostics.push({ severity, code: "evidence_missing_source", message: `Evidence lacks source: ${evidence.id}`, id: evidence.id, fixSuggestion: { command: `awg update node ${evidence.id} --field source=manual` } });
    if (evidence.evidenceStatusMissing) diagnostics.push({ severity, code: "evidence_missing_status", message: `Evidence lacks evidence_status: ${evidence.id}`, id: evidence.id, fixSuggestion: { command: `awg update node ${evidence.id} --field evidence_status=unknown` } });
    if (evidence.expired) diagnostics.push({ severity, code: "evidence_expired", message: `Evidence is expired: ${evidence.id}`, id: evidence.id, fixSuggestion: { command: `awg add evidence --target <node-id> --summary "..." --source manual && awg add edge --from <new-evidence-id> --rel supersedes --to ${evidence.id}` } });
  }
  for (const edge of edges) {
    if (["verified_by", "derived_from"].includes(edge.rel) && evidenceIndex.evidence.some((item) => item.id === edge.from) && !edges.some((candidate) => candidate.from === edge.to && candidate.rel === edge.rel && candidate.to === edge.from)) diagnostics.push({ severity, code: "claim_relation_direction_mismatch", message: `Proof relation ${edge.rel} uses evidence -> target direction: ${edge.id}`, id: edge.id, fixSuggestion: { command: `awg add edge --from ${edge.to} --rel ${edge.rel} --to ${edge.from}` } });
  }
  return diagnostics;
}

export function isClaimBearingNode(node: AwgNode): boolean {
  const fields = fieldsOf(node);
  return node.type === "claim" || typeof fields.claim === "string" || typeof fields.claim_kind === "string";
}

function deriveVerificationStatus(input: { fieldStatus?: string; stale: boolean; expired: boolean; supports: EvidenceIndexRecord[]; contradicts: EvidenceIndexRecord[]; verifiedBy: EvidenceIndexRecord[]; verifiedAt?: string }): ClaimVerificationStatus {
  if (input.expired) return "expired";
  if (input.contradicts.some((item) => item.evidenceStatus !== "superseded" && !item.expired)) return "contradicted";
  if (input.stale) return "stale";
  if (input.fieldStatus && CLAIM_STATUSES.has(input.fieldStatus)) return input.fieldStatus as ClaimVerificationStatus;
  if (input.verifiedAt || input.verifiedBy.some((item) => item.evidenceStatus === "passed" && !item.expired) || input.supports.some((item) => item.evidenceStatus === "passed" && !item.expired)) return "verified";
  if (input.supports.some((item) => !item.expired)) return "supported";
  return "unverified";
}

function fieldsOf(node: AwgNode): Record<string, unknown> {
  return node.fields && typeof node.fields === "object" && !Array.isArray(node.fields) ? node.fields : {};
}

function stringField(node: AwgNode, fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key] ?? (node as unknown as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isPast(value: string | undefined, asOf: number): boolean {
  if (!value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time < asOf;
}

function latestIso(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value))).sort().at(-1);
}

function sorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueEvidence(values: EvidenceIndexRecord[]): EvidenceIndexRecord[] {
  return [...new Map(values.map((item) => [item.id, item])).values()];
}

function sourceOfTruthMissing(value: string | undefined, nodeIds: Set<string>, nodes: AwgNode[]): boolean {
  if (!value || /^https?:\/\//i.test(value)) return false;
  if (value.startsWith("n:")) return !nodeIds.has(value);
  const localPath = value.replace(/^(file|path):/, "");
  if (!localPath || localPath === value && /:/.test(value)) return false;
  return !nodes.some((node) => (node.anchors ?? []).some((anchor) => anchor.path === localPath || anchor.label === localPath));
}

function claimSort(a: ClaimIndexRecord, b: ClaimIndexRecord): number {
  return statusRank(b) - statusRank(a) || String(b.latestVerificationAt ?? b.reviewAfter ?? "").localeCompare(String(a.latestVerificationAt ?? a.reviewAfter ?? "")) || a.id.localeCompare(b.id);
}

function evidenceSort(a: EvidenceIndexRecord, b: EvidenceIndexRecord): number {
  return Number(b.expired) - Number(a.expired) || String(b.observedAt ?? "").localeCompare(String(a.observedAt ?? "")) || a.id.localeCompare(b.id);
}

function statusRank(claim: ClaimIndexRecord): number {
  if (claim.verificationStatus === "contradicted") return 6;
  if (claim.verificationStatus === "expired") return 5;
  if (claim.verificationStatus === "stale") return 4;
  if (claim.verificationStatus === "unverified") return 3;
  if (claim.nodeStatus === "needs_review") return 2;
  return 1;
}

function claimDiagnosticMessage(code: string, claim: ClaimIndexRecord): string {
  if (code === "claim_without_evidence") return `Claim has no evidence: ${claim.id}`;
  if (code === "claim_unverified") return `Claim is unverified: ${claim.id}`;
  if (code === "claim_contradicted") return `Claim has contradictory evidence: ${claim.id}`;
  if (code === "claim_expired") return `Claim is expired: ${claim.id}`;
  if (code === "verification_stale") return `Claim verification is stale: ${claim.id}`;
  if (code === "claim_status_conflict") return `Claim status conflicts with verification status: ${claim.id}`;
  if (code === "source_of_truth_missing") return `Claim source_of_truth is missing: ${claim.id}`;
  return `Claim diagnostic ${code}: ${claim.id}`;
}

function claimFixSuggestion(code: string, id: string): unknown {
  if (code === "claim_without_evidence" || code === "claim_unverified") return { command: `awg add evidence --target ${id} --summary "..." --source manual` };
  if (code === "claim_contradicted") return { command: `awg claim status ${id} --json` };
  if (code === "claim_expired" || code === "verification_stale") return { command: `awg update node ${id} --status needs_review` };
  if (code === "source_of_truth_missing") return { command: `awg update node ${id} --field source_of_truth=<node-id-or-path>` };
  return undefined;
}
