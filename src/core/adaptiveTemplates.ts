export interface TemplateFieldContract {
  name: string;
  description: string;
  requiredForTemplate: boolean;
  requiredForClientPilot: boolean;
  recommended: boolean;
  notApplicableAllowed: boolean;
  aliases: string[];
  placeholderValues: string[];
  sensitive?: boolean;
}

export const PLACEHOLDER_VALUES = ["Describe", "TODO", "TBD", "...", "not configured", "fill this in"];

export const TEMPLATE_FIELD_CONTRACT: TemplateFieldContract[] = [
  field("scope", "What belongs in this vault and what belongs elsewhere.", true, true, true, false),
  field("purpose", "What this vault is for and what future work it should support.", true, true, true, false),
  field("taxonomy", "Object describing preferred node types, statuses, tags, edge relations, and field conventions.", true, true, true, false),
  field("freshness_rules", "What decays, when to review it, and how to mark historical information.", true, true, true, false, ["freshnessRules"]),
  field("agent_rules", "Capture thresholds, evidence standards, source-of-truth boundaries, and agent behavior rules.", true, true, true, false, ["agentRules"]),
  field("review_state", "Template review state. Use needs_review until human review is complete.", true, true, true, false, ["reviewState"]),
  field("human_approved", "Boolean human approval marker for settled operating policy.", true, true, true, false, ["humanApproved"]),
  field("actors", "Kinds of agents or humans that use this vault.", false, false, true, true),
  field("capture_policy", "Future-affecting knowledge agents should capture.", false, true, true, false, ["capturePolicy"]),
  field("non_capture_policy", "Knowledge that should stay in chat, files, external systems, or not be stored.", false, true, true, false, ["nonCapturePolicy"]),
  field("evidence_rules", "What needs proof before being treated as complete or true.", false, true, true, false, ["evidenceRules"]),
  field("sensitivity_rules", "Private, client-sensitive, financial, credential-like, and redaction handling rules.", false, true, true, false, ["sensitivityRules"], true),
  field("approval_rules", "What requires human approval before being accepted, completed, published, or client-visible.", false, true, true, false, ["approvalRules"]),
  field("queue_rules", "Which queue items are safe for autonomous work and which require review.", false, false, true, true, ["queueRules"]),
  field("coordination_rules", "When to claim work, use shared/watch claims, release claims, or hand off.", false, false, true, true, ["coordinationRules"]),
  field("lens_rules", "Which built-in or configurable lenses agents should use for repeated work.", false, false, true, true, ["lensRules"]),
  field("view_rules", "Which human surfaces matter for this vault.", false, false, true, true, ["viewRules"]),
  field("cross_vault_rules", "How to handle related projects or parent/child vaults.", false, false, true, true, ["crossVaultRules"]),
  field("maintenance_rules", "How agents handle stale nodes, duplicates, orphan nodes, questions, risks, and blockers.", false, false, true, true, ["maintenanceRules"]),
  field("backup_rules", "How the project-local .awg vault is versioned, backed up, or exported before high-stakes use.", false, true, true, false, ["backupRules"]),
  field("retention_rules", "What should be retained, archived, or avoided in durable memory.", false, true, true, false, ["retentionRules"]),
  field("export_rules", "How to produce safe handoffs or exports without leaking private material.", false, true, true, false, ["exportRules"])
];

export const REQUIRED_TEMPLATE_FIELDS = TEMPLATE_FIELD_CONTRACT.filter((item) => item.requiredForTemplate).map((item) => item.name);
export const RECOMMENDED_TEMPLATE_FIELDS = TEMPLATE_FIELD_CONTRACT.filter((item) => item.recommended && !item.requiredForTemplate).map((item) => item.name);
export const CLIENT_PILOT_FIELDS = TEMPLATE_FIELD_CONTRACT.filter((item) => item.requiredForClientPilot).map((item) => item.name);
export function templateFieldHints(): Record<string, string> {
  return Object.fromEntries(TEMPLATE_FIELD_CONTRACT.map((item) => [item.name, item.description]));
}

