import { buildAwg } from "../../core/compiler.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import type { ParsedArgs } from "../args.js";

export async function doctorCommand(parsed: ParsedArgs): Promise<void> {
  const result = await buildAwg(new FileAwgStorage(), { write: true });
  if (result.diagnostics.summary.fatal_error_count > 0) process.exitCode = 1;
  const fixSuggestions = parsed.flags["fix-suggestions"] ? result.diagnostics.diagnostics.map(suggestFix).filter(Boolean) : undefined;
  if (parsed.flags.json) {
    console.log(JSON.stringify(fixSuggestions ? { ...result.diagnostics, fixSuggestions } : result.diagnostics, null, 2));
    return;
  }
  for (const diag of result.diagnostics.diagnostics) {
    console.log(`${diag.severity.toUpperCase()} ${diag.code}${diag.id ? ` ${diag.id}` : ""}: ${diag.message}`);
    const fix = parsed.flags["fix-suggestions"] ? suggestFix(diag) : undefined;
    if (fix) console.log(`  suggestion: ${fix.suggestedCommands.join(" && ")}`);
  }
  if (result.diagnostics.diagnostics.length === 0) console.log("No diagnostics.");
}

function suggestFix(diag: { code: string; id?: string }): { code: string; nodeIds?: string[]; edgeIds?: string[]; suggestedCommands: string[] } | undefined {
  const id = diag.id;
  if (!id) return undefined;
  if (diag.code === "completed_task_without_evidence") return { code: "AWG_HEALTH_COMPLETED_WITHOUT_EVIDENCE", nodeIds: [id], suggestedCommands: [`awg add evidence --target ${id} --summary "..." --source terminal`] };
  if (diag.code === "orphan_node") return { code: "AWG_HEALTH_ORPHAN_NODE", nodeIds: [id], suggestedCommands: [`awg add edge --from ${id} --rel relates_to --to <related-node-id>`] };
  if (diag.code === "stale_node") return { code: "AWG_HEALTH_STALE_NODE", nodeIds: [id], suggestedCommands: [`awg update node ${id} --status needs_review`] };
  if (diag.code === "current_node_missing_verification") return { code: "AWG_HEALTH_VERIFY_CURRENT_NODE", nodeIds: [id], suggestedCommands: [`awg update node ${id} --freshness-json '{"last_verified":"YYYY-MM-DD","verified_by":"agent:codex"}'`] };
  if (diag.code === "unsupported_block_type" || diag.code.startsWith("invalid_block")) return { code: "AWG_HEALTH_REVIEW_NODE_BLOCKS", nodeIds: [id], suggestedCommands: [`awg update node ${id} --clear-blocks`] };
  if (diag.code === "active_risk_with_completed_mitigation") return { code: "AWG_HEALTH_REVIEW_ACTIVE_RISK", nodeIds: [id], suggestedCommands: [`awg update node ${id} --status needs_review`] };
  if (diag.code === "active_blocker_linked_to_resolved_work") return { code: "AWG_HEALTH_REVIEW_ACTIVE_BLOCKER", nodeIds: [id], suggestedCommands: [`awg update node ${id} --status resolved`] };
  if (diag.code === "decision_implemented_while_proposed") return { code: "AWG_HEALTH_REVIEW_PROPOSED_DECISION", nodeIds: [id], suggestedCommands: [`awg update node ${id} --status needs_review`] };
  if (diag.code === "dangling_edge") return { code: "AWG_HEALTH_DANGLING_EDGE", edgeIds: [id], suggestedCommands: ["Create the missing endpoint node, or add a corrective/superseding edge."] };
  return undefined;
}
