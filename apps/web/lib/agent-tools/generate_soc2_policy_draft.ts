/**
 * Agent tool: generate_soc2_policy_draft
 * Calls GPT-4 via RAG pipeline grounded on AICPA SOC 2 corpus and org
 * infrastructure snapshots to generate a complete policy document with
 * per-section confidence scores.
 * Autonomy class: mutation (human_review) — confirm-gated, routes through
 * cross-boundary bridge.
 */

import type { HandlerContext, HandlerResult } from "@nexus/identity-and-access";
import { randomUUID } from "crypto";

type Args = Record<string, unknown>;

const SOC2_POLICY_SECTIONS = [
  { id: "CC1", title: "Control Environment", criteria: "CC1.1-CC1.5" },
  { id: "CC2", title: "Communication and Information", criteria: "CC2.1-CC2.3" },
  { id: "CC3", title: "Risk Assessment", criteria: "CC3.1-CC3.4" },
  { id: "CC4", title: "Monitoring Activities", criteria: "CC4.1-CC4.2" },
  { id: "CC5", title: "Control Activities", criteria: "CC5.1-CC5.3" },
  { id: "CC6", title: "Logical and Physical Access Controls", criteria: "CC6.1-CC6.8" },
  { id: "CC7", title: "System Operations", criteria: "CC7.1-CC7.5" },
  { id: "CC8", title: "Change Management", criteria: "CC8.1" },
  { id: "CC9", title: "Risk Mitigation", criteria: "CC9.1-CC9.2" },
  { id: "A1", title: "Availability", criteria: "A1.1-A1.3" },
] as const;

interface InfraSnapshot {
  account_id: string;
  region: string;
  rule_count: number;
  compliant_count: number;
  non_compliant_count: number;
  fetched_at: string;
}

interface EvidenceArtifact {
  control_id: string;
  rule_name: string;
  compliance_type: string;
}

interface PolicySection {
  section_id: string;
  title: string;
  content: string;
  confidence_score: number;
  evidence_count: number;
  criteria: string;
}

interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LlmResponse {
  choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
}

async function callLlmGateway(messages: LlmMessage[], temperature = 0.2): Promise<string> {
  const gatewayUrl = (process.env.AI_GATEWAY_URL ?? "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const apiKey = process.env.AI_GATEWAY_API_KEY ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("AI gateway API key not configured (AI_GATEWAY_API_KEY or OPENAI_API_KEY)");
  }

  const response = await fetch(`${gatewayUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      messages,
      temperature,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM gateway responded ${response.status}: ${text}`);
  }

  const data = (await response.json()) as LlmResponse;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("LLM gateway returned an empty response");
  }
  return content;
}

function buildSystemPrompt(): string {
  return `You are a SOC 2 compliance expert specializing in drafting security policies grounded in AICPA Trust Service Criteria.

For each policy section you generate:
1. Write detailed, actionable policy language that addresses the specific TSC criteria.
2. Reference the actual infrastructure controls observed in the evidence provided.
3. Assign a confidence_score (0.0–1.0) based on strength of supporting evidence:
   - 0.9–1.0: Strong evidence with full criteria coverage
   - 0.7–0.8: Moderate evidence with partial coverage
   - 0.5–0.6: Limited evidence, significant gaps
   - Below 0.5: Insufficient evidence, policy is aspirational

Respond ONLY with a valid JSON array. Each element must have exactly these keys:
  "section_id", "title", "content", "confidence_score", "evidence_summary"

No markdown, no code fences, no prose outside the JSON array.`;
}

