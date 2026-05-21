# AWG V2.4.1 Adaptive Vault Onboarding And Pilot Readiness

V2.4.1 makes AWG easier and safer to introduce into a real project without shipping a pile of fixed domain templates.

The goal is to teach agents how to create, review, and evolve the right vault-local operating template for the current scenario. AWG should provide a method, checklist, diagnostics, and readiness gate. It should not pretend that AWG can know every industry, client, research workflow, or operating model in advance.

## Principles

- Prefer adaptive vault-local operating templates over built-in domain packs.
- Teach agents how to design the template for the current vault.
- Keep generated/scaffolded templates `needs_review` until a human or existing approved vault policy allows activation.
- Make template quality inspectable and repairable through deterministic CLI output.
- Keep onboarding local, deterministic, offline, and append-only.
- Do not turn onboarding into transcript ingestion, AI generation, external sync, hosted setup, or a template marketplace.
- Support client/internal pilot use without making AWG client-facing by default.

## Non-Goals

- No large library of preset domain templates.
- No automatic AI-authored template generation.
- No Obsidian import.
- No hosted setup, daemon, MCP server, sync service, package self-update, or plugin marketplace.
- No permission system or multi-user auth.
- No client-facing portal or polished client UI.
- No automatic reading of private project files to infer business rules.
- No storing raw chat transcripts as template material.
- No treating implementation-plan artifacts as operating templates.

## Target Outcome

An agent entering a new vault can:

1. Inspect existing AWG state, release notes, template status, queues, and coordination state.
2. Determine whether the vault already has an approved operating template.
3. If not, create a scenario-specific operating template scaffold from a generic method.
4. Keep that scaffold as `needs_review` until reviewed.
5. Use the scaffold to guide what to capture, what not to capture, what requires evidence, what goes stale, what is sensitive, and what needs human approval.
6. Run a readiness check before using AWG for a real client or high-stakes project.
7. Leave clear next actions instead of silently proceeding with a weak or missing template.

## Adaptive Template Authoring Model

V2.4.1 should treat a vault operating template as durable AWG knowledge, usually a normal `type: "process"` node tagged `template:operating`.

The operating template should answer:

- `purpose`: What is this vault for?
- `scope`: What belongs in this vault, and what belongs elsewhere?
- `actors`: Which kinds of agents or humans use it?
- `capture_policy`: What future-affecting knowledge should agents capture?
- `non_capture_policy`: What should stay in chat, source files, external systems, or not be stored?
- `taxonomy`: Preferred node types, statuses, tags, edge relations, and field conventions.
- `evidence_rules`: What needs proof before being treated as complete or true?
- `freshness_rules`: What decays, when to review it, and how to mark historical information.
- `sensitivity_rules`: What is private, client-sensitive, financial, credential-like, or unsafe to surface broadly?
- `approval_rules`: What requires human approval before being marked accepted, completed, published, or client-visible?
- `queue_rules`: Which queue items are safe for autonomous work and which require review?
- `coordination_rules`: When to claim work, use shared/watch claims, release claims, or hand off to another agent.
- `lens_rules`: Which built-in/configurable lenses should agents use for repeated work.
- `view_rules`: Which human surfaces matter for this vault.
- `cross_vault_rules`: How to handle related projects or parent/child vaults.
- `maintenance_rules`: How agents should handle stale nodes, duplicates, orphan nodes, unresolved questions, risks, and blockers.
- `backup_rules`: How the project-local `.awg` vault should be versioned, backed up, or exported before relying on it for high-stakes work.
- `retention_rules`: What should be retained, archived, or avoided in durable memory.
- `export_rules`: How to produce a safe handoff/export without leaking private material.

These fields may live under `fields`, with explanatory detail in `body` and optional safe `blocks` for a checklist/table. `summary` remains short and scan-oriented.

Implementation-plan artifacts must not use `template`, `operating-template`, or `template:operating` tags. Those tags are reserved for actual vault-local operating templates. V2.4.1 should include a regression test that roadmap/spec artifact nodes are not selected as operating templates.

## Field Contract

Use one shared machine-readable field contract across `template guide`, `template status`, and `vault readiness`.

Each field contract entry should include:

