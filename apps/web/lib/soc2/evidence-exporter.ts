import { createHash, randomBytes, randomUUID } from "node:crypto";
import { buildDb } from "@/lib/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PreflightItem {
  label: string;
  passed: boolean;
  count: number;
  required: number;
  blocking: boolean;
  detail: string;
}

export interface PreflightStatus {
  canExport: boolean;
  items: PreflightItem[];
  readinessScore: number;
}

export interface EvidenceExport {
  id: string;
  createdAt: Date;
  readinessScore: number;
  fileSizeBytes: number;
  fileUrl: string;
  checksum: string;
  shareToken: string;
  shareExpiresAt: Date;
  status: "pending" | "complete" | "failed";
  policyCount: number;
  evidenceCount: number;
}

export interface PolicyItem {
  id: string;
  title: string;
  category: string;
  version: string;
  status: string;
  approvedAt: string | null;
  fileUrl: string | null;
}

export interface EvidenceArtifact {
  id: string;
  title: string;
  controlId: string;
  controlName: string;
  category: string;
  evidenceType: string;
  status: string;
  verifiedAt: string | null;
  fileUrl: string | null;
}

export interface EvidenceExportDetail extends EvidenceExport {
  companyName: string;
  policies: PolicyItem[];
  evidenceArtifacts: EvidenceArtifact[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function getPreflightStatus(orgId: string): Promise<PreflightStatus> {
  const db = buildDb();

  const [policyRows, evidenceRows, lowConfRows] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'approved') AS approved_count,
         COUNT(*) AS total_count
       FROM soc2_policies
       WHERE org_id = $1 AND archived_at IS NULL`,
      orgId
    ),
    db.query<Record<string, unknown>>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'verified') AS verified_count,
         COUNT(*) AS total_count
       FROM soc2_evidence_items
       WHERE org_id = $1`,
      orgId
    ),
    db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS unreviewed_count
       FROM soc2_policies
       WHERE org_id = $1 AND low_confidence = true AND reviewed_at IS NULL AND archived_at IS NULL`,
      orgId
    ),
  ]);

  const approvedCount = Number(policyRows[0]?.approved_count ?? 0);
  const totalPolicies = Number(policyRows[0]?.total_count ?? 0);
  const verifiedCount = Number(evidenceRows[0]?.verified_count ?? 0);
  const totalEvidence = Number(evidenceRows[0]?.total_count ?? 0);
  const unreviewedLowConf = Number(lowConfRows[0]?.unreviewed_count ?? 0);

  const items: PreflightItem[] = [
    {
      label: "Policies approved",
      passed: totalPolicies > 0 && approvedCount === totalPolicies,
      count: approvedCount,
      required: totalPolicies,
      blocking: true,
      detail:
        totalPolicies === 0
          ? "No policies found — add and approve policies before exporting."
          : `${approvedCount} of ${totalPolicies} policies approved.`,
    },
    {
      label: "Evidence artifacts verified",
      passed: totalEvidence > 0 && verifiedCount === totalEvidence,
      count: verifiedCount,
      required: totalEvidence,
      blocking: true,
      detail:
        totalEvidence === 0
          ? "No evidence artifacts found — add and verify evidence before exporting."
          : `${verifiedCount} of ${totalEvidence} artifacts verified.`,
    },
    {
      label: "Low-confidence sections reviewed",
      passed: unreviewedLowConf === 0,
      count: totalPolicies - unreviewedLowConf,
      required: totalPolicies,
      blocking: false,
      detail:
        unreviewedLowConf === 0
          ? "All AI-generated sections have been reviewed."
          : `${unreviewedLowConf} AI-generated section(s) still need human review.`,
    },
  ];

  const blockingFail = items.some((item) => item.blocking && !item.passed);

  const readinessScore = Math.round(
    (approvedCount / Math.max(totalPolicies, 1)) * 40 +
      (verifiedCount / Math.max(totalEvidence, 1)) * 40 +
      (unreviewedLowConf === 0 ? 20 : 0)
  );

  return { canExport: !blockingFail, items, readinessScore };
}

export async function getEvidenceExports(orgId: string): Promise<EvidenceExport[]> {
  const db = buildDb();

  const rows = await db.query<Record<string, unknown>>(
    `SELECT
       id, created_at, readiness_score, file_size_bytes, file_url,
       checksum, share_token, share_expires_at, status,
       policy_count, evidence_count
     FROM soc2_evidence_exports
     WHERE org_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    orgId
  );

  return rows.map((r) => ({
    id: r.id as string,
    createdAt: new Date(r.created_at as string),
    readinessScore: Number(r.readiness_score),
    fileSizeBytes: Number(r.file_size_bytes),
    fileUrl: r.file_url as string,
    checksum: r.checksum as string,
    shareToken: r.share_token as string,
    shareExpiresAt: new Date(r.share_expires_at as string),
    status: r.status as EvidenceExport["status"],
    policyCount: Number(r.policy_count),
    evidenceCount: Number(r.evidence_count),
  }));
}

