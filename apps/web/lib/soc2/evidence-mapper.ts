import { buildDb } from "@/lib/db";

export type ArtifactType = "screenshot" | "log_export" | "config_snapshot" | "access_review";

export interface Soc2Control {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly evidenceCount: number;
}

export interface EvidenceArtifact {
  readonly id: string;
  readonly controlId: string;
  readonly artifactType: ArtifactType;
  readonly sourceConnector: string;
  readonly rawData: Record<string, unknown>;
  readonly extractedSummary: string;
  readonly collectedAt: Date;
  readonly humanVerified: boolean;
}

interface ControlBase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
}

export const SOC2_CONTROLS_CATALOG: readonly ControlBase[] = [
  { id: "CC1.1", name: "Integrity and Ethical Values", description: "The entity demonstrates a commitment to integrity and ethical values.", category: "Control Environment" },
  { id: "CC1.2", name: "Board Oversight", description: "The board of directors demonstrates independence and exercises oversight of internal controls.", category: "Control Environment" },
  { id: "CC2.1", name: "Information Quality", description: "The entity obtains or generates and uses relevant, quality information to support internal control.", category: "Communication" },
  { id: "CC3.1", name: "Risk Assessment Objectives", description: "The entity specifies objectives with sufficient clarity to enable identification and assessment of risks.", category: "Risk Assessment" },
  { id: "CC3.2", name: "Risk Identification", description: "The entity identifies risks to the achievement of its objectives across the entity.", category: "Risk Assessment" },
  { id: "CC4.1", name: "Ongoing Evaluations", description: "The entity selects, develops, and performs ongoing evaluations to ascertain whether components of internal control are present and functioning.", category: "Monitoring" },
  { id: "CC5.1", name: "Control Policies", description: "The entity selects and develops control activities that contribute to the mitigation of risks to the achievement of objectives.", category: "Control Activities" },
  { id: "CC6.1", name: "Logical Access Controls", description: "The entity implements logical access security software, infrastructure, and architectures to protect against unauthorized access.", category: "Logical and Physical Access" },
  { id: "CC6.2", name: "Credential Provisioning", description: "Prior to issuing system credentials and granting system access, the entity registers and authorizes new internal and external users.", category: "Logical and Physical Access" },
  { id: "CC6.3", name: "Role-Based Access Control", description: "The entity authorizes, modifies, or removes access to data and protected information assets based on approved roles.", category: "Logical and Physical Access" },
  { id: "CC6.6", name: "Network Protection", description: "The entity implements logical access security measures to protect against threats from sources outside its system boundaries.", category: "Logical and Physical Access" },
  { id: "CC6.7", name: "Data Transmission Protection", description: "The entity restricts the transmission, movement, and removal of information to authorized internal and external users.", category: "Logical and Physical Access" },
  { id: "CC6.8", name: "Malware Prevention", description: "The entity implements controls to prevent or detect and act upon the introduction of unauthorized or malicious software.", category: "Logical and Physical Access" },
  { id: "CC7.1", name: "System Monitoring", description: "The entity uses detection and monitoring procedures to identify changes to configurations or information assets.", category: "System Operations" },
  { id: "CC7.2", name: "Security Event Monitoring", description: "The entity monitors system components and the operation of controls to identify deviations from expected performance.", category: "System Operations" },
  { id: "CC7.3", name: "Incident Evaluation", description: "The entity evaluates security events to determine whether they could or have resulted in a failure to meet its objectives.", category: "System Operations" },
  { id: "CC7.4", name: "Incident Response", description: "The entity responds to identified security incidents by executing a defined incident response program.", category: "System Operations" },
  { id: "CC7.5", name: "Incident Disclosure", description: "The entity identifies, develops, and implements activities to recover from identified security incidents.", category: "System Operations" },
  { id: "CC8.1", name: "Change Management", description: "The entity authorizes, designs, develops, configures, tests, approves, and implements changes to infrastructure and software.", category: "Change Management" },
  { id: "A1.1", name: "Availability Capacity", description: "The entity maintains, monitors, and evaluates current processing capacity to manage capacity demand and ensure availability objectives are met.", category: "Availability" },
];