- `name`
- `description`
- `requiredForTemplate`: boolean
- `requiredForClientPilot`: boolean
- `recommended`: boolean
- `notApplicableAllowed`: boolean
- `aliases`: array of compatibility names
- `placeholderValues`: values or prefixes that mean the field is still unfilled, such as `Describe...`
- `sensitive`: whether the field may reference sensitive handling policy.

Canonical field contract:

| Field | Template required | Client-pilot required | Recommended | Not applicable allowed |
| --- | --- | --- | --- | --- |
| `scope` | yes | yes | yes | no |
| `purpose` | yes | yes | yes | no |
| `taxonomy` | yes | yes | yes | no |
| `freshness_rules` | yes | yes | yes | no |
| `agent_rules` | yes | yes | yes | no |
| `review_state` | yes | yes | yes | no |
| `human_approved` | yes | yes | yes | no |
| `actors` | no | no | yes | yes |
| `capture_policy` | no | yes | yes | no |
| `non_capture_policy` | no | yes | yes | no |
| `evidence_rules` | no | yes | yes | no |
| `sensitivity_rules` | no | yes | yes | no |
| `approval_rules` | no | yes | yes | no |
| `queue_rules` | no | no | yes | yes |
| `coordination_rules` | no | no | yes | yes |
| `lens_rules` | no | no | yes | yes |
| `view_rules` | no | no | yes | yes |
| `cross_vault_rules` | no | no | yes | yes |
| `maintenance_rules` | no | no | yes | yes |
| `backup_rules` | no | yes | yes | no |
| `retention_rules` | no | yes | yes | no |
| `export_rules` | no | yes | yes | no |

Allow `not_applicable_fields` as an explicit array when a recommended field truly does not apply. Readiness checks should not force agents to write filler text just to satisfy a field. Each not-applicable entry should have a short reason when feasible.

Sensitivity rules for client-pilot mode must cover more than API keys and passwords. They should explicitly address customer PII, private client context, financials, billing/contracts, internal strategy, approval boundaries, credentials/secrets, source-of-truth systems, redaction/summarization expectations, and "never capture" categories.

Scaffold placeholder values must not satisfy client-pilot readiness. The deterministic default is to compute `placeholderFields` from each field contract entry's `placeholderValues`, plus `null`, empty string, empty object, and empty array. The default placeholder values should include `Describe`, `TODO`, `TBD`, `...`, `not configured`, and `fill this in`. An optional `authoring_state` field may be added later as an additional signal, but V2.4.1 readiness should not depend on it.

## Allowed Context Sources

Agents should fill an operating template from approved or explicit sources:

- existing AWG state.
- the user's current explicit goal and instructions.
- user-provided files or paths.
- existing approved project docs.
- repository metadata and named docs that are already part of the task.
- targeted project inspection after user instruction or an existing approved vault template allows it.

Agents should not broadly scan customer, financial, credential, private, or unrelated project content to infer template rules. Do not store raw private excerpts, secrets, transcripts, or customer records in the template. Prefer summarized rules, source-of-truth boundaries, and links/anchors to approved docs.

## CLI Surface

Keep the implementation small and centered on the existing `template` and `vault` surfaces.

### `awg template guide`

Add:

```sh
awg template guide [--goal "<goal>"] [--json]
```

Behavior:

- Read-only.
- Returns the adaptive authoring checklist, field explanations, review expectations, and suggested commands.
- Does not inspect repository files, call AI, call network services, or write logs.
- In JSON, include stable sections such as:

```json
{
  "ok": true,
  "goal": "Client SEO audit",
  "fieldContract": [
    {
      "name": "purpose",
      "requiredForTemplate": true,
      "requiredForClientPilot": true,
      "recommended": true,
      "notApplicableAllowed": false,
      "aliases": [],
      "description": "What this vault is for.",
      "placeholderValues": ["Describe"]
    }
  ],
  "questions": [
    {
      "id": "purpose",
      "prompt": "What future work should this vault help agents perform?"
    }
  ],
  "suggestedCommands": [
    "awg template scaffold --title \"Operating template\" --goal \"Client SEO audit\" --scope vault --json"
  ]
}
```

JSON contract:

- `ok`: true when the command completed.
- `goal`: optional user-provided goal string.
- `fieldContract`: the shared contract entries from this spec.
- `questions`: deterministic authoring prompts. Each item must include `id`, `prompt`, and may include `field`, `why`, and `examples`.
- `sections`: optional grouped text guidance for human output. Each item must include `id`, `title`, and `items`.
- `warnings`: non-fatal authoring warnings. Each item must include `code`, `severity`, and `message`.
- `suggestedCommands`: concrete safe commands; never include approval or destructive commands.