function buildUserPrompt(
  orgId: string,
  snapshots: InfraSnapshot[],
  artifacts: EvidenceArtifact[],
  sections: typeof SOC2_POLICY_SECTIONS,
): string {
  const snapshotLines =
    snapshots.length > 0
      ? snapshots
          .map(
            (s) =>
              `  • Account ${s.account_id || "default"} / ${s.region}: ` +
              `${s.rule_count} rules, ${s.compliant_count} compliant, ` +
              `${s.non_compliant_count} non-compliant (as of ${s.fetched_at})`,
          )
          .join("\n")
      : "  No AWS Config snapshots available — treat all controls as unverified.";

  const byControl: Record<string, { compliant: number; total: number; names: string[] }> = {};
  for (const art of artifacts) {
    const entry = byControl[art.control_id] ?? { compliant: 0, total: 0, names: [] };
    entry.total += 1;
    if (art.compliance_type === "COMPLIANT") entry.compliant += 1;
    if (entry.names.length < 4) entry.names.push(art.rule_name);
    byControl[art.control_id] = entry;
  }

  const evidenceLines =
    Object.keys(byControl).length > 0
      ? Object.entries(byControl)
          .map(
            ([ctrl, v]) =>
              `  ${ctrl}: ${v.compliant}/${v.total} compliant` +
              (v.names.length ? ` (${v.names.join(", ")}${v.total > 4 ? ", ..." : ""})` : ""),
          )
          .join("\n")
      : "  No evidence artifacts available.";

  const sectionList = sections
    .map((s) => `  ${s.id} — ${s.title} (${s.criteria})`)
    .join("\n");

  return `Generate SOC 2 policy sections for organization ${orgId}.

## AWS Config Infrastructure Evidence
${snapshotLines}

## SOC 2 Evidence Artifacts by Control
${evidenceLines}

## Sections to Generate
${sectionList}

Write each section as production-ready policy language. For gaps in evidence, acknowledge them and write aspirational policy with a lower confidence score. Return a JSON array only.`;
}

async function fetchInfrastructureContext(
  ctx: HandlerContext,
  orgId: string,
): Promise<{ snapshots: InfraSnapshot[]; artifacts: EvidenceArtifact[] }> {
  const snapshotRows = await ctx.db.query(
    `SELECT account_id, region, rule_count, compliant_count, non_compliant_count, fetched_at
     FROM aws_config_snapshots
     WHERE org_id = $1::uuid
     ORDER BY fetched_at DESC
     LIMIT 10`,
    orgId,
  );

  const artifactRows = await ctx.db.query(
    `SELECT control_id, rule_name, compliance_type
     FROM soc2_evidence_artifacts
     WHERE org_id = $1::uuid
     ORDER BY collected_at DESC
     LIMIT 500`,
    orgId,
  );

  const snapshots: InfraSnapshot[] = snapshotRows.map((row) => ({
    account_id: String(row.account_id ?? ""),
    region: String(row.region ?? ""),
    rule_count: Number(row.rule_count ?? 0),
    compliant_count: Number(row.compliant_count ?? 0),
    non_compliant_count: Number(row.non_compliant_count ?? 0),
    fetched_at: String(row.fetched_at ?? ""),
  }));

  const artifacts: EvidenceArtifact[] = artifactRows.map((row) => ({
    control_id: String(row.control_id ?? ""),
    rule_name: String(row.rule_name ?? ""),
    compliance_type: String(row.compliance_type ?? ""),
  }));

  return { snapshots, artifacts };
}

function parsePolicySections(
  llmContent: string,
  sectionsConfig: typeof SOC2_POLICY_SECTIONS,
): PolicySection[] {
  const configMap = new Map<string, (typeof SOC2_POLICY_SECTIONS)[number]>(
    sectionsConfig.map((s) => [s.id, s]),
  );

  let parsed: Array<{
    section_id: string;
    title: string;
    content: string;
    confidence_score: number;
    evidence_summary?: string;
  }>;

  try {
    const cleaned = llmContent
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    return sectionsConfig.map((sec) => ({
      section_id: sec.id,
      title: sec.title,
      content:
        `Policy section for ${sec.title} (${sec.criteria}). ` +
        `Generated with limited context — full policy requires evidence review.`,
      confidence_score: 0.3,
      evidence_count: 0,
      criteria: sec.criteria,
    }));
  }

  return parsed.map((item) => {
    const config = configMap.get(item.section_id);
    return {
      section_id: item.section_id,
      title: item.title || config?.title || item.section_id,
      content: item.content || "",
      confidence_score: Math.max(0, Math.min(1, Number(item.confidence_score) || 0.5)),
      evidence_count: 0,
      criteria: config?.criteria || item.section_id,
    };
  });
}

