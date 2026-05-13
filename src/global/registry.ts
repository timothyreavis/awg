import { promises as fs } from "node:fs";
import type { Stats } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { AWG_VERSION } from "../core/constants.js";
import { stableStringify } from "../util/json.js";
import { nowIso } from "../util/time.js";

export interface VaultEntry {
  id: string;
  name: string;
  path: string;
  scope: "project" | "org" | "user";
  registeredAt: string;
  lastSeenAt: string;
  tags: string[];
  favorite: boolean;
  [key: string]: unknown;
}

export interface Registry {
  version: "0.1";
  vaults: VaultEntry[];
  [key: string]: unknown;
}

export type VaultRegistryStatus = "ok" | "missing" | "invalid";

export interface VaultRegistryState {
  status: VaultRegistryStatus;
  reason: string;
}

export const GLOBAL_VERSION = "0.1";

export function globalAwgDir(): string {
  return path.join(os.homedir(), ".awg");
}

export function registryFile(): string {
  return path.join(globalAwgDir(), "registry.json");
}

export function globalConfigFile(): string {
  return path.join(globalAwgDir(), "config.json");
}

export async function ensureGlobalAwg(): Promise<void> {
  const dir = globalAwgDir();
  await ensureGlobalDirectory(path.join(dir, "compiled"));
  await writeJsonIfMissing(globalConfigFile(), {
    version: GLOBAL_VERSION,
    registry: "registry.json",
    networking: false,
    daemon: false
  });
  await writeJsonIfMissing(registryFile(), { version: GLOBAL_VERSION, vaults: [] });
}

export async function globalAwgExists(): Promise<boolean> {
  return exists(globalAwgDir());
}

export async function readRegistry(): Promise<Registry> {
  const file = registryFile();
  const stat = await assertSafeGlobalPath(file, "file");
  if (!stat) return { version: GLOBAL_VERSION, vaults: [] };
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<Registry>;
  return { ...parsed, version: GLOBAL_VERSION, vaults: Array.isArray(parsed.vaults) ? parsed.vaults : [] };
}

export async function writeRegistry(registry: Registry): Promise<void> {
  await writeGlobalFile(registryFile(), stableStringify(registry));
}

export async function ensureGlobalDirectory(dir: string): Promise<void> {
  await assertSafeGlobalPath(dir, "directory");
  await fs.mkdir(dir, { recursive: true });
}

export async function writeGlobalFile(file: string, body: string): Promise<void> {
  await assertSafeGlobalPath(file, "file");
  await ensureGlobalDirectory(path.dirname(file));
  await fs.writeFile(file, body);
}

