import { promises as fs } from "node:fs";
import type { Stats } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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

export type VaultRelationshipRel = "parent_of" | "depends_on" | "provides_contract_for" | "deploys_to" | "owns" | "sibling_of" | "related_to";
export type VaultRelationshipVisibility = "summary" | "private" | "full";

export interface VaultRelationship {
  id: string;
  fromVaultId: string;
  rel: VaultRelationshipRel;
  toVaultId: string;
  summary?: string;
  confidence?: number;
  visibility: VaultRelationshipVisibility;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
  [key: string]: unknown;
}

export interface Registry {
  version: "0.1";
  vaults: VaultEntry[];
  relationships: VaultRelationship[];
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
  await writeJsonIfMissing(registryFile(), { version: GLOBAL_VERSION, vaults: [], relationships: [] });
}

export async function globalAwgExists(): Promise<boolean> {
  return exists(globalAwgDir());
}

export async function readRegistry(): Promise<Registry> {
  const file = registryFile();
  const stat = await assertSafeGlobalPath(file, "file");
  if (!stat) return { version: GLOBAL_VERSION, vaults: [], relationships: [] };
  const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<Registry>;
  return { ...parsed, version: GLOBAL_VERSION, vaults: Array.isArray(parsed.vaults) ? parsed.vaults : [], relationships: Array.isArray(parsed.relationships) ? parsed.relationships as VaultRelationship[] : [] };
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
  const configIdentity = await readVaultIdentity(vaultPath);
  const pathIndex = await findVaultIndex(registry, vaultPath);
  const identityIndex = configIdentity?.id ? registry.vaults.findIndex((vault) => vault.id === configIdentity.id) : -1;
  let index = identityIndex >= 0 ? identityIndex : pathIndex;
  const scope = parseScope(options.scope);
  if (identityIndex >= 0 && pathIndex < 0) {
    const prior = registry.vaults[identityIndex];
    const priorState = await vaultRegistryState(prior.path);
    if (priorState.status === "ok") index = -1;
  }
  if (index >= 0) {
    const prior = registry.vaults[index];
    await ensureVaultIdentity(vaultPath, prior.id, prior.registeredAt ?? now);
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
  const vaultId = index < 0 && configIdentity?.id && registry.vaults.some((vault) => vault.id === configIdentity.id) ? `vault:${randomUUID().replace(/-/g, "").slice(0, 16)}` : configIdentity?.id ?? `vault:${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await ensureVaultIdentity(vaultPath, vaultId, now);
  const entry: VaultEntry = {
    id: vaultId,
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
  const state = await vaultRegistryState(vaultPath);
  const exists = state.status === "ok";
  const diagnosticsFile = path.join(vaultPath, "compiled", "reports", "diagnostics.json");
  if (!exists) return { exists, built: false };
  try {
    const stat = await assertSafeVaultPath(vaultPath, diagnosticsFile, "file");
    if (!stat) return { exists, built: false };
    const report = JSON.parse(await fs.readFile(diagnosticsFile, "utf8")) as { summary?: { fatal_error_count?: number; warning_count?: number } };
    return { exists, built: true, fatalErrors: report.summary?.fatal_error_count ?? 0, warnings: report.summary?.warning_count ?? 0 };
  } catch {
    return { exists, built: false };
  }
}

export async function vaultRegistryState(vaultPath: string): Promise<VaultRegistryState> {
  if (!(await pathExists(vaultPath))) return { status: "missing", reason: "path does not exist" };
  try {
    await assertSafeVaultPath(path.dirname(vaultPath), vaultPath, "directory");
    if (!(await isPlausibleAwgDir(vaultPath))) return { status: "invalid", reason: "path exists but is not a plausible current AWG vault" };
    return { status: "ok", reason: "plausible AWG vault" };
  } catch (error) {
    return { status: "invalid", reason: error instanceof Error ? error.message : String(error) };
  }
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

export function normalizeRelationship(inputRel: string, fromVaultId: string, toVaultId: string): { rel: VaultRelationshipRel; fromVaultId: string; toVaultId: string } {
  let rel = inputRel as VaultRelationshipRel;
  let from = fromVaultId;
  let to = toVaultId;
  if (inputRel === "child_of") rel = "parent_of", [from, to] = [to, from];
  else if (inputRel === "consumes_contract_from" || inputRel === "consumes_data_from") rel = "provides_contract_for", [from, to] = [to, from];
  else if (inputRel === "owned_by") rel = "owns", [from, to] = [to, from];
  else if (inputRel === "provides_schema_for") rel = "provides_contract_for";
  const allowed = new Set(["parent_of", "depends_on", "provides_contract_for", "deploys_to", "owns", "sibling_of", "related_to"]);
  if (!allowed.has(rel)) throw new Error(`Unknown relationship: ${inputRel}`);
  if (rel === "sibling_of" || rel === "related_to") {
    if (from.localeCompare(to) > 0) [from, to] = [to, from];
  }
  if (from === to) throw new Error("Vault relationships cannot link a vault to itself.");
  return { rel, fromVaultId: from, toVaultId: to };
}

export function relationshipId(fromVaultId: string, rel: string, toVaultId: string): string {
  return `rel:${createHash("sha256").update(`${fromVaultId}\0${rel}\0${toVaultId}`).digest("hex").slice(0, 16)}`;
}

export async function linkVaults(options: { fromVaultId: string; rel: string; toVaultId: string; summary?: string; confidence?: number; visibility?: string }): Promise<{ registry: Registry; relationship: VaultRelationship; created: boolean }> {
  const registry = await readRegistry();
  const normalized = normalizeRelationship(options.rel, options.fromVaultId, options.toVaultId);
  const id = relationshipId(normalized.fromVaultId, normalized.rel, normalized.toVaultId);
  const now = nowIso();
  const index = registry.relationships.findIndex((relationship) => relationship.id === id);
  const visibility = options.visibility === undefined ? undefined : parseVisibility(options.visibility);
  const confidence = options.confidence === undefined ? undefined : Math.max(0, Math.min(1, options.confidence));
  let relationship: VaultRelationship;
  let created = false;
  if (index >= 0) {
    relationship = { ...registry.relationships[index], ...normalized, id, visibility: visibility ?? registry.relationships[index].visibility ?? "summary", updatedAt: now, archivedAt: null };
    if (options.summary !== undefined) relationship.summary = options.summary;
    if (confidence !== undefined) relationship.confidence = confidence;
    registry.relationships[index] = relationship;
  } else {
    created = true;
    relationship = { id, ...normalized, ...(options.summary ? { summary: options.summary } : {}), ...(confidence !== undefined ? { confidence } : {}), visibility: visibility ?? "summary", createdAt: now, updatedAt: now, archivedAt: null };
    registry.relationships.push(relationship);
  }
  registry.relationships.sort(compareRelationships);
  await writeRegistry(registry);
  return { registry, relationship, created };
}

export async function unlinkVaultRelationship(id: string): Promise<{ relationship: VaultRelationship | null }> {
  const registry = await readRegistry();
  const index = registry.relationships.findIndex((relationship) => relationship.id === id);
  if (index < 0) return { relationship: null };
  const relationship = { ...registry.relationships[index], archivedAt: nowIso(), updatedAt: nowIso() };
  registry.relationships[index] = relationship;
  registry.relationships.sort(compareRelationships);
  await writeRegistry(registry);
  return { relationship };
}

export async function isPlausibleAwgDir(vaultPath: string): Promise<boolean> {
  if (await samePath(vaultPath, globalAwgDir())) return false;
  const safeVault = await assertSafeVaultPath(path.dirname(vaultPath), vaultPath, "directory");
  const safeConfig = await assertSafeVaultPath(vaultPath, path.join(vaultPath, "config.json"), "file");
  const safeLog = await assertSafeVaultPath(vaultPath, path.join(vaultPath, "log"), "directory");
  if (!safeVault || !safeConfig || !safeLog) return false;
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

function parseScope(value: string | undefined): VaultEntry["scope"] | undefined {
  if (!value) return undefined;
  if (value === "project" || value === "org" || value === "user") return value;
  throw new Error("Scope must be one of: project, org, user.");
}

function parseVisibility(value: string | undefined): VaultRelationshipVisibility {
  if (!value) return "summary";
  if (value === "summary" || value === "private" || value === "full") return value;
  throw new Error("Visibility must be one of: summary, private, full.");
}

function compareRelationships(a: VaultRelationship, b: VaultRelationship): number {
  return Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) || a.fromVaultId.localeCompare(b.fromVaultId) || a.rel.localeCompare(b.rel) || a.toVaultId.localeCompare(b.toVaultId) || a.id.localeCompare(b.id);
}

async function readVaultIdentity(vaultPath: string): Promise<{ id?: string; createdAt?: string } | null> {
  try {
    const file = path.join(vaultPath, "config.json");
    const stat = await assertSafeVaultPath(vaultPath, file, "file");
    if (!stat) return null;
    const config = JSON.parse(await fs.readFile(file, "utf8")) as { vault?: { id?: unknown; createdAt?: unknown } };
    return { id: typeof config.vault?.id === "string" ? config.vault.id : undefined, createdAt: typeof config.vault?.createdAt === "string" ? config.vault.createdAt : undefined };
  } catch {
    return null;
  }
}

async function ensureVaultIdentity(vaultPath: string, id: string, createdAt: string): Promise<void> {
  const file = path.join(vaultPath, "config.json");
  await assertSafeVaultPath(vaultPath, file, "file");
  const config = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  const priorVault = config.vault && typeof config.vault === "object" && !Array.isArray(config.vault) ? config.vault as Record<string, unknown> : {};
  if (priorVault.id === id && priorVault.identityVersion === 1) return;
  const next = { ...config, vault: { ...priorVault, id, createdAt: typeof priorVault.createdAt === "string" ? priorVault.createdAt : createdAt, identityVersion: 1 } };
  await fs.writeFile(file, stableStringify(next), "utf8");
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

async function assertSafeVaultPath(root: string, target: string, kind: "file" | "directory"): Promise<Stats | null> {
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(target);
  const relative = path.relative(rootAbs, targetAbs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Refusing to access path outside AWG vault: ${target}`);
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
