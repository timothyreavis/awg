import type { AwgObject, RawLogEntry } from "../core/types.js";

export interface AwgStorage {
  readConfig?(): Promise<Record<string, unknown> | null>;
  readSchemas?(): Promise<Record<string, unknown>>;
  readLogEntries(): Promise<RawLogEntry[]>;
  appendLogEntry(entry: AwgObject): Promise<void>;
  writeCompiledArtifact(path: string, data: string | object): Promise<void>;
  readCompiledArtifact(path: string): Promise<string | null>;
}
