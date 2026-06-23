/**
 * Agent tool: run_control_gap_analysis
 * Evaluates all 20 SOC 2 controls against current evidence artifacts, computes
 * per-control gap status and overall readiness score, writes a gap report record
 * with prioritized remediation items, and returns the executive summary for
 * notification dispatch.
 * Autonomy class: autonomous — analysis executes inline via the generic LLM
 * handler; the resulting mutation (gap report record) routes through the
 * cross-boundary bridge.
 */

import type { HandlerContext, HandlerResult } from "@nexus/identity-and-access";
import { randomUUID } from "crypto";

type Args = Record<string, unknown>;

const SOC2_CONTROLS = [
  { id: "CC1.1", category: "CC1", title: "COSO Principle 1 — Demonstrates Commitment to Integrity" },
  { id: "CC1.2", category: "CC1", title: "COSO Principle 2 — Exercises Oversight Responsibility" },
  { id: "CC1.3", category: "CC1", title: "COSO Principle 3 — Establishes Structure, Authority, Responsibility" },
  { id: "CC1.4", category: "CC1", title: "COSO Principle 4 — Demonstrates Commitment to Competence" },
  { id: "CC1.5", category: "CC1", title: "COSO Principle 5 — Enforces Accountability" },
  { id: "CC2.1", category: "CC2", title: "Information Quality Objectives" },
  { id: "CC2.2", category: "CC2", title: "Internal Communication" },
  { id: "CC2.3", category: "CC2", title: "External Communication" },
  { id: "CC3.1", category: "CC3", title: "Specifies Suitable Objectives" },
  { id: "CC3.2", category: "CC3", title: "Identifies and Analyzes Risk" },
  { id: "CC3.3", category: "CC3", title: "Assesses Fraud Risk" },
  { id: "CC3.4", category: "CC3", title: "Identifies and Analyzes Significant Change" },
  { id: "CC6.1", category: "CC6", title: "Logical Access Security Software" },
  { id: "CC6.2", category: "CC6", title: "New Internal Personnel and Contractors" },
  { id: "CC6.3", category: "CC6", title: "Network and Infrastructure Security" },
  { id: "CC7.1", category: "CC7", title: "Vulnerability Management" },
  { id: "CC7.2", category: "CC7", title: "Monitors System Components" },
  { id: "CC7.3", category: "CC7", title: "Evaluates Security Events" },
  { id: "CC8.1", category: "CC8", title: "Change Management Process" },
  { id: "A1.1", category: "A1", title: "Capacity Planning" },
] as const;

type ControlId = (typeof SOC2_CONTROLS)[number]["id"];

type GapStatus = "compliant" | "partial" | "gap" | "not_assessed";

interface EvidenceArtifact {
  control_id: string;
  rule_name: string;
  compliance_type: string;
  collected_at: string;
}

interface ControlGapResult {
  control_id: ControlId;
  title: string;
  category: string;
  gap_status: GapStatus;
  evidence_count: number;
  compliant_count: number;
  non_compliant_count: number;
  coverage_pct: number;
  remediation_priority: "critical" | "high" | "medium" | "low" | "none";
  remediation_items: string[];
  llm_assessment: string;
}

interface RemediationItem {
  control_id: string;
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  description: string;
  estimated_effort_days: number;
}

interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LlmResponse {
  choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
}

