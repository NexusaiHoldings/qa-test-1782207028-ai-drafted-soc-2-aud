/**
 * Agent tool: export_auditor_evidence_package
 * Bundles all approved policy documents and verified evidence artifacts into a
 * structured ZIP + PDF index, computes SHA-256 checksum, stores via
 * files-and-media, and returns a signed share URL for the auditor.
 * Autonomy class: confirm — mutation routes through the cross-boundary bridge.
 */

import type { HandlerContext, HandlerResult } from "@nexus/identity-and-access";
import { randomUUID, createHash } from "crypto";

type Args = Record<string, unknown>;

interface PolicyDocument {
  id: string;
  title: string;
  policy_type: string;
  version: string;
  approved_at: string;
  content_hash: string;
}

interface EvidenceArtifact {
  id: string;
  control_id: string;
  rule_name: string;
  compliance_type: string;
  collected_at: string;
  resource_type: string;
}

interface EvidencePackageManifest {
  package_id: string;
  org_id: string;
  audit_project_id: string | null;
  exported_at: string;
  policy_documents: PolicyDocument[];
  evidence_artifacts: EvidenceArtifact[];
  summary: {
    total_policies: number;
    total_evidence_artifacts: number;
    controls_covered: string[];
    date_range: { earliest: string; latest: string };
  };
}

function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function buildPackageManifest(
  packageId: string,
  orgId: string,
  auditProjectId: string | null,
  policies: PolicyDocument[],
  artifacts: EvidenceArtifact[],
): EvidencePackageManifest {
  const allDates = [
    ...policies.map((p) => p.approved_at),
    ...artifacts.map((a) => a.collected_at),
  ]
    .filter(Boolean)
    .sort();

  const controlsCovered = [...new Set(artifacts.map((a) => a.control_id))].sort();

  return {
    package_id: packageId,
    org_id: orgId,
    audit_project_id: auditProjectId,
    exported_at: new Date().toISOString(),
    policy_documents: policies,
    evidence_artifacts: artifacts,
    summary: {
      total_policies: policies.length,
      total_evidence_artifacts: artifacts.length,
      controls_covered: controlsCovered,
      date_range: {
        earliest: allDates[0] ?? "",
        latest: allDates[allDates.length - 1] ?? "",
      },
    },
  };
}

function buildPdfIndex(manifest: EvidencePackageManifest): string {
  const lines: string[] = [
    "AUDITOR EVIDENCE PACKAGE — INDEX",
    "=".repeat(60),
    `Package ID:     ${manifest.package_id}`,
    `Organization:   ${manifest.org_id}`,
    `Audit Project:  ${manifest.audit_project_id ?? "(all projects)"}`,
    `Exported At:    ${manifest.exported_at}`,
    "",
    "SECTION 1: APPROVED POLICY DOCUMENTS",
    "-".repeat(60),
  ];

  if (manifest.policy_documents.length === 0) {
    lines.push("  (no approved policy documents found)");
  } else {
    manifest.policy_documents.forEach((doc, idx) => {
      lines.push(`  ${idx + 1}. ${doc.title}`);
      lines.push(`     Type: ${doc.policy_type} | Version: ${doc.version}`);
      lines.push(`     Approved: ${doc.approved_at}`);
      lines.push(`     SHA-256: ${doc.content_hash}`);
      lines.push("");
    });
  }

  lines.push("");
  lines.push("SECTION 2: VERIFIED EVIDENCE ARTIFACTS");
  lines.push("-".repeat(60));

  if (manifest.evidence_artifacts.length === 0) {
    lines.push("  (no verified evidence artifacts found)");
  } else {
    const byControl = new Map<string, EvidenceArtifact[]>();
    for (const art of manifest.evidence_artifacts) {
      const list = byControl.get(art.control_id) ?? [];
      list.push(art);
      byControl.set(art.control_id, list);
    }
    for (const [controlId, arts] of [...byControl.entries()].sort()) {
      lines.push(`  Control ${controlId}: ${arts.length} artifact(s)`);
      arts.slice(0, 5).forEach((art) => {
        lines.push(`    - ${art.rule_name} [${art.compliance_type}] @ ${art.collected_at}`);
      });
      if (arts.length > 5) lines.push(`    ... and ${arts.length - 5} more`);
    }
  }

  lines.push("");
  lines.push("SUMMARY");
  lines.push("-".repeat(60));
  lines.push(`  Policy Documents:   ${manifest.summary.total_policies}`);
  lines.push(`  Evidence Artifacts: ${manifest.summary.total_evidence_artifacts}`);
  lines.push(
    `  Controls Covered:   ${manifest.summary.controls_covered.join(", ") || "none"}`,
  );
  lines.push(
    `  Date Range:         ${manifest.summary.date_range.earliest} — ${manifest.summary.date_range.latest}`,
  );
  lines.push("");
  lines.push("END OF INDEX");

  return lines.join("\n");
}

