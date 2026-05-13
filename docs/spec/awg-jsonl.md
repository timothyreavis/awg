# AWG JSONL

The canonical V1 backend is append-only JSONL under `.awg/log/YYYY/MM/YYYY-MM-DD.awg.jsonl`. Each non-empty line is one direct AWG object. Compiled files are generated artifacts and are never canonical input. Do not rewrite history to reorganize; append corrective, supersession, archive, or redaction events.

Run attribution is stored as ordinary object/event metadata in canonical JSONL, not a side database. New write commands may include `run` and `runId` on created durable objects and related events. Older entries without run metadata remain valid; unknown fields are preserved through validation and compilation. Derived run summaries are compiled artifacts and can be regenerated from canonical logs.