async function ensureTablesExist(): Promise<void> {
  const db = buildDb();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS soc2_evidence_artifacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      control_id VARCHAR(20) NOT NULL,
      artifact_type VARCHAR(50) NOT NULL,
      source_connector VARCHAR(100) NOT NULL,
      raw_data JSONB NOT NULL DEFAULT '{}',
      extracted_summary TEXT NOT NULL DEFAULT '',
      collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      human_verified BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);
  await db.execute(
    `CREATE INDEX IF NOT EXISTS soc2_artifacts_control_idx ON soc2_evidence_artifacts (control_id)`
  );
}

export async function getControlsWithEvidenceCounts(): Promise<Soc2Control[]> {
  await ensureTablesExist();
  const db = buildDb();
  const rows = await db.query<{ control_id: string; cnt: string }>(
    `SELECT control_id, COUNT(*) AS cnt FROM soc2_evidence_artifacts GROUP BY control_id`
  );
  const countMap = new Map<string, number>();
  for (const row of rows) {
    countMap.set(row.control_id, parseInt(row.cnt, 10));
  }
  return SOC2_CONTROLS_CATALOG.map((ctrl) => ({
    ...ctrl,
    evidenceCount: countMap.get(ctrl.id) ?? 0,
  }));
}

export async function getArtifactsForControl(controlId: string): Promise<EvidenceArtifact[]> {
  await ensureTablesExist();
  const db = buildDb();
  const rows = await db.query<{
    id: string;
    control_id: string;
    artifact_type: string;
    source_connector: string;
    raw_data: Record<string, unknown>;
    extracted_summary: string;
    collected_at: string;
    human_verified: boolean;
  }>(
    `SELECT id, control_id, artifact_type, source_connector, raw_data,
            extracted_summary, collected_at, human_verified
     FROM soc2_evidence_artifacts
     WHERE control_id = $1
     ORDER BY collected_at DESC`,
    controlId
  );
  return rows.map((row) => ({
    id: row.id,
    controlId: row.control_id,
    artifactType: row.artifact_type as ArtifactType,
    sourceConnector: row.source_connector,
    rawData: (row.raw_data ?? {}) as Record<string, unknown>,
    extractedSummary: row.extracted_summary,
    collectedAt: new Date(row.collected_at),
    humanVerified: row.human_verified,
  }));
}

export async function verifyArtifact(artifactId: string): Promise<void> {
  const db = buildDb();
  await db.execute(
    `UPDATE soc2_evidence_artifacts SET human_verified = TRUE WHERE id = $1`,
    artifactId
  );
}

export async function insertArtifact(
  artifact: Omit<EvidenceArtifact, "id" | "collectedAt">
): Promise<EvidenceArtifact> {
  await ensureTablesExist();
  const db = buildDb();
  const rows = await db.query<{
    id: string;
    control_id: string;
    artifact_type: string;
    source_connector: string;
    raw_data: Record<string, unknown>;
    extracted_summary: string;
    collected_at: string;
    human_verified: boolean;
  }>(
    `INSERT INTO soc2_evidence_artifacts
       (control_id, artifact_type, source_connector, raw_data, extracted_summary, human_verified)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     RETURNING *`,
    artifact.controlId,
    artifact.artifactType,
    artifact.sourceConnector,
    JSON.stringify(artifact.rawData),
    artifact.extractedSummary,
    artifact.humanVerified
  );
  const row = rows[0];
  if (!row) {
    throw new Error(`Failed to insert artifact for control ${artifact.controlId}`);
  }
  return {
    id: row.id,
    controlId: row.control_id,
    artifactType: row.artifact_type as ArtifactType,
    sourceConnector: row.source_connector,
    rawData: (row.raw_data ?? {}) as Record<string, unknown>,
    extractedSummary: row.extracted_summary,
    collectedAt: new Date(row.collected_at),
    humanVerified: row.human_verified,
  };
}