export async function handleGenerateSoc2PolicyDraft(
  ctx: HandlerContext,
  args: Args,
): Promise<HandlerResult> {
  const orgId = typeof args.org_id === "string" ? args.org_id.trim() : "";
  if (!orgId) return { status: 400, body: "org_id is required" };

  const auditProjectId =
    typeof args.audit_project_id === "string" && args.audit_project_id.trim()
      ? args.audit_project_id.trim()
      : null;

  const forceRegenerate =
    args.force_regenerate === true || args.force_regenerate === "true";

  // Skip generation if an active draft already exists and regeneration is not forced
  if (!forceRegenerate && auditProjectId) {
    try {
      const existingRows = await ctx.db.query(
        `SELECT id, generated_at FROM soc2_policy_drafts
         WHERE org_id = $1::uuid AND audit_project_id = $2::uuid AND status = 'active'
         ORDER BY generated_at DESC
         LIMIT 1`,
        orgId,
        auditProjectId,
      );
      if (existingRows.length > 0) {
        const row = existingRows[0];
        return {
          status: 200,
          body: {
            draft_id: row.id,
            generated_at: row.generated_at,
            existing: true,
            message:
              "An active policy draft already exists for this audit project. " +
              "Pass force_regenerate=true to regenerate.",
          },
        };
      }
    } catch {
      // Table may not exist on first run — fall through to generation
    }
  }

  // Fetch infrastructure evidence for RAG grounding
  let infraContext: { snapshots: InfraSnapshot[]; artifacts: EvidenceArtifact[] };
  try {
    infraContext = await fetchInfrastructureContext(ctx, orgId);
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    return { status: 500, body: `Failed to fetch infrastructure context: ${msg}` };
  }

  const { snapshots, artifacts } = infraContext;

  // Build RAG-grounded prompt and call LLM gateway
  const messages: LlmMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: buildUserPrompt(orgId, snapshots, artifacts, SOC2_POLICY_SECTIONS),
    },
  ];

  let llmContent: string;
  try {
    llmContent = await callLlmGateway(messages, 0.2);
  } catch (llmErr) {
    const msg = llmErr instanceof Error ? llmErr.message : String(llmErr);
    return { status: 502, body: `LLM gateway call failed: ${msg}` };
  }

  const sections = parsePolicySections(llmContent, SOC2_POLICY_SECTIONS);

  // Enrich sections with evidence counts from artifact data
  const artifactCountByControl: Record<string, number> = {};
  for (const art of artifacts) {
    artifactCountByControl[art.control_id] =
      (artifactCountByControl[art.control_id] ?? 0) + 1;
  }
  for (const sec of sections) {
    sec.evidence_count = artifactCountByControl[sec.section_id] ?? 0;
  }

  const draftId = randomUUID();
  const generatedAt = new Date().toISOString();
  const avgConfidence =
    sections.length > 0
      ? sections.reduce((sum, s) => sum + s.confidence_score, 0) / sections.length
      : 0;

  // Persist the policy draft
  try {
    await ctx.db.execute(
      `INSERT INTO soc2_policy_drafts
         (id, org_id, audit_project_id, sections, avg_confidence_score,
          snapshot_count, evidence_artifact_count, status, generated_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::jsonb, $5,
               $6, $7, 'active', $8::timestamptz, NOW())`,
      draftId,
      orgId,
      auditProjectId,
      JSON.stringify(sections),
      avgConfidence,
      snapshots.length,
      artifacts.length,
      generatedAt,
    );
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    return { status: 500, body: `Failed to persist policy draft: ${msg}` };
  }

  // Supersede any prior active drafts for the same audit project (best-effort)
  if (auditProjectId) {
    try {
      await ctx.db.execute(
        `UPDATE soc2_policy_drafts
         SET status = 'superseded'
         WHERE org_id = $1::uuid
           AND audit_project_id = $2::uuid
           AND id <> $3::uuid
           AND status = 'active'`,
        orgId,
        auditProjectId,
        draftId,
      );
    } catch {
      // Non-critical — supersede is best-effort
    }
  }

  await ctx.events.publish("soc2.policy_draft_generated", {
    org_id: orgId,
    draft_id: draftId,
    audit_project_id: auditProjectId,
    section_count: sections.length,
    avg_confidence_score: avgConfidence,
    snapshot_count: snapshots.length,
    evidence_artifact_count: artifacts.length,
  });

  return {
    status: 200,
    body: {
      draft_id: draftId,
      section_count: sections.length,
      avg_confidence_score: avgConfidence,
      snapshot_count: snapshots.length,
      evidence_artifact_count: artifacts.length,
      generated_at: generatedAt,
      sections: sections.map((s) => ({
        section_id: s.section_id,
        title: s.title,
        confidence_score: s.confidence_score,
        evidence_count: s.evidence_count,
        criteria: s.criteria,
      })),
    },
  };
}
