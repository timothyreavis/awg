# AWG V2.2 Claims, Evidence, and Verification

V2.2 makes AWG better at distinguishing durable knowledge that is proven, assumed, stale, contradicted, historical, or still awaiting review.

This is a trust layer for long-lived agent brains. It should help future agents answer: what does this vault claim, why do we believe it, when was it last verified, what contradicts it, and what should be checked before acting on it?

## Principles

- Keep the model local-first, deterministic, append-only, and domain-agnostic.
- Preserve existing `node`, `edge`, `event`, `response`, `view`, `lens`, and `policy` primitives.
- Prefer typed fields and relationships over a parallel database.
- Treat evidence as proof or support, not as a place to bury long explanations.
- Treat claims as reviewable statements, not generic notes.
- Make stale, contradicted, unsupported, and expired knowledge visible without blocking normal partial or exploratory work.
- Never call AI, use vector search, crawl the repository, or reach the network for verification.

## Claim Model

Claims may be represented by normal nodes with `type: "claim"` and structured `fields`, or by existing node types that carry claim metadata when the whole node is making an actionable assertion.

V2.2 MVP field contract:

- `claim`: the precise statement being asserted.
- `claim_kind`: `fact`, `assumption`, `hypothesis`, `requirement`, `policy`, `metric`, `external_fact`, or `implementation_fact`.
- `verification_status`: `unverified`, `supported`, `verified`, `contradicted`, `stale`, `expired`, or `not_applicable`.
- `verified_at`: ISO timestamp for the latest successful verification.
- `verified_by`: agent, human, command, or source label.
- `source_of_truth`: file, URL, system, person, document, command, or node id that should be treated as authoritative.
- `review_after`: ISO date/time when the claim should be rechecked.
- `expires_at`: ISO date/time after which the claim should not be treated as current.
- `reliability`: `low`, `medium`, `high`, or a documented numeric score if the codebase already uses one.
- `confidence`: keep existing node confidence semantics; do not replace it with verification status.
- `scope`: optional domain or workflow boundary.

Status guidance:

- Use `status: active` for a claim that is currently relevant.
- Use `status: needs_review` for a claim that may matter but should not be trusted yet.
- Use `status: stale` when the claim is likely outdated.
- Use `status: superseded` or `archived` for historical claims that should not drive current behavior.

## Evidence Model

V2.2 should strengthen existing `type: "evidence"` nodes rather than replacing them.

V2.2 MVP evidence fields:

- `evidence_status`: `passed`, `failed`, `unknown`, or `superseded`.
- `source`: `terminal`, `test`, `manual`, `file`, `url`, `log`, `doc`, `system`, or `other`. V2.2 extends the existing `add evidence` source enum with `doc` and `system`.
- `summary`: concise proof summary.
- `command`: command that produced the result, when relevant.
- `path`: file or artifact path, when relevant.
- `url`: URL, when relevant.
- `observed_at`: ISO timestamp for when the evidence was gathered.
- `expires_at`: ISO timestamp after which evidence should be treated as expired.
- `review_after`: ISO timestamp for scheduled re-verification.
- `reliability`: `low`, `medium`, `high`, or a bounded numeric value if already supported.
- `excerpt`: short non-sensitive excerpt when needed.
- `redacted`: boolean marker if sensitive details were omitted.

The implementation must preserve current evidence compatibility:

- Older evidence nodes with top-level `source`, `evidence_status`, `command`, and `path` remain valid.
- New metadata may be stored as top-level fields when that matches current evidence shape, or under `fields` when needed for structured additions. The derived evidence index must normalize both shapes.
- Inline target `evidence[]` remains a compact compatibility summary and should include at least `id`, `summary`, `source`, `status`, and `at`; it may include `url`, `path`, `expires_at`, and `review_after` when present.
- Unknown evidence fields remain preserved.

Canonical relation directions:

- `supports`: evidence/source node -> claim or target node.
- `contradicts`: evidence/source node -> claim or target node.
- `verified_by`: claim or target node -> evidence node.
- `derived_from`: claim or target node -> evidence/source node.
- `supersedes`: newer evidence node -> older evidence node.
- `superseded_by`: older evidence node -> newer evidence node.