export function adaptiveAuthoringGuide(goal?: string | null): {
  ok: true;
  goal: string | null;
  fieldContract: TemplateFieldContract[];
  questions: Array<{ id: string; field: string; prompt: string; why: string; examples?: string[] }>;
  sections: Array<{ id: string; title: string; items: string[] }>;
  warnings: Array<{ code: string; severity: "info" | "warning"; message: string }>;
  suggestedCommands: string[];
} {
  const goalText = goal?.trim() || "<goal>";
  return {
    ok: true,
    goal: goal?.trim() || null,
    fieldContract: TEMPLATE_FIELD_CONTRACT,
    questions: [
      { id: "purpose", field: "purpose", prompt: "What future work should this vault help agents perform?", why: "Purpose keeps capture scoped." },
      { id: "capture", field: "capture_policy", prompt: "Which decisions, facts, risks, and evidence will affect future work?", why: "Agents need clear capture thresholds." },
      { id: "non_capture", field: "non_capture_policy", prompt: "What should stay out of AWG or remain in source-of-truth systems?", why: "Non-capture rules prevent transcript and private-data creep." },
      { id: "sensitivity", field: "sensitivity_rules", prompt: "How should agents handle PII, private client context, finances, contracts, credentials, source-of-truth systems, redaction, and never-capture categories?", why: "Client-pilot use needs explicit sensitive-data handling." },
      { id: "approval", field: "approval_rules", prompt: "What requires human approval before being marked accepted, completed, published, or client-visible?", why: "Approval boundaries keep agents from self-authorizing." }
    ],
    sections: [
      { id: "method", title: "Authoring Method", items: ["Inspect existing AWG state and explicit user-provided context.", "Create or update one vault-local operating template.", "Keep new templates needs_review until human approval.", "Capture summarized rules and source-of-truth boundaries, not raw transcripts or private excerpts."] },
      { id: "review", title: "Review Expectations", items: ["Scaffolds are candidates, not settled policy.", "Client-pilot readiness requires reviewed and human_approved template fields.", "Doctor suggestions must not self-approve operating templates."] }
    ],
    warnings: [
      { code: "AWG_TEMPLATE_NO_DOMAIN_PACKS", severity: "info", message: "Create scenario-specific vault-local rules; do not search for a built-in domain pack." }
    ],
    suggestedCommands: [
      `awg template scaffold --title ${shellQuote("Operating template")} --goal ${shellQuote(goalText)} --scope vault --json`,
      `awg template status --goal ${shellQuote(goalText)} --json`,
      `awg vault readiness --goal ${shellQuote(goalText)} --client-pilot --json`
    ]
  };
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function fieldValue(fields: Record<string, unknown>, contract: TemplateFieldContract): unknown {
  for (const key of [contract.name, ...contract.aliases]) if (Object.prototype.hasOwnProperty.call(fields, key)) return fields[key];
  return undefined;
}

export function explicitNotApplicable(fields: Record<string, unknown>, name: string): boolean {
  const raw = fields.not_applicable_fields ?? fields.notApplicableFields;
  if (!Array.isArray(raw)) return false;
  return raw.some((item) => typeof item === "string" ? item === name : Boolean(item && typeof item === "object" && (item as { field?: unknown }).field === name));
}

export function isPlaceholderValue(value: unknown, contract?: TemplateFieldContract): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "boolean") return false;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return true;
    const lower = trimmed.toLowerCase();
    return [...PLACEHOLDER_VALUES, ...(contract?.placeholderValues ?? [])].some((placeholder) => {
      const marker = placeholder.toLowerCase();
      return lower === marker || lower.startsWith(`${marker}:`) || lower.startsWith(`${marker}.`) || lower.startsWith(`${marker} `);
    });
  }
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function field(name: string, description: string, requiredForTemplate: boolean, requiredForClientPilot: boolean, recommended: boolean, notApplicableAllowed: boolean, aliases: string[] = [], sensitive = false): TemplateFieldContract {
  return { name, description, requiredForTemplate, requiredForClientPilot, recommended, notApplicableAllowed, aliases, placeholderValues: PLACEHOLDER_VALUES, ...(sensitive ? { sensitive } : {}) };
}
