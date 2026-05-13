# AWG Diagnostics

Diagnostics provide operational trust. V1 reports malformed JSON, schema errors, incompatible duplicate IDs, dangling edges, orphan nodes, duplicate aliases, completed tasks without evidence, stale review dates, unanswered questions, low-confidence active nodes, and related graph-health counts.

V1.5 adds agent-loop warnings for stale active runs, active runs without recent notes, completed runs without evidence or changed nodes, finished runs without handoff records, active blockers linked to completed/resolved work, and active risks with completed mitigation work that still need review. These diagnostics are warnings unless the source graph is malformed.