`awg add evidence --rel supports|contradicts` must create an evidence -> target edge. `awg add evidence --rel verified_by|derived_from` must normalize direction by creating a target -> evidence edge, because the relation meaning is source verified by or derived from target. For other relations, `add evidence` should fail with a clear message and direct users to `awg add edge` for non-proof relationships. The compiler should preserve historical edges but should only count relation directions above for claim trust derivation. If it sees an evidence -> target `verified_by` or `derived_from` edge, it should warn with `claim_relation_direction_mismatch` rather than silently treating it as verification.

## Verification Semantics

Verification is deterministic state derived from node fields and relationships.

Suggested derived states:

- `unverified`: claim has no supporting evidence and no verified metadata.
- `supported`: claim has supporting evidence but no explicit verification timestamp.
- `verified`: claim has current supporting evidence or `verified_at` metadata.
- `contradicted`: claim has active contradictory evidence or a `contradicts` relation.
- `stale`: review date is past or freshness indicates stale/needs_review.
- `expired`: claim or evidence has `expires_at` in the past.
- `historical`: node status or freshness state indicates historical/archived/superseded.

Do not infer truth from confidence alone. Confidence is an agent belief signal; verification status is an evidence and currentness signal.

## CLI Contract

V2.2 must implement this MVP command surface. Do not leave the implementer to choose between semantic commands and raw field manipulation.

- `awg add claim --title "..." --claim "..." [--summary "..."] [--kind fact|assumption|hypothesis|requirement|policy|metric|external_fact|implementation_fact] [--source-of-truth "..."] [--review-after <date>] [--evidence-required] [--tag <tag>] [--run <run-id>|--no-run] [--json]`
- `awg verify <node-id> --summary "..." [--source terminal|test|manual|file|url|log|doc|system|other] [--command "..."] [--path "..."] [--url "..."] [--status passed|failed|unknown] [--rel supports|contradicts] [--expires-at <date>] [--review-after <date>] [--reliability low|medium|high] [--excerpt "..."] [--redacted] [--run <run-id>|--no-run] [--json]`
- `awg claim status <node-id> [--json]`
- `awg claims [--status verified|supported|unverified|contradicted|stale|expired|needs_review] [--kind <claim_kind>] [--tag <tag>] [--limit <n>] [--json]`

`awg add evidence` must also be extended to accept:

- `--url <url>`
- `--expires-at <date>`
- `--review-after <date>`
- `--reliability low|medium|high`
- `--excerpt "..."`
- `--redacted`
- `--source doc|system`
- `--rel supports|contradicts|verified_by|derived_from` with the direction rules above.

Exact JSON results:

- `awg add claim --json` returns `{ "ok": true, "claimId": "n:...", "node": { ... } }`.
- `awg verify --json` returns `{ "ok": true, "target": "n:...", "evidenceNodeId": "n:...", "edgeIds": ["e:..."], "eventId": "ev:...", "verificationStatus": "verified|supported|contradicted|unverified" }`.
- `awg claim status --json` returns `{ "ok": true, "claim": { ...claimIndexRecord } }`.
- `awg claims --json` returns the same shape as `.awg/compiled/indexes/claims.json`.

`awg add claim` creates a normal `type: "claim"` node. If `--summary` is omitted, use a deterministic compact summary derived from `--claim`. It must support the existing run attribution flags. The created node should set `fields.claim`, `fields.claim_kind`, `fields.verification_status`, `fields.source_of_truth`, and freshness/review metadata where compatible with the current model.

`awg verify` creates a normal evidence node and updates the target node append-only with verification metadata. Defaults:

- `--source` defaults to `manual`.
- `--status` defaults to `passed`.
- `--rel` defaults to `supports` for `passed` or `unknown`, and `contradicts` for `failed`.
- `passed` evidence sets or derives `verification_status: "verified"` when the evidence is current.
- `unknown` supporting evidence sets or derives `verification_status: "supported"` unless stronger verification already exists.
- `failed` evidence sets or derives `verification_status: "contradicted"`.

