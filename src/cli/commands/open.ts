import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { currentVaultPath, ensureGlobalDirectory, globalAwgDir, readRegistry, vaultHealth, writeGlobalFile } from "../../global/registry.js";
import type { ParsedArgs } from "../args.js";

export async function openCommand(parsed: ParsedArgs): Promise<void> {
  const current = await currentVaultPath();
  const noLaunch = Boolean(parsed.flags["no-launch"]);
  if (!parsed.flags.global && current) return openFile(path.join(current, "compiled", "site", "index.html"), { noLaunch });
  const file = await renderGlobalSwitcher();
  return openFile(file, { noLaunch });
}

async function openFile(file: string, options: { noLaunch: boolean }): Promise<void> {
  if (!existsSync(file)) throw new Error("Missing compiled static view. Run awg build first.");
  if (options.noLaunch || process.env.CI || process.env.AWG_NO_OPEN) {
    console.log(file);
    return;
  }
  if (process.platform === "darwin") {
    spawn("open", [file], { detached: true, stdio: "ignore" }).unref();
    console.log(file);
    return;
  }
  console.log(file);
}

async function renderGlobalSwitcher(): Promise<string> {
  const registry = await readRegistry();
  const dir = path.join(globalAwgDir(), "compiled", "switcher");
  await ensureGlobalDirectory(dir);
  const items = [];
  for (const vault of registry.vaults) {
    const health = await vaultHealth(vault.path);
    const site = path.join(vault.path, "compiled", "site", "index.html");
    const hasViewer = existsSync(site);
    items.push(`<li><h2>${escapeHtml(vault.name)}</h2><p><code>${escapeHtml(vault.path)}</code></p><p>${escapeHtml(vault.scope)} · ${health.exists ? "vault found" : "vault missing"} · ${health.built ? `built, ${health.warnings ?? 0} warnings, ${health.fatalErrors ?? 0} fatal` : "no build found"}</p>${hasViewer ? `<p><a href="${toFileHref(site)}">Open viewer</a></p>` : "<p>Run <code>awg build</code> in this project to generate its viewer.</p>"}</li>`);
  }
  const body = items.length ? `<ul>${items.join("\n")}</ul>` : "<p>No registered AWG vaults. Run <code>awg register</code> inside a project.</p>";
  const file = path.join(dir, "index.html");
  await writeGlobalFile(file, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AWG Vaults</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:32px;line-height:1.45;max-width:960px}ul{list-style:none;padding:0}li{border-bottom:1px solid #ddd;padding:18px 0}h1{margin-bottom:8px}h2{margin:0 0 8px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}a{color:#135e96}</style></head><body><h1>AWG Vaults</h1><p>Global registry only. Project .awg vaults remain canonical.</p>${body}</body></html>
`);
  return file;
}

function toFileHref(file: string): string {
  return `file://${file.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}