export async function findProjectRoot(start = process.cwd()): Promise<string | null> {
  let current = path.resolve(start);
  while (true) {
    if (await isPlausibleAwgDir(path.join(current, ".awg"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function currentVaultPath(start = process.cwd()): Promise<string | null> {
  const root = await findProjectRoot(start);
  return root ? canonicalVaultPath(path.join(root, ".awg")) : null;
}

export async function registerVault(options: { vaultPath?: string; name?: string; scope?: string } = {}): Promise<{ entry: VaultEntry; created: boolean }> {
  const candidate = await vaultPathCandidate(options.vaultPath ?? path.join(process.cwd(), ".awg"));
  if (!(await isPlausibleAwgDir(candidate))) throw new Error(`No AWG vault found at ${candidate}. Run awg init first.`);
  const vaultPath = await canonicalVaultPath(candidate);
  await ensureGlobalAwg();
  const registry = await readRegistry();
  const now = nowIso();
  const index = await findVaultIndex(registry, vaultPath);
  const scope = parseScope(options.scope);
  if (index >= 0) {
    const prior = registry.vaults[index];
    const entry = {
      ...prior,
      name: options.name ?? prior.name,
      path: vaultPath,
      scope: scope ?? prior.scope ?? "project",
      lastSeenAt: now
    };
    registry.vaults[index] = entry;
    await writeRegistry(registry);
    return { entry, created: false };
  }
  const entry: VaultEntry = {
    id: stableVaultId(vaultPath),
    name: options.name ?? path.basename(path.dirname(vaultPath)),
    path: vaultPath,
    scope: scope ?? "project",
    registeredAt: now,
    lastSeenAt: now,
    tags: [],
    favorite: false
  };
  registry.vaults.push(entry);
  registry.vaults.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  await writeRegistry(registry);
  return { entry, created: true };
}

export async function unregisterVault(options: { vaultPath?: string } = {}): Promise<VaultEntry | null> {
  const vaultPath = await canonicalVaultPath(await vaultPathCandidate(options.vaultPath ?? path.join(process.cwd(), ".awg")));
  const registry = await readRegistry();
  const index = await findVaultIndex(registry, vaultPath);
  const removed = index >= 0 ? registry.vaults[index] : null;
  const kept = index >= 0 ? registry.vaults.filter((_, itemIndex) => itemIndex !== index) : registry.vaults;
  if (removed) await writeRegistry({ ...registry, vaults: kept });
  return removed;
}

export async function vaultHealth(vaultPath: string): Promise<{ exists: boolean; built: boolean; fatalErrors?: number; warnings?: number }> {
  const exists = await isPlausibleAwgDir(vaultPath);
  const diagnosticsFile = path.join(vaultPath, "compiled", "reports", "diagnostics.json");
  if (!exists || !(await fileExists(diagnosticsFile))) return { exists, built: false };
  try {
    const report = JSON.parse(await fs.readFile(diagnosticsFile, "utf8")) as { summary?: { fatal_error_count?: number; warning_count?: number } };
    return { exists, built: true, fatalErrors: report.summary?.fatal_error_count ?? 0, warnings: report.summary?.warning_count ?? 0 };
  } catch {
    return { exists, built: false };
  }
}

export async function vaultRegistryState(vaultPath: string): Promise<VaultRegistryState> {
  if (!(await pathExists(vaultPath))) return { status: "missing", reason: "path does not exist" };
  if (!(await directoryExists(vaultPath))) return { status: "invalid", reason: "path is not a directory" };
  if (!(await isPlausibleAwgDir(vaultPath))) return { status: "invalid", reason: "path exists but is not a plausible current AWG vault" };
  return { status: "ok", reason: "plausible AWG vault" };
}

export async function missingVaultEntries(): Promise<Array<VaultEntry & { health: Awaited<ReturnType<typeof vaultHealth>>; state: VaultRegistryState }>> {
  const registry = await readRegistry();
  const rows = [];
  for (const vault of registry.vaults) {
    const health = await vaultHealth(vault.path);
    const state = await vaultRegistryState(vault.path);
    if (state.status !== "ok") rows.push({ ...vault, health, state });
  }
  return rows;
}

export async function pruneMissingVaults(options: { dryRun?: boolean; yes?: boolean } = {}): Promise<{ missing: VaultEntry[]; pruned: VaultEntry[]; skipped: Array<VaultEntry & { state: VaultRegistryState }> }> {
  const registry = await readRegistry();
  const missing: VaultEntry[] = [];
  const kept: VaultEntry[] = [];
  const skipped: Array<VaultEntry & { state: VaultRegistryState }> = [];
  for (const vault of registry.vaults) {
    const state = await vaultRegistryState(vault.path);
    if (state.status === "ok") kept.push(vault);
    else if (state.status === "missing") missing.push(vault);
    else {
      kept.push(vault);
      skipped.push({ ...vault, state });
    }
  }
  if (options.dryRun || !options.yes) return { missing, pruned: [], skipped: [...missing.map((vault) => ({ ...vault, state: { status: "missing" as const, reason: "path does not exist" } })), ...skipped] };
  await writeRegistry({ ...registry, vaults: kept });
  return { missing, pruned: missing, skipped };
}

export async function isPlausibleAwgDir(vaultPath: string): Promise<boolean> {
  if (await samePath(vaultPath, globalAwgDir())) return false;
  if (!(await fileExists(path.join(vaultPath, "config.json"))) || !(await directoryExists(path.join(vaultPath, "log")))) return false;
  try {
    const config = JSON.parse(await fs.readFile(path.join(vaultPath, "config.json"), "utf8")) as { awg?: unknown; storage?: { canonical?: unknown } };
    return config.awg === AWG_VERSION && typeof config.storage?.canonical === "string";
  } catch {
    return false;
  }
}

export function normalizeVaultPath(vaultPath: string): string {
  return path.resolve(vaultPath);
}

export async function canonicalVaultPath(vaultPath: string): Promise<string> {
  const resolved = normalizeVaultPath(vaultPath);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function vaultPathCandidate(input: string): Promise<string> {
  const resolved = normalizeVaultPath(input);
  if (path.basename(resolved) === ".awg") return resolved;
  const nested = path.join(resolved, ".awg");
  return await isPlausibleAwgDir(nested) ? nested : resolved;
}

async function findVaultIndex(registry: Registry, vaultPath: string): Promise<number> {
  for (let index = 0; index < registry.vaults.length; index += 1) {
    if (await canonicalVaultPath(registry.vaults[index].path) === vaultPath) return index;
  }
  return -1;
}

function stableVaultId(vaultPath: string): string {
  return `vault:${createHash("sha256").update(vaultPath).digest("hex").slice(0, 16)}`;
}

function parseScope(value: string | undefined): VaultEntry["scope"] | undefined {
  if (!value) return undefined;
  if (value === "project" || value === "org" || value === "user") return value;
  throw new Error("Scope must be one of: project, org, user.");
}

async function writeJsonIfMissing(file: string, value: object): Promise<void> {
  const stat = await assertSafeGlobalPath(file, "file");
  if (stat) return;
  await writeGlobalFile(file, stableStringify(value));
}

async function assertSafeGlobalPath(target: string, kind: "file" | "directory"): Promise<Stats | null> {
  const rootAbs = path.resolve(os.homedir());
  const targetAbs = path.resolve(target);
  const relative = path.relative(rootAbs, targetAbs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing to access path outside ~/.awg control plane: ${target}`);
  let current = rootAbs;
  let stat: Stats | null = null;
  const parts = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const isFinal = index === parts.length - 1;
    current = path.join(current, part);
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`Refusing to access symlink: ${current}`);
    if (!isFinal && !stat.isDirectory()) throw new Error(`Refusing to access path through non-directory: ${current}`);
    if (isFinal && kind === "file" && !stat.isFile()) throw new Error(`Refusing to access non-file path: ${target}`);
    if (isFinal && kind === "directory" && !stat.isDirectory()) throw new Error(`Refusing to access non-directory path: ${target}`);
  }
  return stat;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function exists(file: string): Promise<boolean> {
  return pathExists(file);
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function samePath(a: string, b: string): Promise<boolean> {
  return await canonicalVaultPath(a) === await canonicalVaultPath(b);
}
