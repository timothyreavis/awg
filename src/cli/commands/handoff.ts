import { buildAwg } from "../../core/compiler.js";
import { charBudget } from "../../core/budget.js";
import { buildHandoff } from "../../core/retrieval.js";
import { activeRun, buildRuns, recentRuns, runEventId } from "../../core/runs.js";
import { AWG_VERSION } from "../../core/constants.js";
import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { num, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";
import { nowIso } from "../../util/time.js";
import type { AwgEvent } from "../../core/types.js";

export async function handoffCommand(parsed: ParsedArgs): Promise<void> {
  const storage = new FileAwgStorage();
  const { graph } = await buildAwg(storage, { write: false });
  const budget = charBudget(num(parsed.flags, "budget", 0) || undefined);
  let output = buildHandoff(graph, budget);
  if (!parsed.flags["no-record"]) {
    const runs = buildRuns(graph);
    const run = activeRun(runs) ?? recentRuns(runs, 1)[0];
    const at = nowIso();
    const target = run?.id ?? "project";
    const event: AwgEvent = { awg: AWG_VERSION, kind: "event", id: runEventId(target, "handoff", at), type: "handoff_generated", target, run: run?.id, runId: run?.id, by: "agent:codex", at, budget: output.budget, quality: output.quality };
    await storage.appendLogEntry(event);
    const rebuilt = await buildAwg(storage, { write: false });
    output = buildHandoff(rebuilt.graph, budget);
  }
  if (parsed.flags.json) return printJson(output);
  console.log("AWG handoff");
  for (const section of output.sections) {
    if (!section.items.length && !section.omitted) continue;
    console.log(`\n${section.section}${section.omitted ? ` (${section.omitted} omitted)` : ""}:`);
    for (const item of section.items) {
      const record = item as Record<string, unknown>;
      console.log(`- ${formatHandoffItem(record, item)}`);
    }
  }
}

function formatHandoffItem(record: Record<string, unknown>, item: unknown): string {
  if (!item || typeof item !== "object") return String(item);
  if (typeof record.goal === "string" && typeof record.id === "string") {
    return `${record.id} ${record.goal}${record.status ? ` (${record.status})` : ""}`;
  }
  if ("fatal_error_count" in record || "warning_count" in record) {
    return `${record.fatal_error_count ?? 0} fatal, ${record.warning_count ?? 0} warnings, ${record.node_count ?? 0} nodes, ${record.edge_count ?? 0} edges`;
  }
  if ("activeTemplateId" in record || "selectedTemplate" in record) {
    const selected = record.selectedTemplate as Record<string, unknown> | undefined;
    const title = typeof selected?.title === "string" ? selected.title : record.activeTemplateId;
    const bits = [
      title,
      typeof record.activeTemplateCount === "number" ? `${record.activeTemplateCount} active` : undefined,
      countLabel(record.conflicts, "conflict"),
      countLabel(record.warnings, "warning")
    ].filter(Boolean);
    return bits.join("; ");
  }
  if ("createdNodeIds" in record || "touchedNodeIds" in record || "evidenceNodeIds" in record || "handoffEventIds" in record) {
    return [
      countLabel(record.createdNodeIds, "created node"),
      countLabel(record.touchedNodeIds, "touched node"),
      countLabel(record.evidenceNodeIds, "evidence node"),
      countLabel(record.diagnosticCodes, "diagnostic"),
      countLabel(record.handoffEventIds, "handoff event")
    ].filter(Boolean).join(", ") || "No run-attributed changes.";
  }
  if ("score" in record && ("checks" in record || "warnings" in record)) {
    return [
      typeof record.score === "number" ? `score ${record.score}` : undefined,
      countLabel(record.checks, "check"),
      countLabel(record.warnings, "warning")
    ].filter(Boolean).join(", ") || "No quality checks.";
  }
  return `${record.id ? `${record.id} ` : ""}${record.title ?? record.summary ?? record.message ?? String(item)}${record.status ? ` (${record.status})` : ""}`;
}

function countLabel(value: unknown, label: string): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return `${value.length} ${label}${value.length === 1 ? "" : "s"}`;
}
