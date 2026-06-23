import { randomUUID } from "node:crypto";
import type { Db } from "@nexus/identity-and-access/api/_lib/db";

export type GapSeverity = "Critical" | "High" | "Medium" | "Low";
export type ControlStatus = "met" | "partial" | "not_met";

export interface ControlDef {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly effortDays: number;
}

export interface GapStatus {
  control_id: string;
  control_name: string;
  category: string;
  status: ControlStatus;
  evidence_count: number;
  notes: string;
}

export interface PrioritizedGap {
  control_id: string;
  control_name: string;
  severity: GapSeverity;
  estimated_effort: string;
  remediation_steps: string[];
}

export interface GapReport {
  id: string;
  report_date: string;
  overall_readiness_score: number;
  per_control_gap_status: GapStatus[];
  prioritized_gaps: PrioritizedGap[];
  executive_summary: string;
  created_at: string;
}

// 20 SOC 2 Trust Services Criteria control requirements
export const SOC2_CONTROLS: ControlDef[] = [
  { id: "CC1.1", name: "Integrity and Ethical Values", category: "Organization", effortDays: 14 },
  { id: "CC1.2", name: "Board Independence and Oversight", category: "Organization", effortDays: 21 },
  { id: "CC2.1", name: "Internal Information Communication", category: "Communication", effortDays: 7 },
  { id: "CC3.1", name: "Risk Assessment Objectives", category: "Risk Assessment", effortDays: 14 },
  { id: "CC3.2", name: "Risk Identification and Analysis", category: "Risk Assessment", effortDays: 21 },
  { id: "CC4.1", name: "Ongoing Monitoring Activities", category: "Monitoring", effortDays: 10 },
  { id: "CC5.1", name: "Control Selection and Development", category: "Control Activities", effortDays: 14 },
  { id: "CC6.1", name: "Logical Access Management", category: "Access Control", effortDays: 7 },
  { id: "CC6.2", name: "Multi-Factor Authentication", category: "Access Control", effortDays: 3 },
  { id: "CC6.3", name: "Network Security Controls", category: "Access Control", effortDays: 14 },
  { id: "CC7.1", name: "Infrastructure Monitoring", category: "System Operations", effortDays: 7 },
  { id: "CC7.2", name: "Security Incident Management", category: "System Operations", effortDays: 14 },
  { id: "CC8.1", name: "Change Control Process", category: "Change Management", effortDays: 14 },
  { id: "CC9.1", name: "Vendor Risk Management", category: "Risk Mitigation", effortDays: 21 },
  { id: "A1.1", name: "Performance and Capacity Monitoring", category: "Availability", effortDays: 7 },
  { id: "A1.2", name: "Business Continuity and Disaster Recovery", category: "Availability", effortDays: 30 },
  { id: "C1.1", name: "Data Classification and Handling", category: "Confidentiality", effortDays: 14 },
  { id: "PI1.1", name: "Complete and Accurate Processing", category: "Processing Integrity", effortDays: 14 },
  { id: "P1.1", name: "Privacy Notice and Communication", category: "Privacy", effortDays: 7 },
  { id: "P5.1", name: "Data Subject Access and Correction", category: "Privacy", effortDays: 14 },
];

// Controls treated as high-risk — gaps here escalate to Critical/High severity
const HIGH_RISK_CONTROLS = new Set([
  "CC6.1", "CC6.2", "CC6.3", "A1.2", "CC7.2", "CC3.1",
]);

// Per-control weighted readiness score
const CONTROL_WEIGHTS: Record<string, number> = {
  "CC6.1": 2, "CC6.2": 2, "A1.2": 2, "CC7.2": 1.5, "CC3.1": 1.5, "CC6.3": 1.5,
};

