import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export async function openCommand(): Promise<void> {
  const file = path.join(process.cwd(), ".awg", "compiled", "site", "index.html");
  if (!existsSync(file)) throw new Error("Missing compiled static view. Run awg build first.");
  if (process.platform === "darwin") {
    spawn("open", [file], { detached: true, stdio: "ignore" }).unref();
    console.log(file);
    return;
  }
  console.log(file);
}
