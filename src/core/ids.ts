import { createHash, randomUUID } from "node:crypto";

export function slug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

export function nodeId(title: string): string {
  return `n:${slug(title)}-${randomUUID().slice(0, 8)}`;
}

export function responseId(): string {
  return `r:${randomUUID().slice(0, 12)}`;
}

export function edgeId(from: string, rel: string, to: string): string {
  const digest = createHash("sha256").update(`${from}\0${rel}\0${to}`).digest("hex").slice(0, 16);
  return `e:${digest}`;
}
