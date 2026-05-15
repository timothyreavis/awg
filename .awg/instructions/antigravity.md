<!-- BEGIN AWG MANAGED INSTRUCTIONS id=antigravity hash=sha256:e33b73934fc30cad1f167be832c920d776a8eb7cfb919f4618ebc6bec7099b3f -->
# AWG Antigravity Snippet

Use the project-local .awg vault only. Start with `awg handoff`, check `awg vault topology --json` before cross-project work, then `awg run start --goal "<goal>"`. Use `awg search` before creating nodes, inspect `awg template status --goal "<goal>" --json`, scope work with `awg lens task --goal "<goal>"`, and inspect full surfaced nodes with `awg node show <node-id> --json` when needed. Update existing nodes, use structured fields/safe blocks/freshness/anchors when useful, add run notes, attach evidence for completed work, write only to the current explicit target vault, then run `awg build`, `awg doctor --fix-suggestions --json`, and `awg run finish --status completed|partial|blocked|failed --summary "..." --auto-handoff`. If forced, document why.
<!-- END AWG MANAGED INSTRUCTIONS -->
