import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { buildAwg } from "../../core/compiler.js";
import { num, str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function claimCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  if (sub === "status") {
    const id = parsed.positionals[2];
    if (!id) throw new Error("Usage: awg claim status <node-id> [--json]");
    const claim = graph.claim_index?.claims.find((item) => item.id === id);
    if (!claim) throw new Error(`Claim not found: ${id}`);
    if (parsed.flags.json) return printJson({ ok: true, claim });
    console.log(`${claim.id} ${claim.verificationStatus}: ${claim.title}`);
    return;
  }
  throw new Error("Usage: awg claim status <node-id> [--json]");
}

export async function claimsCommand(parsed: ParsedArgs): Promise<void> {
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const limit = num(parsed.flags, "limit", Number.MAX_SAFE_INTEGER);
  const status = str(parsed.flags, "status");
  const kind = str(parsed.flags, "kind");
  const tag = str(parsed.flags, "tag");
  const claims = (graph.claim_index?.claims ?? []).filter((claim) => {
    if (status && claim.verificationStatus !== status && claim.nodeStatus !== status) return false;
    if (kind && claim.claimKind !== kind) return false;
    if (tag) {
      const node = graph.nodes.find((item) => item.id === claim.id);
      if (!(node?.tags ?? []).includes(tag)) return false;
    }
    return true;
  }).slice(0, limit);
  const output = { ...(graph.claim_index ?? { awg: "0.1", kind: "claim-index", generated_at: graph.generated_at, summary: emptySummary() }), claims, summary: summarize(claims) };
  if (parsed.flags.json) return printJson(output);
  for (const claim of claims) console.log(`${claim.id} ${claim.verificationStatus}: ${claim.title}`);
}

function summarize(claims: Array<{ verificationStatus: string; nodeStatus: string; stale: boolean; expired: boolean }>): ReturnType<typeof emptySummary> {
  return {
    total: claims.length,
    verified: claims.filter((item) => item.verificationStatus === "verified").length,
    supported: claims.filter((item) => item.verificationStatus === "supported").length,
    unverified: claims.filter((item) => item.verificationStatus === "unverified").length,
    contradicted: claims.filter((item) => item.verificationStatus === "contradicted").length,
    stale: claims.filter((item) => item.stale || item.verificationStatus === "stale").length,
    expired: claims.filter((item) => item.expired || item.verificationStatus === "expired").length,
    needs_review: claims.filter((item) => item.nodeStatus === "needs_review").length
  };
}

function emptySummary() {
  return { total: 0, verified: 0, supported: 0, unverified: 0, contradicted: 0, stale: 0, expired: 0, needs_review: 0 };
}