export async function createEvidenceExport(
  userId: string,
  orgId: string
): Promise<{ export: EvidenceExport; warnings: string[] }> {
  const db = buildDb();
  const warnings: string[] = [];

  const preflight = await getPreflightStatus(orgId);
  if (!preflight.canExport) {
    throw new Error(
      "Pre-flight checks failed: resolve all blocking items before exporting."
    );
  }

  for (const item of preflight.items) {
    if (!item.passed && !item.blocking) {
      warnings.push(item.detail);
    }
  }

  const [policyRows, evidenceRows, orgRows] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT id, title, category, version, status,
              to_char(approved_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS approved_at,
              file_url
       FROM soc2_policies
       WHERE org_id = $1 AND status = 'approved' AND archived_at IS NULL
       ORDER BY category, title`,
      orgId
    ),
    db.query<Record<string, unknown>>(
      `SELECT
         ei.id, ei.title, ei.control_id, ei.category, ei.evidence_type,
         ei.status,
         to_char(ei.verified_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS verified_at,
         ei.file_url,
         COALESCE(sc.name, ei.control_id) AS control_name
       FROM soc2_evidence_items ei
       LEFT JOIN soc2_controls sc ON sc.id = ei.control_id AND sc.org_id = $1
       WHERE ei.org_id = $1 AND ei.status = 'verified'
       ORDER BY ei.control_id, ei.title`,
      orgId
    ),
    db.query<Record<string, unknown>>(
      `SELECT name FROM organizations WHERE id = $1`,
      orgId
    ),
  ]);

  const companyName = (orgRows[0]?.name as string | undefined) ?? "Your Organization";

  const policies: PolicyItem[] = policyRows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    category: r.category as string,
    version: r.version as string,
    status: r.status as string,
    approvedAt: (r.approved_at as string | null) ?? null,
    fileUrl: (r.file_url as string | null) ?? null,
  }));

  const evidenceArtifacts: EvidenceArtifact[] = evidenceRows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    controlId: r.control_id as string,
    controlName: r.control_name as string,
    category: r.category as string,
    evidenceType: r.evidence_type as string,
    status: r.status as string,
    verifiedAt: (r.verified_at as string | null) ?? null,
    fileUrl: (r.file_url as string | null) ?? null,
  }));

  const manifest = {
    exportedAt: new Date().toISOString(),
    companyName,
    readinessScore: preflight.readinessScore,
    policies,
    evidenceArtifacts,
  };

  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestBuffer = Buffer.from(manifestJson, "utf-8");
  const checksum = createHash("sha256").update(manifestBuffer).digest("hex");
  const fileSizeBytes = manifestBuffer.byteLength;

  const shareToken = randomBytes(32).toString("hex");
  const shareExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const exportId = randomUUID();
  const fileUrl = `/evidence-room/share/${shareToken}`;

  await db.execute(
    `INSERT INTO soc2_evidence_exports (
       id, org_id, created_by, status, readiness_score,
       file_url, file_size_bytes, checksum,
       share_token, share_expires_at,
       manifest_json, policy_count, evidence_count,
       created_at
     ) VALUES ($1,$2,$3,'complete',$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
    exportId,
    orgId,
    userId,
    preflight.readinessScore,
    fileUrl,
    fileSizeBytes,
    checksum,
    shareToken,
    shareExpiresAt.toISOString(),
    manifestJson,
    policies.length,
    evidenceArtifacts.length
  );

  return {
    export: {
      id: exportId,
      createdAt: new Date(),
      readinessScore: preflight.readinessScore,
      fileSizeBytes,
      fileUrl,
      checksum,
      shareToken,
      shareExpiresAt,
      status: "complete",
      policyCount: policies.length,
      evidenceCount: evidenceArtifacts.length,
    },
    warnings,
  };
}

export async function getExportByToken(token: string): Promise<EvidenceExportDetail | null> {
  const db = buildDb();

  const rows = await db.query<Record<string, unknown>>(
    `SELECT
       id, created_at, readiness_score, file_size_bytes, file_url,
       checksum, share_token, share_expires_at, status,
       policy_count, evidence_count, manifest_json
     FROM soc2_evidence_exports
     WHERE share_token = $1
       AND share_expires_at > NOW()
       AND status = 'complete'`,
    token
  );

  if (rows.length === 0) return null;

  const r = rows[0];
  const manifest = JSON.parse(r.manifest_json as string) as {
    companyName: string;
    policies: PolicyItem[];
    evidenceArtifacts: EvidenceArtifact[];
  };

  return {
    id: r.id as string,
    createdAt: new Date(r.created_at as string),
    readinessScore: Number(r.readiness_score),
    fileSizeBytes: Number(r.file_size_bytes),
    fileUrl: r.file_url as string,
    checksum: r.checksum as string,
    shareToken: r.share_token as string,
    shareExpiresAt: new Date(r.share_expires_at as string),
    status: r.status as EvidenceExport["status"],
    policyCount: Number(r.policy_count),
    evidenceCount: Number(r.evidence_count),
    companyName: manifest.companyName,
    policies: manifest.policies,
    evidenceArtifacts: manifest.evidenceArtifacts,
  };
}
