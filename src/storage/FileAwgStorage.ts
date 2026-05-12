import { existsSync, lstatSync, readFileSync, realpathSync, statSync, promises as fs } from "node:fs";
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
    for (const file of files) {
      await assertNoSymlinkInPath(this.awgPath(), file);
      out[path.basename(file)] = JSON.parse(await fs.readFile(file, "utf8"));
    }
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
      await assertNoSymlinkInPath(this.awgPath(), file);
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
    await assertNoSymlinkInPath(this.awgPath(), file);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await assertNoSymlinkInPath(this.awgPath(), file);
    await fs.appendFile(file, `${stableLine(entry)}\n`, "utf8");
  }

  async writeCompiledArtifact(relativePath: string, data: string | object): Promise<void> {
    const compiledRoot = this.awgPath("compiled");
    const file = path.resolve(compiledRoot, relativePath);
    if (!isInside(compiledRoot, file)) throw new Error(`Refusing to write compiled artifact outside .awg/compiled: ${relativePath}`);
    await assertNoSymlinkInPath(this.awgPath(), file);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await assertNoSymlinkInPath(this.awgPath(), file);
    await fs.writeFile(file, typeof data === "string" ? data : stableStringify(data), "utf8");
  }

  async readCompiledArtifact(relativePath: string): Promise<string | null> {
    const compiledRoot = this.awgPath("compiled");
    const file = path.resolve(compiledRoot, relativePath);
    if (!isInside(compiledRoot, file)) throw new Error(`Refusing to read compiled artifact outside .awg/compiled: ${relativePath}`);
    try {
      await assertNoSymlinkInPath(this.awgPath(), file);
      return await fs.readFile(file, "utf8");
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
  if (isSymlink(vault)) return false;
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

function isSymlink(file: string): boolean {
  try {
    return existsSync(file) && lstatSync(file).isSymbolicLink();
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

function isInside(root: string, file: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertNoSymlinkInPath(root: string, target: string): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const parts = [resolvedRoot, ...path.relative(resolvedRoot, resolvedTarget).split(path.sep).filter(Boolean).map((_, index, all) => path.join(resolvedRoot, ...all.slice(0, index + 1)))];
  for (const current of parts) {
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error(`Refusing to access symlink: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
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