export async function ensureTables(db: Db): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS soc2_gap_reports (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       report_date DATE NOT NULL,
       overall_readiness_score INTEGER NOT NULL,
       per_control_gap_status JSONB NOT NULL DEFAULT '[]'::jsonb,
       prioritized_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
       executive_summary TEXT NOT NULL DEFAULT '',
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
  );
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_soc2_gap_reports_date
     ON soc2_gap_reports (report_date DESC)`,
  );
}

export async function getEvidenceByControl(db: Db): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    const rows = await db.query<{ control_id: string; cnt: string }>(
      `SELECT control_id, COUNT(*)::text AS cnt
       FROM soc2_evidence_artifacts
       WHERE status = 'active'
       GROUP BY control_id`,
    );
    for (const row of rows) {
      counts.set(row.control_id, parseInt(row.cnt, 10));
    }
  } catch {
    // Table may not exist yet — return empty map (all controls = zero evidence).
  }
  return counts;
}

export function assessControls(evidenceCounts: Map<string, number>): GapStatus[] {
  return SOC2_CONTROLS.map((control): GapStatus => {
    const count = evidenceCounts.get(control.id) ?? 0;
    const status: ControlStatus =
      count >= 3 ? "met" : count >= 1 ? "partial" : "not_met";
    const notes =
      status === "met"
        ? `${count} evidence artifact(s) linked — control satisfied.`
        : status === "partial"
          ? `Only ${count} evidence artifact(s) — additional documentation needed.`
          : "No evidence artifacts linked — immediate attention required.";
    return {
      control_id: control.id,
      control_name: control.name,
      category: control.category,
      status,
      evidence_count: count,
      notes,
    };
  });
}

function getRemediationSteps(controlId: string, status: ControlStatus): string[] {
  const steps: Record<string, string[]> = {
    "CC6.1": [
      "Audit all user accounts and remove orphaned access",
      "Implement automated quarterly access reviews",
      "Document access control policy and approval workflow",
    ],
    "CC6.2": [
      "Enable MFA for all privileged/admin accounts immediately",
      "Roll out MFA enforcement org-wide with user comms",
      "Document MFA policy and exemption process",
    ],
    "CC6.3": [
      "Map current network architecture and identify segments",
      "Implement VPC firewall rules and security groups",
      "Document network segmentation policy",
    ],
    "CC7.1": [
      "Configure infrastructure monitoring and alerting tools",
      "Define alerting thresholds and escalation paths",
      "Establish an on-call rotation and runbook library",
    ],
    "CC7.2": [
      "Draft and publish incident response runbook",
      "Define incident severity levels and SLAs",
      "Schedule tabletop exercise within 30 days",
    ],
    "CC3.1": [
      "Conduct risk assessment workshop with stakeholders",
      "Document threat landscape and risk register",
      "Map identified risks to SOC 2 controls",
    ],
    "A1.2": [
      "Document RTO/RPO objectives by system tier",
      "Test disaster recovery procedures quarterly",
      "Implement automated backups with verified restores",
    ],
  };
  const base = steps[controlId] ?? [
    `Gather evidence artifacts for ${controlId}`,
    "Review current implementation against SOC 2 requirements",
    "Document compliance status and assign an owner",
  ];
  if (status === "partial") {
    return [
      `Complete additional evidence documentation for ${controlId}`,
      ...base.slice(1),
    ];
  }
  return base;
}

export function buildPrioritizedGaps(statuses: GapStatus[]): PrioritizedGap[] {
  const ORDER: Record<GapSeverity, number> = {
    Critical: 0, High: 1, Medium: 2, Low: 3,
  };
  const gaps: PrioritizedGap[] = statuses
    .filter((s) => s.status !== "met")
    .map((s): PrioritizedGap => {
      const control = SOC2_CONTROLS.find((c) => c.id === s.control_id)!;
      let severity: GapSeverity;
      if (HIGH_RISK_CONTROLS.has(s.control_id) && s.status === "not_met") {
        severity = "Critical";
      } else if (HIGH_RISK_CONTROLS.has(s.control_id) || s.status === "not_met") {
        severity = "High";
      } else {
        severity = "Medium";
      }
      const days = control.effortDays;
      const effort =
        days <= 3 ? `${days}d`
        : days <= 7 ? "1w"
        : days <= 14 ? "2w"
        : days <= 21 ? "3w"
        : "1m+";
      return {
        control_id: s.control_id,
        control_name: s.control_name,
        severity,
        estimated_effort: effort,
        remediation_steps: getRemediationSteps(s.control_id, s.status),
      };
    });
  gaps.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return gaps;
}

export function calculateReadinessScore(statuses: GapStatus[]): number {
  if (statuses.length === 0) return 0;
  const WEIGHTS: Record<ControlStatus, number> = { met: 1.0, partial: 0.5, not_met: 0.0 };
  let weightedSum = 0;
  let totalWeight = 0;
  for (const s of statuses) {
    const w = CONTROL_WEIGHTS[s.control_id] ?? 1;
    weightedSum += WEIGHTS[s.status] * w;
    totalWeight += w;
  }
  return Math.round((weightedSum / totalWeight) * 100);
}

function buildFallbackSummary(
  score: number,
  critical: PrioritizedGap[],
  high: PrioritizedGap[],
  metCount: number,
  total: number,
): string {
  const tier =
    score >= 80 ? "strong" : score >= 60 ? "moderate" : score >= 40 ? "developing" : "early-stage";
  const critNames = critical.slice(0, 3).map((g) => g.control_name).join(", ");
  const highNames = high.slice(0, 3).map((g) => g.control_name).join(", ");
  const topGap = critical[0]?.control_name ?? high[0]?.control_name ?? "maintaining evidence coverage";
  const p1 = `Current SOC 2 readiness stands at ${score}%, reflecting a ${tier} compliance posture with ${metCount} of ${total} controls fully evidenced.`;
  const p2 =
    critical.length > 0
      ? `Immediate attention is required for ${critical.length} critical gap(s): ${critNames}. ${high.length > 0 ? `Additionally, ${high.length} high-priority gap(s) — ${highNames} — require prompt remediation.` : ""}`
      : high.length > 0
        ? `No critical gaps this week. ${high.length} high-priority gap(s) require prompt attention: ${highNames}.`
        : "No critical or high-priority gaps identified — all significant controls are evidenced.";
  const p3 = `This week's recommended focus: ${topGap}. Review all evidence artifacts, assign owners to each open gap, and target at least ${Math.min(3, critical.length + high.length)} gap closures before next Monday's analysis.`;
  return `${p1}\n\n${p2}\n\n${p3}`;
}

export async function generateExecutiveSummary(
  readinessScore: number,
  prioritizedGaps: PrioritizedGap[],
  perControlStatus: GapStatus[],
): Promise<string> {
  const critical = prioritizedGaps.filter((g) => g.severity === "Critical");
  const high = prioritizedGaps.filter((g) => g.severity === "High");
  const metCount = perControlStatus.filter((s) => s.status === "met").length;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildFallbackSummary(readinessScore, critical, high, metCount, perControlStatus.length);
  }
  const prompt =
    `You are a SOC 2 compliance advisor. Write a concise 3-paragraph executive summary (max 200 words) for this weekly gap analysis:\n\n` +
    `Overall readiness: ${readinessScore}%\n` +
    `Controls met: ${metCount}/${perControlStatus.length}\n` +
    `Critical gaps: ${critical.map((g) => g.control_name).join(", ") || "None"}\n` +
    `High-priority gaps: ${high.map((g) => g.control_name).join(", ") || "None"}\n\n` +
    `Para 1: Current compliance posture and readiness score. Para 2: Critical/high gaps needing immediate action. Para 3: Recommended next steps this week. Be direct, specific, action-oriented.`;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 400,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      console.error(`[gap-analysis] AI summary HTTP ${resp.status}`);
      return buildFallbackSummary(readinessScore, critical, high, metCount, perControlStatus.length);
    }
    type OaiResponse = { choices?: Array<{ message?: { content?: string } }> };
    const data = (await resp.json()) as OaiResponse;
    const text = data.choices?.[0]?.message?.content?.trim();
    return text ?? buildFallbackSummary(readinessScore, critical, high, metCount, perControlStatus.length);
  } catch (err) {
    console.error(`[gap-analysis] AI summary error: ${err}`);
    return buildFallbackSummary(readinessScore, critical, high, metCount, perControlStatus.length);
  }
}

type ReportRow = {
  id: string;
  report_date: string | Date;
  overall_readiness_score: number;
  per_control_gap_status: unknown;
  prioritized_gaps: unknown;
  executive_summary: string;
  created_at: string | Date;
};

function parseJsonb<T>(val: unknown): T {
  if (typeof val === "string") return JSON.parse(val) as T;
  return val as T;
}

function parseReportRow(row: ReportRow): GapReport {
  const reportDate =
    typeof row.report_date === "string"
      ? row.report_date.split("T")[0]
      : (row.report_date as Date).toISOString().split("T")[0];
  const createdAt =
    typeof row.created_at === "string"
      ? row.created_at
      : (row.created_at as Date).toISOString();
  return {
    id: row.id,
    report_date: reportDate,
    overall_readiness_score: row.overall_readiness_score,
    per_control_gap_status: parseJsonb<GapStatus[]>(row.per_control_gap_status),
    prioritized_gaps: parseJsonb<PrioritizedGap[]>(row.prioritized_gaps),
    executive_summary: row.executive_summary,
    created_at: createdAt,
  };
}

export async function getLatestReport(db: Db): Promise<GapReport | null> {
  const rows = await db.query<ReportRow>(
    `SELECT id, report_date, overall_readiness_score, per_control_gap_status,
     prioritized_gaps, executive_summary, created_at
     FROM soc2_gap_reports
     ORDER BY report_date DESC
     LIMIT 1`,
  );
  if (rows.length === 0) return null;
  return parseReportRow(rows[0]);
}

export async function getReportHistory(db: Db, limit: number): Promise<GapReport[]> {
  const rows = await db.query<ReportRow>(
    `SELECT id, report_date, overall_readiness_score, per_control_gap_status,
     prioritized_gaps, executive_summary, created_at
     FROM soc2_gap_reports
     ORDER BY report_date DESC
     LIMIT $1`,
    limit,
  );
  return rows.map(parseReportRow);
}

export async function saveReport(
  db: Db,
  data: Omit<GapReport, "id" | "created_at">,
): Promise<GapReport> {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO soc2_gap_reports
     (id, report_date, overall_readiness_score, per_control_gap_status, prioritized_gaps, executive_summary)
     VALUES ($1::uuid, $2::date, $3, $4::jsonb, $5::jsonb, $6)`,
    id,
    data.report_date,
    data.overall_readiness_score,
    JSON.stringify(data.per_control_gap_status),
    JSON.stringify(data.prioritized_gaps),
    data.executive_summary,
  );
  return { ...data, id, created_at: new Date().toISOString() };
}

