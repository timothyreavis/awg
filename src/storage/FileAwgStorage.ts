import { existsSync, readFileSync, realpathSync, statSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AWG_VERSION } from "../core/constants.js";
import type { AwgObject, RawLogEntry } from "../core/types.js";
import { stableLine, stableStringify } from "../util/json.js";
import { todayPathParts } from "../util/time.js";
import type { AwgStorage } from "./AwgStorage.js";

export class FileAwgStorage implements AwgStorage {
  public readonly root: string;

  constructor(root?: string) {
    this.root = root ? path.resolve(root) : defaultRoot();
  }

  awgPath(...parts: string[]): string {
    return path.join(this.root, ".awg", ...parts);
  }

  async readConfig(): Promise<Record<string, unknown> | null> {
    try {
      return JSON.parse(await fs.readFile(this.awgPath("config.json"), "utf8")) as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async readSchemas(): Promise<Record<string, unknown>> {
    const files = (await walk(this.awgPath("schema", "core"))).filter((file) => file.endsWith(".schema.json")).sort();
    const out: Record<string, unknown> = {};
    for (const file of files) out[path.basename(file)] = JSON.parse(await fs.readFile(file, "utf8"));
    return out;
  }

  async readLogEntries(): Promise<RawLogEntry[]> {
    const logRoot = this.awgPath("log");
    const files = (await walk(logRoot)).filter((file) => {
      const relative = path.relative(logRoot, file);
      return /^\d{4}[\\/]\d{2}[\\/]\d{4}-\d{2}-\d{2}\.awg\.jsonl$/.test(relative);
    }).sort();
    const entries: RawLogEntry[] = [];
    for (const file of files) {
      const text = await fs.readFile(file, "utf8");
      text.split(/\r?\n/).forEach((raw, index) => {
        if (raw.trim()) entries.push({ file: path.relative(this.root, file), line: index + 1, raw });
      });
    }
    return entries;
  }

  async appendLogEntry(entry: AwgObject): Promise<void> {
    const { year, month, date } = todayPathParts();
    const file = this.awgPath("log", year, month, `${date}.awg.jsonl`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${stableLine(entry)}\n`, "utf8");
  }

  async writeCompiledArtifact(relativePath: string, data: string | object): Promise<void> {
    const file = this.awgPath("compiled", relativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, typeof data === "string" ? data : stableStringify(data), "utf8");
  }

  async readCompiledArtifact(relativePath: string): Promise<string | null> {
    try {
      return await fs.readFile(this.awgPath("compiled", relativePath), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}

function defaultRoot(): string {
  let current = path.resolve(process.cwd());
  while (true) {
    if (isPlausibleAwgRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) throw new Error("No AWG project vault found. Run awg init first.");
    current = parent;
  }
}

function isPlausibleAwgRoot(root: string): boolean {
  const vault = path.join(root, ".awg");
  if (samePath(vault, path.join(os.homedir(), ".awg"))) return false;
  if (!isFile(path.join(vault, "config.json")) || !isDirectory(path.join(vault, "log"))) return false;
  try {
    const config = JSON.parse(readFileSync(path.join(vault, "config.json"), "utf8")) as { awg?: unknown; storage?: { canonical?: unknown } };
    return config.awg === AWG_VERSION && typeof config.storage?.canonical === "string";
  } catch {
    return false;
  }
}

function isFile(file: string): boolean {
  try {
    return existsSync(file) && statSync(file).isFile();
  } catch {
    return false;
  }
}

function isDirectory(file: string): boolean {
  try {
    return existsSync(file) && statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function samePath(a: string, b: string): boolean {
  try {
    return path.resolve(a) === path.resolve(b) || fsRealPath(a) === fsRealPath(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

function fsRealPath(file: string): string {
  return existsSync(file) ? realpathSync(file) : path.resolve(file);
}

async function walk(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const found = await Promise.all(entries.map(async (entry) => {
      const full = path.join(root, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    }));
    return found.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