async function callLlmGateway(messages: LlmMessage[], temperature = 0.1): Promise<string> {
  const gatewayUrl = (process.env.AI_GATEWAY_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
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
      max_tokens: 6000,
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

function buildGapAnalysisSystemPrompt(): string {
  return `You are a SOC 2 compliance auditor specializing in gap analysis and remediation planning.

For each SOC 2 control you assess:
1. Evaluate the evidence provided (AWS Config rules, compliance types, coverage).
2. Assign a gap_status: "compliant" (>80% coverage, strong evidence), "partial" (40–80% coverage or partial evidence), "gap" (<40% coverage or no evidence), "not_assessed" (zero evidence artifacts).
3. Assign a remediation_priority: "critical" (gap, blocking certification), "high" (partial, significant risk), "medium" (partial, moderate risk), "low" (minor improvement), "none" (compliant).
4. List 1–3 concrete remediation_items (actionable steps) for non-compliant controls.
5. Write a 1–2 sentence llm_assessment explaining the finding.

Respond ONLY with a valid JSON array. Each element must have exactly these keys:
  "control_id", "gap_status", "remediation_priority", "remediation_items", "llm_assessment"

No markdown, no code fences, no prose outside the JSON array.`;
}

function buildGapAnalysisUserPrompt(
  orgId: string,
  artifactsByControl: Record<string, { compliant: number; total: number; names: string[] }>,
  controls: typeof SOC2_CONTROLS,
): string {
  const evidenceLines = controls
    .map((ctrl) => {
      const ev = artifactsByControl[ctrl.id];
      if (!ev) {
        return `  ${ctrl.id} (${ctrl.title}): NO EVIDENCE`;
      }
      const coveragePct = ev.total > 0 ? Math.round((ev.compliant / ev.total) * 100) : 0;
      return (
        `  ${ctrl.id} (${ctrl.title}): ` +
        `${ev.compliant}/${ev.total} compliant (${coveragePct}%)` +
        (ev.names.length ? ` — rules: ${ev.names.slice(0, 3).join(", ")}` : "")
      );
    })
    .join("\n");

  return `Perform a SOC 2 control gap analysis for organization ${orgId}.

## Evidence Summary by Control
${evidenceLines}

## Controls to Assess
${controls.map((c) => `  ${c.id} — ${c.title} (${c.category})`).join("\n")}

Assess each control and return the JSON array as specified.`;
}

function computeGapStatus(compliant: number, total: number): GapStatus {
  if (total === 0) return "not_assessed";
  const pct = compliant / total;
  if (pct >= 0.8) return "compliant";
  if (pct >= 0.4) return "partial";
  return "gap";
}

function parseGapResults(
  llmContent: string,
  artifactsByControl: Record<string, { compliant: number; total: number; names: string[] }>,
  controls: typeof SOC2_CONTROLS,
): ControlGapResult[] {
  let parsed: Array<{
    control_id: string;
    gap_status: GapStatus;
    remediation_priority: string;
    remediation_items: string[];
    llm_assessment: string;
  }> = [];

  try {
    const cleaned = llmContent
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // Fall through — will generate defaults below
  }

  const parsedMap = new Map(parsed.map((p) => [p.control_id, p]));

  return controls.map((ctrl) => {
    const ev = artifactsByControl[ctrl.id] ?? { compliant: 0, total: 0, names: [] };
    const computedStatus = computeGapStatus(ev.compliant, ev.total);
    const coveragePct = ev.total > 0 ? Math.round((ev.compliant / ev.total) * 100) : 0;
    const llmResult = parsedMap.get(ctrl.id);

    const gapStatus: GapStatus = (llmResult?.gap_status as GapStatus) ?? computedStatus;

    const validPriorities = ["critical", "high", "medium", "low", "none"] as const;
    const rawPriority = llmResult?.remediation_priority ?? "";
    const remediationPriority = validPriorities.includes(
      rawPriority as (typeof validPriorities)[number],
    )
      ? (rawPriority as (typeof validPriorities)[number])
      : gapStatus === "gap"
        ? "high"
        : gapStatus === "partial"
          ? "medium"
          : gapStatus === "not_assessed"
            ? "medium"
            : "none";

    const remediationItems: string[] =
      Array.isArray(llmResult?.remediation_items) && llmResult.remediation_items.length > 0
        ? llmResult.remediation_items.slice(0, 3)
        : gapStatus !== "compliant"
          ? [
              `Review and document evidence for ${ctrl.id} — ${ctrl.title}`,
              `Implement automated checks for ${ctrl.category} criteria`,
            ]
          : [];

    const llmAssessment =
      llmResult?.llm_assessment ||
      (gapStatus === "compliant"
        ? `Control ${ctrl.id} shows strong evidence with ${coveragePct}% compliance rate.`
        : gapStatus === "not_assessed"
          ? `No evidence artifacts found for ${ctrl.id}. Manual assessment required.`
          : `Control ${ctrl.id} has ${coveragePct}% compliance coverage — remediation required.`);

    return {
      control_id: ctrl.id as ControlId,
      title: ctrl.title,
      category: ctrl.category,
      gap_status: gapStatus,
      evidence_count: ev.total,
      compliant_count: ev.compliant,
      non_compliant_count: ev.total - ev.compliant,
      coverage_pct: coveragePct,
      remediation_priority: remediationPriority,
      remediation_items: remediationItems,
      llm_assessment: llmAssessment,
    };
  });
}

function computeReadinessScore(results: ControlGapResult[]): number {
  if (results.length === 0) return 0;

  const weights: Record<GapStatus, number> = {
    compliant: 1.0,
    partial: 0.5,
    gap: 0.0,
    not_assessed: 0.1,
  };

  const totalWeight = results.reduce((sum, r) => sum + weights[r.gap_status], 0);
  return Math.round((totalWeight / results.length) * 100);
}

function buildRemediationPlan(results: ControlGapResult[]): RemediationItem[] {
  const items: RemediationItem[] = [];

  for (const result of results) {
    if (result.gap_status === "compliant") continue;

    const effortDays =
      result.remediation_priority === "critical"
        ? 14
        : result.remediation_priority === "high"
          ? 30
          : result.remediation_priority === "medium"
            ? 60
            : 90;

    for (const step of result.remediation_items) {
      if (!step) continue;
      items.push({
        control_id: result.control_id,
        priority: result.remediation_priority === "none" ? "low" : result.remediation_priority,
        title: `${result.control_id}: ${step.slice(0, 80)}`,
        description: step,
        estimated_effort_days: effortDays,
      });
    }
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  items.sort((a, b) => (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4));

  return items;
}

export async function handleRunControlGapAnalysis(
  ctx: HandlerContext,
  args: Args,
): Promise<HandlerResult> {
  const orgId = typeof args.org_id === "string" ? args.org_id.trim() : "";
  if (!orgId) return { status: 400, body: "org_id is required" };

  const auditProjectId =
    typeof args.audit_project_id === "string" && args.audit_project_id.trim()
      ? args.audit_project_id.trim()
      : null;

  // Fetch evidence artifacts for all controls
  let artifactRows: Array<Record<string, unknown>>;
  try {
    artifactRows = await ctx.db.query(
      `SELECT control_id, rule_name, compliance_type, collected_at
       FROM soc2_evidence_artifacts
       WHERE org_id = $1::uuid
       ORDER BY collected_at DESC
       LIMIT 2000`,
      orgId,
    );
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    return { status: 500, body: `Failed to fetch evidence artifacts: ${msg}` };
  }

  const artifacts: EvidenceArtifact[] = artifactRows.map((row) => ({
    control_id: String(row.control_id ?? ""),
    rule_name: String(row.rule_name ?? ""),
    compliance_type: String(row.compliance_type ?? ""),
    collected_at: String(row.collected_at ?? ""),
  }));

  // Aggregate evidence by control
  const artifactsByControl: Record<string, { compliant: number; total: number; names: string[] }> =
    {};
  for (const art of artifacts) {
    const entry = artifactsByControl[art.control_id] ?? { compliant: 0, total: 0, names: [] };
    entry.total += 1;
    if (art.compliance_type === "COMPLIANT") entry.compliant += 1;
    if (entry.names.length < 5) entry.names.push(art.rule_name);
    artifactsByControl[art.control_id] = entry;
  }

  // Call LLM for per-control assessment
  const messages: LlmMessage[] = [
    { role: "system", content: buildGapAnalysisSystemPrompt() },
    {
      role: "user",
      content: buildGapAnalysisUserPrompt(orgId, artifactsByControl, SOC2_CONTROLS),
    },
  ];

  let llmContent: string;
  try {
    llmContent = await callLlmGateway(messages, 0.1);
  } catch (llmErr) {
    const msg = llmErr instanceof Error ? llmErr.message : String(llmErr);
    return { status: 502, body: `LLM gateway call failed: ${msg}` };
  }

  const controlResults = parseGapResults(llmContent, artifactsByControl, SOC2_CONTROLS);
  const readinessScore = computeReadinessScore(controlResults);
  const remediationPlan = buildRemediationPlan(controlResults);

  const compliantCount = controlResults.filter((r) => r.gap_status === "compliant").length;
  const partialCount = controlResults.filter((r) => r.gap_status === "partial").length;
  const gapCount = controlResults.filter((r) => r.gap_status === "gap").length;
  const notAssessedCount = controlResults.filter((r) => r.gap_status === "not_assessed").length;
  const criticalCount = controlResults.filter((r) => r.remediation_priority === "critical").length;

  const reportId = randomUUID();
  const analysisRunAt = new Date().toISOString();

  // Persist gap report
  try {
    await ctx.db.execute(
      `INSERT INTO soc2_gap_reports
         (id, org_id, audit_project_id, readiness_score, control_results,
          remediation_plan, compliant_count, partial_count, gap_count,
          not_assessed_count, critical_remediation_count, total_evidence_count,
          status, analysis_run_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6::jsonb,
               $7, $8, $9, $10, $11, $12,
               'active', $13::timestamptz, NOW())`,
      reportId,
      orgId,
      auditProjectId,
      readinessScore,
      JSON.stringify(controlResults),
      JSON.stringify(remediationPlan),
      compliantCount,
      partialCount,
      gapCount,
      notAssessedCount,
      criticalCount,
      artifacts.length,
      analysisRunAt,
    );
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    return { status: 500, body: `Failed to persist gap report: ${msg}` };
  }

  // Supersede prior active reports for the same audit project
  if (auditProjectId) {
    try {
      await ctx.db.execute(
        `UPDATE soc2_gap_reports
         SET status = 'superseded'
         WHERE org_id = $1::uuid
           AND audit_project_id = $2::uuid
           AND id <> $3::uuid
           AND status = 'active'`,
        orgId,
        auditProjectId,
        reportId,
      );
    } catch {
      // Non-critical — supersede is best-effort
    }
  }

  await ctx.events.publish("soc2.gap_analysis_completed", {
    org_id: orgId,
    report_id: reportId,
    audit_project_id: auditProjectId,
    readiness_score: readinessScore,
    compliant_count: compliantCount,
    partial_count: partialCount,
    gap_count: gapCount,
    not_assessed_count: notAssessedCount,
    critical_remediation_count: criticalCount,
    total_evidence_count: artifacts.length,
  });

  const topPriorityItems = remediationPlan.slice(0, 5).map((item) => ({
    control_id: item.control_id,
    priority: item.priority,
    title: item.title,
    estimated_effort_days: item.estimated_effort_days,
  }));

  return {
    status: 200,
    body: {
      report_id: reportId,
      readiness_score: readinessScore,
      analysis_run_at: analysisRunAt,
      summary: {
        total_controls: controlResults.length,
        compliant: compliantCount,
        partial: partialCount,
        gap: gapCount,
        not_assessed: notAssessedCount,
        critical_remediation_items: criticalCount,
        total_evidence_artifacts: artifacts.length,
      },
      top_priority_remediation_items: topPriorityItems,
      executive_summary:
        `SOC 2 readiness score: ${readinessScore}/100. ` +
        `${compliantCount} of ${controlResults.length} controls compliant, ` +
        `${gapCount} gaps and ${partialCount} partial controls identified. ` +
        `${criticalCount} critical remediation items require immediate attention. ` +
        `Full gap report saved as report_id ${reportId}.`,
    },
  };
}
