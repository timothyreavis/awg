# AWG JSONL

The canonical V1 backend is append-only JSONL under `.awg/log/YYYY/MM/YYYY-MM-DD.awg.jsonl`. Each non-empty line is one direct AWG object. Compiled files are generated artifacts and are never canonical input. Do not rewrite history to reorganize; append corrective, supersession, archive, or redaction events.
