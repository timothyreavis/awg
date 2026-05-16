import { addCommand } from "./add.js";
import type { ParsedArgs } from "../args.js";

export async function verifyCommand(parsed: ParsedArgs): Promise<void> {
  const target = parsed.positionals[1];
  if (!target) throw new Error("Usage: awg verify <node-id> --summary <summary> [--json]");
  const status = parsed.flags.status;
  const rel = parsed.flags.rel;
  if (rel !== undefined && rel !== "supports" && rel !== "contradicts") throw new Error("--rel for awg verify must be one of: supports, contradicts");
  const derivedRel = rel ?? (status === "failed" ? "contradicts" : "supports");
  await addCommand({
    positionals: ["add", "evidence"],
    flags: {
      ...parsed.flags,
      target,
      source: parsed.flags.source ?? "manual",
      status: parsed.flags.status ?? "passed",
      rel: derivedRel
    }
  });
}
