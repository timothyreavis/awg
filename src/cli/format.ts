import { stableStringify } from "../util/json.js";

export function printJson(value: unknown): void {
  console.log(stableStringify(value).trimEnd());
}

