import { currentReleaseNote, RELEASE_NOTES } from "../../core/releaseNotes.js";
import type { ParsedArgs } from "../args.js";
import { printJson } from "../format.js";

export async function releaseCommand(parsed: ParsedArgs): Promise<void> {
  const [, sub] = parsed.positionals;
  if (sub === "current") return printRelease(currentReleaseNote(), parsed);
  if (sub === "notes") {
    if (parsed.flags.json) return printJson({ ok: true, releases: RELEASE_NOTES });
    for (const note of RELEASE_NOTES) printReleaseText(note);
    return;
  }
  throw new Error("Usage: awg release notes [--json] | awg release current [--json]");
}

function printRelease(note: ReturnType<typeof currentReleaseNote>, parsed: ParsedArgs): void {
  if (parsed.flags.json) return printJson({ ok: true, release: note });
  printReleaseText(note);
}

function printReleaseText(note: ReturnType<typeof currentReleaseNote>): void {
  console.log(`AWG release ${note.version} (${note.date})`);
  printList("highlights", note.highlights);
  printList("newCommands", note.newCommands);
  printList("agentActions", note.agentActions);
  printList("adoption", note.adoption);
  printList("docs", note.docs);
  printList("nonGoals", note.nonGoals);
}

function printList(label: string, values: string[]): void {
  console.log(`\n${label}:`);
  for (const value of values) console.log(`- ${value}`);
}
