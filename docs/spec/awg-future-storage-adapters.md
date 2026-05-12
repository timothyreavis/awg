# Future Storage Adapters

V1 implements only local files through `AwgStorage`. Future SQLite materialization can support larger local vaults, and future Postgres/API adapters can support remote multi-agent use. Migration should remain JSONL -> database and database -> JSONL exportable. V1 intentionally ships no SQLite, Postgres, daemon, sync, server, MCP server, marketplace, vector search, or LLM calls.