The old raw path remains valid for advanced use, but it is not the V2.2 primary interface:

- `awg add node --type claim ... --fields-json ...`
- `awg add evidence --target <node-id> ...`
- `awg update node <node-id> --field verification_status=verified ...`

## Compiler Output

The compiler must derive stable claim and evidence indexes:

- `graph.claim_index`
- `graph.evidence_index`
- `.awg/compiled/indexes/claims.json`
- `.awg/compiled/indexes/evidence.json`

The `graph.claim_index` object and `.awg/compiled/indexes/claims.json` file must share this shape:

```json
{
  "awg": "0.1",
  "kind": "claim-index",
  "generated_at": "2026-05-16T00:00:00.000Z",
  "claims": [],
  "summary": {
    "total": 0,
    "verified": 0,
    "supported": 0,
    "unverified": 0,
    "contradicted": 0,
    "stale": 0,
    "expired": 0,
    "needs_review": 0
  }
}
```

Each claim record must include:

- `id`
- `title`
- `summary`
- `claim`
- `claimKind`
- `nodeStatus`
- `verificationStatus`
- `sourceOfTruth`
- `supportingEvidenceIds`
- `contradictingEvidenceIds`
- `verifiedByEvidenceIds`
- `derivedFromIds`
- `latestSupportingEvidenceAt`
- `latestVerificationAt`
- `reviewAfter`
- `expiresAt`
- `expiredEvidenceIds`
- `stale`
- `expired`
- `diagnostics`

The `graph.evidence_index` object and `.awg/compiled/indexes/evidence.json` file must share this shape:

```json
{
  "awg": "0.1",
  "kind": "evidence-index",
  "generated_at": "2026-05-16T00:00:00.000Z",
  "evidence": [],
  "summary": {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "unknown": 0,
    "expired": 0
  }
}
```

Each evidence record must include:

- `id`
- `title`
- `summary`
- `source`
- `evidenceStatus`
- `observedAt`
- `reviewAfter`
- `expiresAt`
- `expired`
- `targetIds`
- `supportsIds`
- `contradictsIds`
- `verifiesIds`
- `derivedTargetIds`

Keep ordering deterministic by severity, priority, date, then id.

## Diagnostics

V2.2 diagnostics should be warnings unless graph shape is malformed or strict mode is enabled.

Recommended diagnostics:

- `claim_without_evidence`: active claim requires or implies evidence but has none.
- `claim_unverified`: active claim is marked unverified and has no support.
- `claim_contradicted`: active claim has contradictory active evidence.
- `claim_expired`: claim has past `expires_at`.
- `evidence_expired`: evidence has past `expires_at`.
- `evidence_missing_source`: evidence lacks a useful source field.
- `evidence_missing_status`: evidence lacks a usable result status.
- `verification_stale`: verified claim has past `review_after`.
- `source_of_truth_missing`: claim names a missing local node/file reference where AWG can safely check it.
- `claim_status_conflict`: node status/freshness conflicts with verification status.
- `claim_relation_direction_mismatch`: a proof relation uses the wrong direction for V2.2 trust derivation.

Doctor fix suggestions must be conservative and non-mutating:

- add evidence to a claim.
- review a contradicted claim.
- mark stale/expired claims `needs_review`.
- supersede old evidence with newer evidence.
- update a claim with `source_of_truth`.

Do not suggest destructive commands.

## Inbox, Preflight, Handoff, And Lenses

V2.2 should surface claim trust issues in existing agent surfaces:

- Maintenance inbox must add kind `"claims"` and include unverified, contradicted, expired, and stale claim items.
- Run finish preflight must warn when a run touches or creates important unverified claims, completes claim/evidence work without evidence, or leaves contradictions unresolved.
- Handoff must include compact claim trust issues affecting current or recent run context.
- Task lenses and configurable lenses must be able to include claim/evidence sections without dumping the whole graph.
- Handoff quality scoring must penalize unresolved contradictions and missing evidence for completed claim-bearing work.

Maintenance inbox item contracts:

- `AWG_INBOX_CLAIM_CONTRADICTED`, kind `claims`, severity `warning`, priority `96`.
- `AWG_INBOX_CLAIM_EXPIRED`, kind `claims`, severity `warning`, priority `92`.
- `AWG_INBOX_CLAIM_STALE`, kind `claims`, severity `warning`, priority `88`.
- `AWG_INBOX_CLAIM_UNVERIFIED_REQUIRED`, kind `claims`, severity `warning`, priority `84`.
- `AWG_INBOX_EVIDENCE_EXPIRED`, kind `evidence`, severity `warning`, priority `82`.

Run preflight warning codes:

- `AWG_RUN_CLAIM_CONTRADICTION_UNRESOLVED`
- `AWG_RUN_CLAIM_REQUIRED_EVIDENCE_MISSING`
- `AWG_RUN_CLAIM_STALE_OR_EXPIRED`
- `AWG_RUN_EVIDENCE_EXPIRED`

Configurable lenses must add source `"claims"` to `LENS_SECTION_SOURCES`. Supported claim query keys:

- `verificationStatus`
- `claimKind`
- `status`
- `tag`
- `sourceOfTruth`
- `needsAttention`
- `nodeIds`
- `limit`

The existing `"evidence"`, `"maintenanceInbox"`, and `"diagnostics"` lens sources should keep working. Agents can still use `"nodes"` with `type=claim`, but `"claims"` is the preferred V2.2 source because it returns derived trust records instead of raw node snapshots.

## Viewer Surface

Viewer work should stay minimal unless the existing route architecture makes it cheap.

Useful low-risk surfaces:

- node detail: show claim fields, verification status, supporting evidence, contradicting evidence, expiry/review dates.
- health/maintenance: surface high-priority claim/evidence warnings.
- authored views/lenses: allow claim/evidence lists through existing safe primitives.

Do not add a large claims dashboard in this slice unless it falls out naturally from V2.0 view primitives.

## Agent Guidance

Generated instructions should teach agents:

- Capture claims only when a statement may guide future work.
- Use `claim` nodes or claim fields for reviewable assertions.
- Use evidence nodes for proof, command output summaries, source observations, tests, audits, or manual verification.
- Mark assumptions and hypotheses honestly instead of presenting them as verified facts.
- Add evidence before marking claim-bearing work complete.
- Update or mark stale claims when implementation, process, pricing, policy, source-of-truth, or external facts change.
- Use contradictions explicitly instead of silently replacing old claims.
- Keep sensitive evidence redacted and store paths/references instead of secrets.

## Tests Required

- Older vaults without claim metadata still compile.
- Existing evidence behavior still works.
- Unknown fields are preserved.
- Claim nodes and claim fields validate.
- Evidence fields validate without requiring a new database.
- Supporting evidence derives verified/supported state.
- Contradicting evidence derives contradicted state.
- Past `review_after` and `expires_at` produce deterministic diagnostics.
- `doctor --fix-suggestions --json` returns parseable conservative suggestions.
- `inbox --json`, `handoff --json`, and `lens task --json` surface relevant claim/evidence issues within budget.
- Run preflight warns on claim/evidence issues touched by the run.
- `awg add claim`, `awg verify`, `awg claim status`, `awg claims`, and the extended `awg add evidence` flags support `--run`, `--no-run`, clear errors, and stable JSON.
- Fresh temp-vault smoke covers add claim, verify/add evidence, build, doctor, inbox, handoff, and lens task.
- Existing examples still build.
- Full verification: `npm run typecheck`, `npm test`, `awg build --json`, `awg doctor --fix-suggestions --json`, `npm pack --dry-run --json`, and `git diff --check`.

## Non-Goals

- No AI fact checking.
- No web/network verification.
- No source crawling beyond explicitly supplied local paths if a small safe check is implemented.
- No vector search or semantic matching.
- No external trust graph.
- No hosted sync.
- No multi-user approval system.
- No secret storage.
- No destructive merge/rewrite workflow.

## Definition Of Done

AWG can deterministically tell which important claims are supported, verified, stale, expired, contradicted, or unverified; agents can attach evidence without ceremony; future agents can see claim trust status in doctor, inbox, handoff, and lenses; and older vaults continue to work unchanged.