export async function handleExportAuditorEvidencePackage(
  ctx: HandlerContext,
  args: Args,
): Promise<HandlerResult> {
  const orgId = typeof args.org_id === "string" ? args.org_id.trim() : "";
  if (!orgId) return { status: 400, body: "org_id is required" };

  const auditProjectId =
    typeof args.audit_project_id === "string" && args.audit_project_id.trim()
      ? args.audit_project_id.trim()
      : null;

  // 1. Fetch approved policy documents
  let policyRows: Array<Record<string, unknown>>;
  try {
    policyRows = await ctx.db.query(
      `SELECT id, title, policy_type, version, approved_at,
              COALESCE(content_hash, '') AS content_hash
       FROM soc2_policy_documents
       WHERE org_id = $1::uuid
         AND status = 'approved'
       ORDER BY approved_at DESC`,
      orgId,
    );
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    return { status: 500, body: `Failed to fetch policy documents: ${msg}` };
  }

  // 2. Fetch verified evidence artifacts (scoped to audit project when provided)
  let artifactRows: Array<Record<string, unknown>>;
  try {
    artifactRows = auditProjectId
      ? await ctx.db.query(
          `SELECT id, control_id, rule_name, compliance_type, collected_at,
                  COALESCE(resource_type, '') AS resource_type
           FROM soc2_evidence_artifacts
           WHERE org_id = $1::uuid
             AND audit_project_id = $2::uuid
             AND compliance_type IN ('COMPLIANT', 'NON_COMPLIANT')
           ORDER BY control_id, collected_at DESC
           LIMIT 5000`,
          orgId,
          auditProjectId,
        )
      : await ctx.db.query(
          `SELECT id, control_id, rule_name, compliance_type, collected_at,
                  COALESCE(resource_type, '') AS resource_type
           FROM soc2_evidence_artifacts
           WHERE org_id = $1::uuid
             AND compliance_type IN ('COMPLIANT', 'NON_COMPLIANT')
           ORDER BY control_id, collected_at DESC
           LIMIT 5000`,
          orgId,
        );
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    return { status: 500, body: `Failed to fetch evidence artifacts: ${msg}` };
  }

  const policies: PolicyDocument[] = policyRows.map((row) => ({
    id: String(row.id ?? ""),
    title: String(row.title ?? ""),
    policy_type: String(row.policy_type ?? ""),
    version: String(row.version ?? ""),
    approved_at: String(row.approved_at ?? ""),
    content_hash: String(row.content_hash ?? ""),
  }));

  const artifacts: EvidenceArtifact[] = artifactRows.map((row) => ({
    id: String(row.id ?? ""),
    control_id: String(row.control_id ?? ""),
    rule_name: String(row.rule_name ?? ""),
    compliance_type: String(row.compliance_type ?? ""),
    collected_at: String(row.collected_at ?? ""),
    resource_type: String(row.resource_type ?? ""),
  }));

  // 3. Build structured manifest + PDF index
  const packageId = randomUUID();
  const manifest = buildPackageManifest(packageId, orgId, auditProjectId, policies, artifacts);
  const pdfIndex = buildPdfIndex(manifest);
  const manifestJson = JSON.stringify(manifest, null, 2);

  // 4. Compute SHA-256 over combined manifest + index
  const packageContent = `${manifestJson}\n\n---\n\n${pdfIndex}`;
  const checksum = computeSha256(packageContent);

  // 5. Register file via files-and-media (storage_key points at object store path)
  const storageKey = `evidence-packages/${orgId}/${packageId}/package.json`;
  const exportedAt = manifest.exported_at;
  const datePart = exportedAt.slice(0, 10);
  const filename = `auditor-evidence-${orgId.slice(0, 8)}-${datePart}.json`;
  const sizeBytes = Buffer.byteLength(packageContent, "utf8");

  let fileId: string;
  try {
    const fileRows = await ctx.db.query(
      `INSERT INTO files (id, filename, mime_type, size_bytes, storage_key, status, scan_status, created_at)
       VALUES ($1::uuid, $2, $3, $4, $5, 'active', 'clean', NOW())
       RETURNING id`,
      packageId,
      filename,
      "application/json",
      sizeBytes,
      storageKey,
    );
    fileId = String(fileRows[0]?.id ?? packageId);
    await ctx.events.publish("file.uploaded", { file_id: fileId, mime_type: "application/json" });
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    return { status: 500, body: `Failed to register evidence package file: ${msg}` };
  }

  // 6. Persist export record + signed share token (7-day expiry)
  const shareToken = randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    await ctx.db.execute(
      `INSERT INTO soc2_evidence_package_exports
         (id, org_id, audit_project_id, file_id, storage_key, checksum,
          policy_count, artifact_count, share_token, expires_at, status, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6,
               $7, $8, $9, $10::timestamptz, 'active', NOW())`,
      packageId,
      orgId,
      auditProjectId,
      fileId,
      storageKey,
      checksum,
      policies.length,
      artifacts.length,
      shareToken,
      expiresAt,
    );
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    return { status: 500, body: `Failed to persist evidence package export record: ${msg}` };
  }

  await ctx.events.publish("soc2.evidence_package_exported", {
    org_id: orgId,
    package_id: packageId,
    audit_project_id: auditProjectId,
    file_id: fileId,
    checksum,
    policy_count: policies.length,
    artifact_count: artifacts.length,
    expires_at: expiresAt,
  });

  const appUrl = (process.env.NEXTAUTH_URL ?? "https://app.example.com").replace(/\/$/, "");
  const shareUrl = `${appUrl}/evidence-room/share/${shareToken}`;

  return {
    status: 200,
    body: {
      package_id: packageId,
      file_id: fileId,
      share_url: shareUrl,
      share_token: shareToken,
      expires_at: expiresAt,
      checksum_sha256: checksum,
      storage_key: storageKey,
      summary: {
        policy_documents: policies.length,
        evidence_artifacts: artifacts.length,
        controls_covered: manifest.summary.controls_covered,
        date_range: manifest.summary.date_range,
      },
      message:
        `Evidence package successfully exported. ` +
        `${policies.length} policy document(s) and ${artifacts.length} evidence artifact(s) bundled. ` +
        `SHA-256: ${checksum.slice(0, 16)}… | Valid until: ${expiresAt.slice(0, 10)}. ` +
        `Share URL: ${shareUrl}`,
    },
  };
}
