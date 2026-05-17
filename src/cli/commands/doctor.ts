import { buildAwg } from "../../core/compiler.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { nowIso } from "../../util/time.js";
import type { ParsedArgs } from "../args.js";

export async function doctorCommand(parsed: ParsedArgs): Promise<void> {
  const nonMutatingJsonSuggestions = Boolean(parsed.flags["fix-suggestions"] && parsed.flags.json);
  const result = await buildAwg(new FileAwgStorage(), { write: !nonMutatingJsonSuggestions, coordinationAsOf: nowIso() });
  if (result.diagnostics.summary.fatal_error_count > 0) process.exitCode = 1;
  const inboxSuggestions = result.graph.maintenance_inbox?.items.filter((item) => item.suggestedCommands.length).map((item) => ({
    code: item.code,
    itemId: item.id,
    nodeIds: item.nodeIds,
    edgeIds: item.edgeIds,
    runIds: item.runIds,
    autonomousSafe: item.autonomousSafe,
    needsHumanReview: item.needsHumanReview,
    suggestedCommands: item.suggestedCommands
  })) ?? [];
  const fixSuggestions = parsed.flags["fix-suggestions"] ? [...result.diagnostics.diagnostics.map(suggestFix).filter(Boolean), ...inboxSuggestions] : undefined;
  if (parsed.flags.json) {
    console.log(JSON.stringify(fixSuggestions ? { ...result.diagnostics, maintenanceInbox: result.graph.maintenance_inbox, fixSuggestions } : result.diagnostics, null, 2));
    return;
  }
  for (const diag of result.diagnostics.diagnostics) {
    console.log(`${diag.severity.toUpperCase()} ${diag.code}${diag.id ? ` ${diag.id}` : ""}: ${diag.message}`);
    const fix = parsed.flags["fix-suggestions"] ? suggestFix(diag) : undefined;
    if (fix) console.log(`  suggestion: ${fix.suggestedCommands.join(" && ")}`);
  }
  if (result.diagnostics.diagnostics.length === 0) console.log("No diagnostics.");
}

