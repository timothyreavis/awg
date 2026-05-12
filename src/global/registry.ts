import { promises as fs } from "node:fs";
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
  await fs.mkdir(path.join(dir, "compiled"), { recursive: true });
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
  if (!(await exists(file))) return { version: GLOBAL_VERSION, vaults: [] };
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<Registry>;
  return { ...parsed, version: GLOBAL_VERSION, vaults: Array.isArray(parsed.vaults) ? parsed.vaults : [] };
}

export async function writeRegistry(registry: Registry): Promise<void> {
  await fs.mkdir(globalAwgDir(), { recursive: true });
  await fs.writeFile(registryFile(), stableStringify(registry));
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
  if (await exists(file)) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, stableStringify(value));
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
