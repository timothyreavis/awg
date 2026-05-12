import { promises as fs } from "node:fs";
import path from "node:path";
import type { AwgObject, RawLogEntry } from "../core/types.js";
import { stableLine, stableStringify } from "../util/json.js";
import { todayPathParts } from "../util/time.js";
import type { AwgStorage } from "./AwgStorage.js";

export class FileAwgStorage implements AwgStorage {
  constructor(public readonly root: string = process.cwd()) {}

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
    const files = (await walk(logRoot)).filter((file) => /\/\.awg\/log\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}\.awg\.jsonl$/.test(file)).sort();
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
