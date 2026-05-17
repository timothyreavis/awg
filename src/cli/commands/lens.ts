import { FileAwgStorage } from "../../storage/FileAwgStorage.js";
import { buildAwg } from "../../core/compiler.js";
import { charBudget } from "../../core/budget.js";
import { normalizeLensSections, runConfiguredLens } from "../../core/lensConfigs.js";
import { buildTaskLens } from "../../core/retrieval.js";
import { nowIso } from "../../util/time.js";
import { num, str, type ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function lensCommand(parsed: ParsedArgs): Promise<void> {
  const [, name] = parsed.positionals;
  if (name === "task") return taskLens(parsed);
  if (name === "list") return listLenses(parsed);
  if (name === "show") return showLens(parsed);
  if (name === "run") return runLens(parsed);
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
    if (lens.work_queue_items?.length) {
      console.log("\nwork_queues:");
      for (const item of lens.work_queue_items.slice(0, 8)) console.log(`- ${item.id} [${item.queue}] ${item.title} (${item.priority})`);
    }
  }
}

async function listLenses(parsed: ParsedArgs): Promise<void> {
  const goal = str(parsed.flags, "goal");
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false, coordinationAsOf: nowIso() });
  let lenses = graph.lens_index?.lenses ?? graph.lenses.map((lens) => ({ id: lens.id, title: lens.title, purpose: lens.purpose, summary: lens.summary, status: lens.status ?? "needs_review", scope: lens.scope ?? "vault", audience: lens.audience ?? "agent", tags: lens.tags ?? [], selector: lens.selector, sectionCount: Array.isArray(lens.sections) ? lens.sections.length : Array.isArray(lens.include) ? lens.include.length : 0, needsReview: lens.status === "needs_review", updated_at: lens.updated_at }));
  if (goal) lenses = lenses.filter((lens) => lensMatchesGoal(lens, goal));
  if (parsed.flags.json) return printJson({ ok: true, goal, lenses });
  for (const lens of lenses) console.log(`${lens.id} ${lens.title} (${lens.status})`);
}

async function showLens(parsed: ParsedArgs): Promise<void> {
  const lensId = parsed.positionals[2];
  if (!lensId) throw new Error("Usage: awg lens show <lens-id> [--json]");
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false, coordinationAsOf: nowIso() });
  const lens = graph.lenses.find((item) => item.id === lensId);
  if (!lens) throw new Error(`Lens not found: ${lensId}`);
  const diagnostics = graph.diagnostics.diagnostics.filter((diag) => diag.id === lensId);
  if (parsed.flags.json) return printJson({ ok: true, lens, diagnostics });
  console.log(`${lens.id} ${lens.title}`);
  if (lens.purpose) console.log(lens.purpose);
  for (const section of normalizeLensSections(lens)) console.log(`- ${section.id ?? section.source}: ${section.source}`);
}

async function runLens(parsed: ParsedArgs): Promise<void> {
  const lensId = parsed.positionals[2];
  if (!lensId) throw new Error("Usage: awg lens run <lens-id> [--goal <goal>] [--budget <n>] [--json]");
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false, coordinationAsOf: nowIso() });
  const lens = graph.lenses.find((item) => item.id === lensId);
  if (!lens) throw new Error(`Lens not found: ${lensId}`);
  const output = runConfiguredLens(graph, lens, str(parsed.flags, "goal"), effectiveBudget(parsed, lens.budget));
  if (parsed.flags.json) return printJson(output);
  console.log(`${output.title} (${output.id})`);
  for (const section of output.sections) {
    if (!section.items.length && !section.omitted) continue;
    console.log(`\n${section.section}${section.omitted ? ` (${section.omitted} omitted)` : ""}:`);
    for (const item of section.items) printItem(item);
  }
}

async function taskLens(parsed: ParsedArgs): Promise<void> {
  const goal = str(parsed.flags, "goal");
  if (!goal) throw new Error("Usage: awg lens task --goal <goal> [--budget <n>] [--json]");
  const { graph } = await buildAwg(new FileAwgStorage(), { write: false, coordinationAsOf: nowIso() });
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
  for (const key of ["important", "open_decisions", "active_tasks", "active_risks", "unanswered_questions", "recent_responses", "work_queue_items"]) {
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

function lensMatchesGoal(lens: { id: string; title: string; purpose?: string; summary?: string; tags?: string[]; selector?: Record<string, unknown> }, goal: string): boolean {
  const terms = goal.toLowerCase().split(/[^a-z0-9:_-]+/).filter(Boolean);
  const selectorTerms = Array.isArray(lens.selector?.goalTerms) ? lens.selector.goalTerms.filter((item): item is string => typeof item === "string") : [];
  const haystack = [lens.id, lens.title, lens.purpose, lens.summary, ...(lens.tags ?? []), ...selectorTerms, JSON.stringify(lens.selector ?? {})].filter(Boolean).join(" ").toLowerCase();
  return terms.length === 0 || terms.some((term) => haystack.includes(term));
}

function effectiveBudget(parsed: ParsedArgs, budget: Record<string, unknown> | undefined): number | undefined {
  const explicit = charBudget(num(parsed.flags, "budget", 0) || undefined);
  if (explicit) return explicit;
  const value = budget?.default ?? budget?.max;
  return typeof value === "number" ? charBudget(value) : typeof value === "string" ? charBudget(Number(value)) : undefined;
}
