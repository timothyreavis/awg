export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    const value = !next || next.startsWith("--") ? true : (i += 1, next);
    if (key in flags) flags[key] = Array.isArray(flags[key]) ? [...flags[key] as string[], String(value)] : [String(flags[key]), String(value)];
    else flags[key] = value;
  }
  return { positionals, flags };
}

export function str(flags: ParsedArgs["flags"], key: string, fallback?: string): string | undefined {
  const value = flags[key];
  if (Array.isArray(value)) return value[value.length - 1];
  if (typeof value === "string") return value;
  return fallback;
}

export function num(flags: ParsedArgs["flags"], key: string, fallback: number): number {
  const value = Number(str(flags, key, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

export function arr(flags: ParsedArgs["flags"], key: string): string[] {
  const value = flags[key];
  if (!value) return [];
  return Array.isArray(value) ? value : [String(value)];
}
