# AWG Compiler

The compiler deterministically loads config and schemas, reads log files in sorted path order, parses and validates lines, materializes current graph state with last-write-wins upserts, builds indexes, runs diagnostics, and writes compiled artifacts. Compiled `generated_at` metadata is derived from source object timestamps, not wall-clock build time. It never calls an LLM, never requires network access, and exits nonzero on fatal errors.