export async function sendSlackNotification(
  report: GapReport,
  previousReport: GapReport | null,
): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("[gap-analysis] SLACK_WEBHOOK_URL not configured — skipping Slack notification");
    return;
  }
  const delta =
    previousReport !== null
      ? report.overall_readiness_score - previousReport.overall_readiness_score
      : null;
  const deltaText =
    delta === null
      ? "First report generated"
      : delta > 0
        ? `+${delta}% vs last week ↑`
        : delta < 0
          ? `${delta}% vs last week ↓`
          : "No change vs last week →";
  const top3 = report.prioritized_gaps.slice(0, 3);
  const gapLines = top3.length > 0
    ? top3.map((g) => `• *${g.severity}* — ${g.control_name} (est. ${g.estimated_effort})`).join("\n")
    : "No open gaps — all controls evidenced.";
  const payload = {
    text: `SOC 2 Weekly Gap Analysis — ${report.report_date} | Score: ${report.overall_readiness_score}% | ${deltaText}`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `SOC 2 Weekly Gap Analysis — ${report.report_date}`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Readiness Score*\n${report.overall_readiness_score}%` },
          { type: "mrkdwn", text: `*Week-over-Week*\n${deltaText}` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Top Priority Gaps*\n${gapLines}`,
        },
      },
    ],
  };
  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      console.error(`[gap-analysis] Slack notification failed HTTP ${resp.status}`);
    }
  } catch (err) {
    console.error(`[gap-analysis] Slack notification error: ${err}`);
  }
}

export async function runGapAnalysis(db: Db): Promise<GapReport> {
  await ensureTables(db);
  const previousReport = await getLatestReport(db);
  const evidenceCounts = await getEvidenceByControl(db);
  const perControlStatus = assessControls(evidenceCounts);
  const readinessScore = calculateReadinessScore(perControlStatus);
  const prioritizedGaps = buildPrioritizedGaps(perControlStatus);
  const executiveSummary = await generateExecutiveSummary(
    readinessScore,
    prioritizedGaps,
    perControlStatus,
  );
  const today = new Date().toISOString().split("T")[0];
  const report = await saveReport(db, {
    report_date: today,
    overall_readiness_score: readinessScore,
    per_control_gap_status: perControlStatus,
    prioritized_gaps: prioritizedGaps,
    executive_summary: executiveSummary,
  });
  await sendSlackNotification(report, previousReport);
  return report;
}
