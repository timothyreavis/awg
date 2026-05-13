import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { buildAwg } from "../../core/compiler.js";
import { charBudget } from "../../core/budget.js";
import { buildTaskLens } from "../../core/retrieval.js";
import { num, str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function lensCommand(parsed: ParsedArgs): Promise<void> {
  const [, name] = parsed.positionals;
  if (name === "task") return taskLens(parsed);
  if (name !== "resume") throw new Error("Usage: awg lens resume [--budget <n>] [--json] | awg lens task --goal <goal> [--budget <n>] [--json]");
  const text = await new FileAwgStorage().readCompiledArtifact("lenses/resume.json");
  if (!text) throw new Error("Missing compiled resume lens. Run awg build first.");
  const budget = charBudget(num(parsed.flags, "budget", 0) || undefined);
  if (parsed.flags.json) {
    const lens = JSON.parse(text);
    if (budget) lens.budget = budget;
    printJson(budget ? budgetResume(lens, budget) : lens);
  }
  else {
    const lens = budget ? budgetResume(JSON.parse(text), budget) : JSON.parse(text);
    console.log(lens.summary);
    for (const key of ["important", "open_decisions", "active_tasks", "active_risks", "unanswered_questions"]) {
      if (lens[key]?.length) {
        console.log(`\n${key}:`);
        for (const node of lens[key]) console.log(`- ${node.id} ${node.title} (${node.status})`);
      }
    }
    if (lens.recommended_maintenance?.length) {
      console.log("\nrecommended_maintenance:");
      for (const item of lens.recommended_maintenance) console.log(`- ${item}`);
    }
  }
}

async function taskLens(parsed: ParsedArgs): Promise<void> {
  const goal = str(parsed.flags, "goal");
  if (!goal) throw new Error("Usage: awg lens task --goal <goal> [--budget <n>] [--json]");
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false });
  const output = buildTaskLens(graph, goal, charBudget(num(parsed.flags, "budget", 0) || undefined));
  if (parsed.flags.json) return printJson(output);
  console.log(`task lens: ${goal}`);
  for (const section of output.sections) {
    if (!section.items.length && !section.omitted) continue;
    console.log(`\n${section.section}${section.omitted ? ` (${section.omitted} omitted)` : ""}:`);
    for (const item of section.items) printItem(item);
  }
}

function budgetResume(lens: Record<string, any>, budget: number): Record<string, any> {
  let used = String(lens.summary ?? "").length;
  for (const key of ["important", "open_decisions", "active_tasks", "active_risks", "unanswered_questions", "recent_responses"]) {
    const items = Array.isArray(lens[key]) ? lens[key] : [];
    const kept = [];
    for (const item of items) {
      const cost = JSON.stringify(item).length;
      if (used + cost > budget) break;
      kept.push(item);
      used += cost;
    }
    lens[key] = kept;
    lens[`${key}_omitted`] = items.length - kept.length;
  }
  return lens;
}

function printItem(item: unknown): void {
  const record = item as Record<string, unknown>;
  const id = record.id ? `${record.id} ` : "";
  const title = record.title ?? record.summary ?? record.message ?? record.code ?? JSON.stringify(record);
  const status = record.status ? ` (${record.status})` : "";
  console.log(`- ${id}${title}${status}`);
}