### `awg template scaffold`

Enhance the existing scaffold command rather than adding domain packs.

Support:

```sh
awg template scaffold --title <title> [--goal "<goal>"] [--scope vault|project] [--json]
```

Rules:

- Default `review_state` remains `needs_review`.
- Default `human_approved` remains `false`.
- The scaffold should include the adaptive fields listed above with placeholder guidance, not domain-specific answers.
- The scaffold should include a body checklist explaining how an agent should fill it in after inspecting the real project.
- The command should not create multiple duplicate operating templates without warning.
- If an active approved template already exists, warn and suggest inspecting/updating it instead of creating another.
- `--json` must expose created node id, required fields, recommended fields, warnings, and suggested next commands.
- Do not support self-approving a scaffold in V2.4.1. Human approval should happen through an explicit later update/review path, not during scaffold creation.
- Scaffolded templates may keep node `status: "needs_review"` and `fields.review_state: "needs_review"`. `template status` and `vault readiness` must surface these as `pendingTemplates` or `candidateTemplates`, not ignore them and not treat them as active settled policy.
- If the implementation chooses `status: "active"` for backwards compatibility, it must still treat `fields.review_state: "needs_review"` and `fields.human_approved: false` as not ready for client-pilot use.

Suggested JSON shape:

```json
{
  "ok": true,
  "nodeId": "n:pilot-operating-template",
  "runId": "run:...",
  "node": {},
  "fieldContract": [],
  "requiredFields": ["scope", "purpose", "taxonomy", "freshness_rules", "agent_rules", "review_state", "human_approved"],
  "recommendedFields": ["actors", "capture_policy", "non_capture_policy"],
  "warnings": [],
  "suggestedCommands": [
    "awg node show n:pilot-operating-template --json",
    "awg template status --goal \"Client SEO audit\" --json"
  ],
  "duplicateCandidates": [],
  "existingApprovedTemplateIds": []
}
```

### `awg template status`

Improve `template status --json` so agents can act without reading prose docs.

Add where low-risk:

- `authoringGuidance`
- `fieldContract`
- `requiredFields`
- `recommendedFields`
- `pendingTemplates` or `candidateTemplates`
- `missingRecommendedFields`
- `notApplicableFields`
- `placeholderFields`
- `pilotReadinessImpact`
- `suggestedCommands`

Do not mutate state.

Suggested JSON additions:

```json
{
  "ok": true,
  "goal": "Client SEO audit",
  "selectedTemplate": null,
  "activeTemplates": [],
  "pendingTemplates": [
    {
      "id": "n:...",
      "title": "Pilot operating template",
      "reviewState": "needs_review",
      "humanApproved": false,
      "missingRequiredFields": ["taxonomy"],
      "missingClientPilotFields": ["sensitivity_rules"],
      "placeholderFields": ["purpose"]
    }
  ],
  "fieldContract": [],
  "notApplicableFields": [],
  "pilotReadinessImpact": {
    "ready": false,
    "blockingReasons": ["No reviewed human-approved operating template."]
  },
  "suggestedCommands": []
}
```

`selectedTemplate` must only reference a reviewed or otherwise active operating template that is allowed to guide agents. Candidate or scaffolded templates belong in `pendingTemplates` or `candidateTemplates` until reviewed.

Template discovery should avoid false positives:

- Active operating templates should be normal `type: "process"`, `type: "standard"`, `type: "policy"`, or legacy `type: "template"` nodes.
- `template:operating` is the preferred tag for actual operating templates.
- `template` and `operating-template` tags may remain compatibility aliases, but `artifact` nodes with those tags must not be selected as active operating templates.
- Mis-tagged implementation artifacts should produce a warning and suggested cleanup, not become selected policy.
- Status/readiness should expose pending/candidate templates separately from active reviewed templates.

### `awg vault readiness`

Add a generic readiness check:

```sh
awg vault readiness [--goal "<goal>"] [--client-pilot] [--json]
```

This is not a client template. It is a deterministic readiness report for using AWG in a real/high-stakes vault.

Checks:

- project `.awg` vault exists and builds.
- no fatal diagnostics.
- managed agent instructions are installed or clearly available.
- local release notes are discoverable.
- active operating template exists.
- active operating template has required fields.
- adaptive recommended fields are present or explicitly marked not applicable.
- template is reviewed and human-approved for `--client-pilot`.
- capture and non-capture policies exist.
- evidence and freshness rules exist.
- sensitivity and approval rules exist.
- backup, retention, and export rules exist.
- queues and coordination indexes are available.
- no active run is stale.
- high-priority queue/handoff/doctor warnings are surfaced.
- no secret-like durable content diagnostics.
- no coordination claims are stale or colliding.

JSON shape:

```json
{
  "ok": true,
  "ready": false,
  "mode": "client-pilot",
  "checks": [
    {
      "id": "active_operating_template",
      "ok": true,
      "severity": "required",
      "message": "Active operating template found.",
      "nodeIds": ["n:..."],
      "suggestedCommands": []
    }
  ],
  "requiredFailures": 0,
  "recommendedWarnings": 0,
  "status": "not_ready",
  "suggestedNextActions": []
}
```

Readiness check objects must include:

- `id`
- `ok`
- `severity`: `required`, `recommended`, or `info`.
- `message`
- `nodeIds`
- `runIds`
- `queueItemIds`
- `coordinationIds`
- `suggestedCommands`

Exit-code behavior:

- Text and JSON readiness commands should exit `0` when the command runs successfully, even if `ready:false`, unless the graph cannot be read or a fatal internal error occurs.
- Agents should use the JSON `ready` and `requiredFailures` fields for control flow, not process failure.

Implementation rule:

- `vault readiness` must call internal build/read paths with `write: false`.
- It must not shell out to `awg build`, mutate compiled artifacts, append logs, install instructions, or run non-read-only commands.
- Tests should compare log and compiled artifact mtimes before and after readiness.

Text output should be concise and human-readable.

## Pilot Readiness Standard

For internal use on a real client project, AWG is ready only when:

- The vault builds with zero fatal errors.
- The agent instruction files are installed or the user explicitly confirms agents will read `.awg/AGENTS.md`.
- `awg release current` works.
- `awg template status --json` finds one selected operating template.
- The operating template has at least purpose, scope, taxonomy, capture policy, non-capture policy, evidence rules, freshness rules, sensitivity rules, approval rules, queue rules, and agent rules.
- The template has `fields.review_state: "reviewed"` and `fields.human_approved: true`.
- Needs-review templates produce `ready:false` in `--client-pilot` mode, even when a queue item or handoff exists.
- `awg queue next --json`, `awg coord status --json`, and `awg handoff --compact --no-record` work.
- Doctor has zero fatal errors.
- Secret-like durable content warnings are absent or explicitly reviewed.
- Non-secret sensitive-data handling is explicit for customer PII, financials, private client strategy, contracts/billing, approval-required facts, and never-capture categories.
- Backup/export/retention expectations are documented in the operating template.
- If the existing viewer or optional readiness panel is included in the slice, it builds/loads from static files and remains redacted. A new onboarding/readiness viewer panel is not required for V2.4.1.

Client-facing use is not included in V2.4.1. AWG may support internal client-project memory after this slice; client-visible surfaces should wait for a later safety/UI phase.

## Agent Instruction Updates

Generated instructions should teach:

- Do not search for a built-in domain pack first.
- Inspect the vault and create a vault-local operating template only when one is missing or clearly inadequate.
- Use `awg template guide --json` to understand how to author the template.
- Use `awg template scaffold` as a starting point, then fill in scenario-specific guidance from the real project context.
- Keep new templates `needs_review` by default.
- Do not rewrite approved templates casually.
- Propose changes to approved templates with a separate `needs_review` amendment/task node, or with an update that resets review metadata to `human_approved: false` and includes `change_rationale`, `affected_sections`, and `migration_notes`.
- Capture the consequence, not the conversation.
- For client/high-stakes vaults, run `awg vault readiness --client-pilot --json` before relying on AWG as the primary agent memory.
- Treat AWG as internal agent memory unless a later phase marks a surface client-safe.

## Diagnostics And Doctor

Add or improve diagnostics for:

- no active operating template.
- multiple conflicting active templates.
- implementation-plan artifact selected as an operating template.
- missing required template fields.
- missing recommended adaptive fields.
- template marked reviewed but `human_approved` is false.
- template has sensitivity rules missing in client-pilot readiness.
- template has no explicit customer PII, financial, private-client-context, contract/billing, or never-capture policy in client-pilot readiness.
- template has no non-capture policy.
- template has no evidence/freshness policy.
- template has no approval rules.
- template has no backup, retention, or export rules.
- client-pilot readiness attempted with unresolved secret-like content warnings.

Doctor fix suggestions must stay conservative:

- inspect template status.
- run template guide.
- scaffold a reviewed-later template.
- update an existing template field.
- mark template `needs_review`.
- ask human to review.

Do not suggest destructive commands or automatic approval. In particular, fix suggestions must not include commands that set `fields.human_approved=true`, `human_approved=true`, `fields.review_state=reviewed`, or `review_state=reviewed`. They may suggest preparing a review task, filling missing fields, or asking a human to approve after inspection.

## Viewer Surface

Defer viewer onboarding/readiness UI unless it is trivial and clearly redacted. If implemented, add only a small read-only panel to the existing settings or overview surface. It should show:

- selected operating template id/title only.
- template review state.
- counts of missing required/recommended fields.
- pilot readiness result.
- suggested commands.

Do not show private node titles, summaries, raw diagnostics, customer data, financials, or sensitive template content in the readiness panel by default. Do not add a large onboarding wizard, browser-side writes, or a client-facing UI in V2.4.1.

## Tests Required

- `template guide --json` returns stable checklist data.
- `template guide` text output is concise.
- `template scaffold --goal` writes a normal process node tagged `template:operating`.
- scaffold starts `needs_review` and `human_approved: false`.
- scaffold includes adaptive recommended fields.
- scaffold warns when an active approved template already exists.
- scaffold warns before creating a near-duplicate candidate template.
- scaffold does not support self-approval.
- scaffolded needs-review templates appear as pending/candidate templates in status/readiness.
- implementation-plan artifacts are not selected as operating templates.
- an existing approved template remains selected while unrelated candidates are listed separately.
- `template status --json` exposes field contract, authoring guidance, pending/candidate templates, placeholder fields, and missing recommended fields.
- older vaults without adaptive fields still compile.
- `vault readiness --json` is parseable and read-only.
- `vault readiness --json` exits successfully with `ready:false` when readiness fails for normal graph reasons.
- `vault readiness --client-pilot` fails when no reviewed/human-approved template exists.
- `vault readiness --client-pilot` fails while scaffold placeholders remain in client-pilot-required fields.
- `vault readiness --client-pilot` fails when non-secret sensitive-data policy is missing.
- `vault readiness --client-pilot` fails when backup/export/retention rules are missing.
- readiness passes in a temp vault with reviewed template, instructions, build, doctor, queues, and coordination available.
- readiness surfaces secret-like diagnostics as blockers for client-pilot mode.
- readiness surfaces high-priority queue/coordination warnings without mutating state.
- readiness does not append logs or write compiled artifacts.
- generated instructions include adaptive template authoring guidance.
- help, README stable JSON command list, release notes, and generated instruction templates mention `template guide` and `vault readiness`.
- viewer readiness panel is deferred, or if implemented, is counts/status-only by default and does not expose private node titles/summaries.
- no tests touch real `~/.awg`; use isolated HOME/temp vaults.
- full verification: `npm run typecheck`, `npm test`, `awg build --json`, `awg doctor --fix-suggestions --json`, fresh temp-vault smoke, `npm pack --dry-run --json`, and `git diff --check`.

## Fresh Temp-Vault Smoke

Use an isolated temp `HOME` and temp project directory.

Suggested smoke:

```sh
awg init
awg release current --json
awg template guide --goal "pilot client project" --json
awg template status --goal "pilot client project" --json
awg vault readiness --client-pilot --json
awg template scaffold --title "Pilot operating template" --goal "pilot client project" --scope vault --json
awg build --json
awg doctor --fix-suggestions --json
awg template status --goal "pilot client project" --json
awg vault readiness --client-pilot --json
```

Then update the scaffolded template in the test fixture or smoke script to reviewed/human-approved and verify readiness improves.

## Definition Of Done

AWG can guide an agent entering a new or client-like vault to create the right local operating template for that scenario, surface what is missing, require review before high-stakes use, and confirm whether the vault is ready for internal pilot work. This must happen through deterministic local CLI surfaces, docs, diagnostics, and generated instructions, not through fixed domain packs or AI-generated templates.