function suggestFix(diag: { code: string; id?: string; fixSuggestion?: unknown }): { code: string; nodeIds?: string[]; edgeIds?: string[]; suggestedCommands: string[] } | undefined {
  const id = diag.id;
  const meta = diag.fixSuggestion && typeof diag.fixSuggestion === "object" && !Array.isArray(diag.fixSuggestion) ? diag.fixSuggestion as Record<string, unknown> : {};
  if (diag.code === "template_no_active_template") return { code: "AWG_HEALTH_CREATE_OPERATING_TEMPLATE", suggestedCommands: ["awg add node --type process --title \"Operating template\" --summary \"Vault-local agent operating rules.\" --status active --tag operating-template --fields-json '{\"scope\":\"vault\",\"purpose\":\"...\",\"taxonomy\":{},\"freshness_rules\":\"...\",\"agent_rules\":\"...\",\"review_state\":\"reviewed\"}'"] };
  if (!id) return undefined;
  if (diag.code === "completed_task_without_evidence") return { code: "AWG_HEALTH_COMPLETED_WITHOUT_EVIDENCE", nodeIds: [id], suggestedCommands: [`awg add evidence --target ${id} --summary "..." --source terminal`] };
  if (diag.code === "orphan_node") return { code: "AWG_HEALTH_ORPHAN_NODE", nodeIds: [id], suggestedCommands: [`awg add edge --from ${id} --rel relates_to --to <related-node-id>`] };
  if (diag.code === "stale_node") return { code: "AWG_HEALTH_STALE_NODE", nodeIds: [id], suggestedCommands: [`awg update node ${id} --status needs_review`] };
  if (diag.code === "current_node_missing_verification") return { code: "AWG_HEALTH_VERIFY_CURRENT_NODE", nodeIds: [id], suggestedCommands: [`awg update node ${id} --freshness-json '{"last_verified":"YYYY-MM-DD","verified_by":"agent:codex"}'`] };
  if (diag.code === "freshness_status_conflict") return { code: "AWG_HEALTH_REVIEW_FRESHNESS_STATUS", nodeIds: [id], suggestedCommands: [`awg update node ${id} --status needs_review`] };
  if (diag.code === "unsupported_block_type" || diag.code.startsWith("invalid_block") || diag.code === "oversized_block_data") return { code: "AWG_HEALTH_REVIEW_NODE_BLOCKS", nodeIds: [id], suggestedCommands: [`awg update node ${id} --status needs_review`] };
  if (diag.code === "missing_required_field" || diag.code === "missing_recommended_field") {
    const field = typeof meta.field === "string" && meta.field ? meta.field : "<field>";
    return { code: "AWG_HEALTH_ADD_TEMPLATE_FIELD", nodeIds: [id], suggestedCommands: [`awg update node ${id} --field ${field}=...`] };
  }
  if (diag.code === "template_missing_required_section") {
    const section = typeof meta.section === "string" && meta.section ? meta.section : "<section>";
    return { code: "AWG_HEALTH_COMPLETE_OPERATING_TEMPLATE", nodeIds: [id], suggestedCommands: [`awg update node ${id} --field ${section}=...`] };
  }
  if (diag.code === "template_needs_review") return { code: "AWG_HEALTH_REVIEW_OPERATING_TEMPLATE", nodeIds: [id], suggestedCommands: [`awg update node ${id} --field review_state=reviewed --field human_approved=true`] };
  if (diag.code === "template_conflict") return { code: "AWG_HEALTH_RESOLVE_TEMPLATE_CONFLICT", nodeIds: [id], suggestedCommands: ["Review active operating templates and mark only one matching root active for the same scope/selector."] };
  if (diag.code === "sensitive_value_detected") return { code: "AWG_HEALTH_REDACT_SENSITIVE_VALUE", nodeIds: [id], suggestedCommands: [`awg update node ${id} --status needs_review`] };
  if (diag.code === "active_risk_with_completed_mitigation") return { code: "AWG_HEALTH_REVIEW_ACTIVE_RISK", nodeIds: [id], suggestedCommands: [`awg update node ${id} --status needs_review`] };
  if (diag.code === "active_blocker_linked_to_resolved_work") return { code: "AWG_HEALTH_REVIEW_ACTIVE_BLOCKER", nodeIds: [id], suggestedCommands: [`awg update node ${id} --status resolved`] };
  if (diag.code === "decision_implemented_while_proposed") return { code: "AWG_HEALTH_REVIEW_PROPOSED_DECISION", nodeIds: [id], suggestedCommands: [`awg update node ${id} --status needs_review`] };
  if (diag.code === "dangling_edge") return { code: "AWG_HEALTH_DANGLING_EDGE", edgeIds: [id], suggestedCommands: ["Create the missing endpoint node, or add a corrective/superseding edge."] };
  if (diag.code === "topology_missing_related_vault" || diag.code === "topology_related_vault_missing_or_invalid") return { code: "AWG_TOPOLOGY_REPAIR_RELATED_VAULT", edgeIds: [id], suggestedCommands: ["Run `awg vault topology --json`, then register the target project from its folder with `awg register --name <name>`."] };
  if (diag.code === "topology_related_vault_not_built") return { code: "AWG_TOPOLOGY_BUILD_RELATED_VAULT", edgeIds: [id], suggestedCommands: ["Run `awg build` inside the related vault, then rerun `awg vault topology --json`."] };
  if (diag.code === "topology_related_vault_compiled_artifact_unsafe" || diag.code === "topology_related_vault_compiled_artifact_invalid") return { code: "AWG_TOPOLOGY_REBUILD_RELATED_VAULT", edgeIds: [id], suggestedCommands: ["Inspect the related vault .awg/compiled artifacts, remove unsafe symlinks if present, then run `awg build` inside that vault."] };
  if (diag.code === "invalid_cross_vault_refs") return { code: "AWG_TOPOLOGY_REVIEW_CROSS_VAULT_REFS", nodeIds: [id], suggestedCommands: [`awg update node ${id} --status needs_review`] };
  if (diag.code.startsWith("AWG_COORDINATION_")) {
    const inspect = "awg coord status --json";
    if (diag.code === "AWG_COORDINATION_ACTIVE_COLLISION") return { code: "AWG_COORDINATION_REVIEW_COLLISION", suggestedCommands: [inspect] };
    if (diag.code === "AWG_COORDINATION_STALE_CLAIM") return { code: "AWG_COORDINATION_RELEASE_STALE_CLAIM", suggestedCommands: [`awg coord release ${id} --status abandoned --summary "..."`, inspect] };
    if (diag.code === "AWG_COORDINATION_FINISHED_RUN_UNRELEASED_CLAIM") return { code: "AWG_COORDINATION_RELEASE_FINISHED_RUN_CLAIM", suggestedCommands: [`awg coord release ${id} --status released --summary "..."`, inspect] };
    if (diag.code === "AWG_COORDINATION_MISSING_TARGET" || diag.code === "AWG_COORDINATION_HANDOFF_MISSING_TARGET" || diag.code === "AWG_COORDINATION_INVALID_EVENT") return { code: "AWG_COORDINATION_INSPECT", suggestedCommands: [inspect] };
  }
  return undefined;
}
