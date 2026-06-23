import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { substituteVariables, getCompanyVariables, DEFAULT_COMPANY_VARIABLES } from './policy-variables';
import type { CompanyVariables } from './policy-variables';

export type PolicyType =
  | 'information-security'
  | 'access-control'
  | 'change-management'
  | 'incident-response'
  | 'risk-assessment';

export type PolicyStatus = 'draft' | 'under_review' | 'approved' | 'exported';
export type GeneratedBy = 'ai' | 'human_edit';

export interface PolicySection {
  id: string;
  title: string;
  content: string;
  confidence_score: number;
  reviewed: boolean;
  order_index: number;
}

export interface PolicyVersion {
  id: string;
  version: number;
  generated_at: string;
  generated_by: GeneratedBy;
  sections: PolicySection[];
  changelog: string;
}

export interface PolicyDocument {
  id: string;
  type: PolicyType;
  title: string;
  status: PolicyStatus;
  current_version: PolicyVersion;
  versions: PolicyVersion[];
  created_at: string;
  updated_at: string;
}

export const POLICY_TITLES: Record<PolicyType, string> = {
  'information-security': 'Information Security Policy',
  'access-control': 'Access Control Policy',
  'change-management': 'Change Management Policy',
  'incident-response': 'Incident Response Policy',
  'risk-assessment': 'Risk Assessment Policy',
};

const POLICY_ORDER: PolicyType[] = [
  'information-security',
  'access-control',
  'change-management',
  'incident-response',
  'risk-assessment',
];

type SectionTemplate = { title: string; template: string; confidence_score: number };

const SECTION_TEMPLATES: Record<PolicyType, SectionTemplate[]> = {
  'information-security': [
    {
      title: '1. Purpose and Scope',
      template: `This Information Security Policy establishes the framework for protecting {{COMPANY_NAME}}'s information assets against unauthorized access, disclosure, modification, and destruction. This policy applies to all employees, contractors, and third-party vendors who access {{COMPANY_NAME}}'s systems and data, covering all assets hosted on {{INFRASTRUCTURE_TYPE}} infrastructure across our {{EMPLOYEE_COUNT}}-person organization in the {{INDUSTRY}} industry.`,
      confidence_score: 0.95,
    },
    {
      title: '2. Information Security Objectives',
      template: `{{COMPANY_NAME}} is committed to maintaining the confidentiality, integrity, and availability of all information assets. Security objectives include: (a) protecting customer data classified as {{DATA_CLASSIFICATIONS}} from unauthorized access; (b) ensuring continuous availability of critical business systems; (c) maintaining compliance with applicable laws and regulations; (d) detecting and responding to security incidents within defined timeframes; and (e) fostering a security-aware culture through ongoing training for all {{EMPLOYEE_COUNT}} employees.`,
      confidence_score: 0.88,
    },
    {
      title: '3. Roles and Responsibilities',
      template: `The Chief Information Security Officer (CISO) or designated security lead at {{COMPANY_NAME}} is responsible for overseeing the information security program. System owners are responsible for classifying data assets and implementing appropriate controls. All employees must adhere to this policy. Security incidents must be reported immediately to {{SECURITY_CONTACT_EMAIL}}. Third-party vendors accessing {{COMPANY_NAME}}'s {{INFRASTRUCTURE_TYPE}} environment must demonstrate compliance with equivalent security standards.`,
      confidence_score: 0.92,
    },
    {
      title: '4. Asset Classification',
      template: `{{COMPANY_NAME}} classifies information assets into the following categories: {{DATA_CLASSIFICATIONS}}. Public information requires no special handling controls. Internal information is restricted to {{COMPANY_NAME}} employees and authorized contractors. Confidential information requires encryption at rest and in transit, with access limited to explicitly authorized personnel. Restricted information represents the highest protection tier and includes PII, PHI, and payment card data, requiring additional DLP monitoring on {{INFRASTRUCTURE_TYPE}}.`,
      confidence_score: 0.72,
    },
    {
      title: '5. Access Management Principles',
      template: `Access to {{COMPANY_NAME}}'s information systems follows the principle of least privilege. All user accounts require multi-factor authentication. Privileged access is limited to authorized administrators and requires separate privileged accounts. Access rights are reviewed quarterly and immediately revoked upon employment termination. Remote access to {{INFRASTRUCTURE_TYPE}} infrastructure requires use of an approved VPN solution. Service accounts are inventoried in the access management register.`,
      confidence_score: 0.90,
    },
    {
      title: '6. Security Awareness Training',
      template: `All {{EMPLOYEE_COUNT}} employees at {{COMPANY_NAME}} must complete annual information security awareness training covering phishing recognition, password management, data handling, and incident reporting. New employees must complete training within their first 30 days. Training completion is tracked and reported to leadership. Employees handling {{DATA_CLASSIFICATIONS}} data receive role-specific training commensurate with their access level. Compliance rates are reported at {{FISCAL_YEAR_END}}.`,
      confidence_score: 0.85,
    },
  ],
  'access-control': [
    {
      title: '1. Purpose and Scope',
      template: `This Access Control Policy defines the procedures and requirements governing access to {{COMPANY_NAME}}'s information systems, applications, and data hosted on {{INFRASTRUCTURE_TYPE}}. It applies to all {{EMPLOYEE_COUNT}} employees, contractors, and automated service accounts interacting with any system owned or operated by {{COMPANY_NAME}} in the {{INDUSTRY}} sector.`,
      confidence_score: 0.94,
    },
    {
      title: '2. User Access Management',
      template: `Access provisioning at {{COMPANY_NAME}} follows a formal request-and-approval workflow. All access requests must be approved by the resource owner and the requester's manager. User accounts are provisioned with minimum necessary permissions. Upon role changes or termination, access is modified or revoked within 24 hours. A complete audit log of provisioning and deprovisioning events is maintained in {{INFRASTRUCTURE_TYPE}} and retained for 12 months.`,
      confidence_score: 0.91,
    },
    {
      title: '3. Privileged Access Management',
      template: `Privileged access at {{COMPANY_NAME}} is strictly controlled and limited to authorized {{INFRASTRUCTURE_TYPE}} administrators and system owners. Privileged users must use dedicated accounts separate from standard user accounts. All privileged sessions are logged and monitored. Just-in-time (JIT) access provisioning is implemented for production environments where technically feasible. Shared privileged accounts are prohibited. Privileged access reviews are conducted monthly.`,
      confidence_score: 0.87,
    },
    {
      title: '4. Multi-Factor Authentication',
      template: `Multi-factor authentication (MFA) is mandatory for all {{COMPANY_NAME}} user accounts accessing internal systems, including {{INFRASTRUCTURE_TYPE}} console access, email, VPN, and business applications. Accepted second factors include TOTP authenticator applications and hardware security keys. SMS-based OTP is permitted only where TOTP is unavailable. MFA bypass procedures require written authorization from the security team and are time-limited. MFA enrollment is completed during onboarding for all {{EMPLOYEE_COUNT}} employees.`,
      confidence_score: 0.93,
    },
    {
      title: '5. Remote Access',
      template: `Remote access to {{COMPANY_NAME}}'s {{INFRASTRUCTURE_TYPE}} environment requires a corporate-managed VPN connection with split-tunneling disabled for production environments. Unmanaged personal devices may not be used for access to Confidential or Restricted systems. Remote access sessions exceeding 8 hours of inactivity are automatically terminated. Remote access to production environments requires manager approval and is logged in the access management system.`,
      confidence_score: 0.73,
    },
    {
      title: '6. Access Review Process',
      template: `{{COMPANY_NAME}} conducts quarterly access reviews for all systems containing {{DATA_CLASSIFICATIONS}} data. System owners certify that all access rights remain appropriate. Accounts inactive for more than 90 days are automatically disabled pending review. Remediation of inappropriate access is completed within 15 business days of identification. Annual comprehensive access reviews are completed by {{FISCAL_YEAR_END}} and review reports are retained for 3 years.`,
      confidence_score: 0.89,
    },
  ],
  'change-management': [
    {
      title: '1. Purpose and Scope',
      template: `This Change Management Policy establishes the processes for planning, testing, approving, and implementing changes to {{COMPANY_NAME}}'s {{INFRASTRUCTURE_TYPE}} infrastructure, applications, and data systems. It applies to all changes in the {{INDUSTRY}} sector environments, covering software releases, infrastructure modifications, configuration changes, and emergency patches affecting all {{EMPLOYEE_COUNT}} employees and customers.`,
      confidence_score: 0.93,
    },
    {
      title: '2. Change Request Process',
      template: `All changes to {{COMPANY_NAME}}'s systems must be submitted via the change management ticketing system at least 5 business days before the planned implementation date, except emergencies. Change requests must include: description and business justification, scope and impact assessment, rollback plan, test results, and required approvals. Changes are classified as Standard (pre-approved recurring), Normal (requires full review), or Emergency (requires post-implementation review). The Change Advisory Board (CAB) reviews Normal changes weekly.`,
      confidence_score: 0.88,
    },
    {
      title: '3. Testing and Approval Requirements',
      template: `All Normal and Emergency changes to {{COMPANY_NAME}}'s {{INFRASTRUCTURE_TYPE}} environment must undergo testing in a non-production environment before deployment. Approval requirements are tiered by risk: low-risk changes require team lead approval; medium-risk changes require department head approval; high-risk changes require CISO and CTO approval. Security-relevant changes affecting {{DATA_CLASSIFICATIONS}} data must include a security review. Automated testing must achieve defined coverage thresholds before production deployment.`,
      confidence_score: 0.71,
    },
    {
      title: '4. Emergency Change Procedures',
      template: `Emergency changes at {{COMPANY_NAME}} are reserved for critical security vulnerabilities, production outages, or data integrity risks. The emergency change process requires: verbal authorization from the CTO or CISO, concurrent notification to {{SECURITY_CONTACT_EMAIL}}, implementation by a minimum of two authorized engineers (four-eyes principle), and post-implementation review within 24 hours. Emergency changes are reviewed at the next CAB meeting and all changes to {{INFRASTRUCTURE_TYPE}} are logged with an emergency designation.`,
      confidence_score: 0.90,
    },
    {
      title: '5. Change Documentation and Rollback',
      template: `Every change implemented in {{COMPANY_NAME}}'s environment must be documented with: timestamp, implementer identity, systems affected, description of change, validation steps taken, and outcome. Rollback procedures must be documented and tested before high-risk change implementation. Rollback capability must be preserved for 72 hours post-deployment for changes to systems processing {{DATA_CLASSIFICATIONS}} data. Change documentation is retained for 3 years. Post-implementation reviews are conducted within 5 business days of major changes.`,
      confidence_score: 0.86,
    },
  ],
  'incident-response': [
    {
      title: '1. Purpose and Scope',
      template: `This Incident Response Policy defines {{COMPANY_NAME}}'s approach to detecting, analyzing, containing, eradicating, and recovering from security incidents affecting {{INFRASTRUCTURE_TYPE}} infrastructure and data classified as {{DATA_CLASSIFICATIONS}}. This policy applies to all {{EMPLOYEE_COUNT}} employees, contractors, and managed service providers engaged by {{COMPANY_NAME}} in the {{INDUSTRY}} sector and is effective through {{FISCAL_YEAR_END}}.`,
      confidence_score: 0.94,
    },
    {
      title: '2. Incident Classification',
      template: `Security incidents at {{COMPANY_NAME}} are classified by severity: P1 (Critical) — active breach, data exfiltration, or ransomware affecting production systems; P2 (High) — unauthorized access to Confidential or Restricted data, significant service degradation; P3 (Medium) — policy violations, unsuccessful attack attempts, isolated malware; P4 (Low) — minor policy deviations or suspicious activity requiring investigation. Response time objectives: P1 within 15 minutes, P2 within 1 hour, P3 within 4 hours, P4 within 24 hours. All incidents are tracked to resolution with documented timelines.`,
      confidence_score: 0.89,
    },
    {
      title: '3. Incident Response Team',
      template: `{{COMPANY_NAME}}'s Incident Response Team (IRT) consists of the CISO (Incident Commander), Lead Engineer (Technical Lead), Legal Counsel, and Communications Lead. Immediate incident notifications are sent to {{SECURITY_CONTACT_EMAIL}}. For P1 and P2 incidents, the IRT activates a dedicated war-room protocol. External forensics and IR retainer services are pre-contracted and available for complex incidents. The IRT roster is reviewed quarterly and updated as the {{EMPLOYEE_COUNT}}-person organization evolves.`,
      confidence_score: 0.87,
    },
    {
      title: '4. Incident Detection and Reporting',
      template: `Security incidents may be detected via automated monitoring on {{INFRASTRUCTURE_TYPE}}, employee reports, third-party notifications, or threat intelligence. All {{COMPANY_NAME}} employees are required to report suspected incidents immediately to {{SECURITY_CONTACT_EMAIL}} or via the security hotline. Detection-to-notification SLAs: P1 within 15 minutes, P2 within 1 hour. The 72-hour regulatory breach notification requirement is tracked as a hard deadline for incidents involving regulated {{DATA_CLASSIFICATIONS}} data.`,
      confidence_score: 0.76,
    },
    {
      title: '5. Response and Containment',
      template: `Upon incident confirmation, {{COMPANY_NAME}}'s IRT executes: (1) Containment — isolate affected systems on {{INFRASTRUCTURE_TYPE}}, revoke compromised credentials, preserve evidence; (2) Eradication — remove malicious artifacts, patch vulnerabilities, reset affected accounts; (3) Recovery — restore systems from clean backups, validate integrity, monitor for recurrence; (4) Communication — notify affected parties and regulators as required. All containment and recovery actions are logged with timestamps in the incident record.`,
      confidence_score: 0.91,
    },
    {
      title: '6. Post-Incident Review',
      template: `All P1 and P2 incidents at {{COMPANY_NAME}} require a formal post-incident review (PIR) conducted within 5 business days of resolution. PIR deliverables include: timeline reconstruction, root cause analysis, impact assessment, remediation actions with owners and deadlines, and lessons learned. PIR reports are reviewed by the CISO and retained for 5 years. Systemic findings are tracked as security improvement initiatives and reviewed at {{FISCAL_YEAR_END}}.`,
      confidence_score: 0.83,
    },
  ],
  'risk-assessment': [
    {
      title: '1. Purpose and Scope',
      template: `This Risk Assessment Policy establishes the methodology for identifying, analyzing, evaluating, and treating information security risks at {{COMPANY_NAME}}. This policy applies to all {{INFRASTRUCTURE_TYPE}}-hosted systems, {{DATA_CLASSIFICATIONS}} data, and business processes across the {{EMPLOYEE_COUNT}}-person {{INDUSTRY}} organization. Risk assessments align with NIST SP 800-30 and SOC 2 Trust Service Criteria, with results reviewed through {{FISCAL_YEAR_END}}.`,
      confidence_score: 0.92,
    },
    {
      title: '2. Risk Assessment Methodology',
      template: `{{COMPANY_NAME}} employs a qualitative risk assessment methodology using a 5x5 likelihood-impact matrix. Likelihood is assessed on a scale of 1 (Rare) to 5 (Almost Certain) based on threat actor capability, intent, and opportunity on {{INFRASTRUCTURE_TYPE}}. Impact is assessed on a scale of 1 (Negligible) to 5 (Critical) considering confidentiality, integrity, availability, and business impact. Risk scores (Likelihood × Impact) determine treatment priority: 1-4 (Low), 5-9 (Medium), 10-16 (High), 17-25 (Critical).`,
      confidence_score: 0.88,
    },
    {
      title: '3. Risk Identification',
      template: `Risk identification at {{COMPANY_NAME}} draws from threat intelligence for the {{INDUSTRY}} sector, penetration testing findings on {{INFRASTRUCTURE_TYPE}}, vulnerability scan results, security incident history, and third-party audit findings. Asset-based risk identification covers all {{DATA_CLASSIFICATIONS}} data repositories, critical business applications, and {{INFRASTRUCTURE_TYPE}} infrastructure components. The risk register is updated following significant environment changes. All {{EMPLOYEE_COUNT}} employees may submit risk observations to {{SECURITY_CONTACT_EMAIL}}.`,
      confidence_score: 0.85,
    },
    {
      title: '4. Risk Evaluation and Scoring',
      template: `Each identified risk at {{COMPANY_NAME}} is evaluated by: (1) inherent risk score (pre-control), (2) current control effectiveness assessment, (3) residual risk score (post-control), and (4) risk appetite comparison. Risks exceeding the defined risk appetite threshold require escalation to the CISO within 5 business days. Risk evaluations consider the sensitivity of {{DATA_CLASSIFICATIONS}} data and the regulatory exposure in the {{INDUSTRY}} sector. Risk scores are documented in the enterprise risk register maintained by the security team.`,
      confidence_score: 0.70,
    },
    {
      title: '5. Risk Treatment',
      template: `{{COMPANY_NAME}} addresses identified risks through four treatment options: Accept (within appetite, formally documented), Mitigate (implement controls to reduce risk score), Transfer (insurance or contractual liability shift), or Avoid (discontinue risk-introducing activity). Treatment plans for High and Critical risks require CISO approval and include: control implementation plan, target residual risk score, implementation owner, and completion deadline. Mitigating controls on {{INFRASTRUCTURE_TYPE}} are validated through testing. Risk treatment progress is reviewed monthly and reported at {{FISCAL_YEAR_END}}.`,
      confidence_score: 0.82,
    },
    {
      title: '6. Monitoring and Review',
      template: `{{COMPANY_NAME}}'s risk register is reviewed quarterly by the security team and annually by executive leadership. Continuous monitoring via {{INFRASTRUCTURE_TYPE}} security tooling provides real-time risk posture visibility. The annual comprehensive risk assessment is completed by {{FISCAL_YEAR_END}} and results are presented to the Board. New risks from business changes, threat intelligence, or incident findings are assessed within 30 days. Risk metrics including open High and Critical risks, treatment velocity, and repeat findings are reported monthly to {{SECURITY_CONTACT_EMAIL}}.`,
      confidence_score: 0.87,
    },
  ],
};

export function generatePolicyContent(
  policyType: PolicyType,
  vars: CompanyVariables
): PolicySection[] {
  const templates = SECTION_TEMPLATES[policyType];
  return templates.map((tmpl, idx) => ({
    id: randomUUID(),
    title: tmpl.title,
    content: substituteVariables(tmpl.template, vars),
    confidence_score: tmpl.confidence_score,
    reviewed: tmpl.confidence_score >= 0.75,
    order_index: idx,
  }));
}

function buildPolicyVersion(
  policyType: PolicyType,
  vars: CompanyVariables,
  version: number = 1
): PolicyVersion {
  return {
    id: randomUUID(),
    version,
    generated_at: new Date().toISOString(),
    generated_by: 'ai',
    sections: generatePolicyContent(policyType, vars),
    changelog: version === 1 ? 'Initial AI-generated draft' : `Version ${version} generated`,
  };
}

export function getSeedPolicies(vars: CompanyVariables = DEFAULT_COMPANY_VARIABLES): PolicyDocument[] {
  const now = new Date().toISOString();
  return POLICY_ORDER.map((policyType, idx) => {
    const currentVersion = buildPolicyVersion(policyType, vars, 1);
    return {
      id: `seed-${policyType}`,
      type: policyType,
      title: POLICY_TITLES[policyType],
      status: idx === 0 ? 'under_review' : 'draft' as PolicyStatus,
      current_version: currentVersion,
      versions: [currentVersion],
      created_at: now,
      updated_at: now,
    };
  });
}

export function canExportPolicy(policy: PolicyDocument): boolean {
  const sections = policy.current_version.sections;
  return sections.every(
    (section) => section.confidence_score >= 0.75 || section.reviewed
  );
}

export async function getPolicies(): Promise<PolicyDocument[]> {
  const vars = await getCompanyVariables();
  if (!process.env.DATABASE_URL) {
    return getSeedPolicies(vars);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query<{
      id: string; type: string; title: string; status: string;
      created_at: Date; updated_at: Date;
    }>(
      `SELECT id, type, title, status, created_at, updated_at
       FROM soc2_policies
       ORDER BY type ASC`
    );
    if (rows.length === 0) {
      return getSeedPolicies(vars);
    }
    const policies: PolicyDocument[] = await Promise.all(
      rows.map((row) => loadPolicyWithVersions(pool, row, vars))
    );
    return policies;
  } catch {
    return getSeedPolicies(vars);
  } finally {
    await pool.end();
  }
}

export async function getPolicy(id: string): Promise<PolicyDocument | null> {
  const vars = await getCompanyVariables();
  if (!process.env.DATABASE_URL) {
    const seeds = getSeedPolicies(vars);
    return seeds.find((p) => p.id === id) ?? seeds[0] ?? null;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query<{
      id: string; type: string; title: string; status: string;
      created_at: Date; updated_at: Date;
    }>(
      `SELECT id, type, title, status, created_at, updated_at
       FROM soc2_policies
       WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      const seeds = getSeedPolicies(vars);
      return seeds.find((p) => p.id === id) ?? null;
    }
    return loadPolicyWithVersions(pool, rows[0], vars);
  } catch {
    const seeds = getSeedPolicies(vars);
    return seeds.find((p) => p.id === id) ?? seeds[0] ?? null;
  } finally {
    await pool.end();
  }
}

async function loadPolicyWithVersions(
  pool: Pool,
  row: { id: string; type: string; title: string; status: string; created_at: Date; updated_at: Date },
  vars: CompanyVariables
): Promise<PolicyDocument> {
  const { rows: versionRows } = await pool.query<{
    id: string; version: number; generated_at: Date;
    generated_by: string; changelog: string; is_current: boolean;
  }>(
    `SELECT id, version, generated_at, generated_by, changelog, is_current
     FROM soc2_policy_versions
     WHERE policy_id = $1
     ORDER BY version DESC`,
    [row.id]
  );

  if (versionRows.length === 0) {
    const currentVersion = buildPolicyVersion(row.type as PolicyType, vars, 1);
    return {
      id: row.id,
      type: row.type as PolicyType,
      title: row.title,
      status: row.status as PolicyStatus,
      current_version: currentVersion,
      versions: [currentVersion],
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  const versionsWithSections: PolicyVersion[] = await Promise.all(
    versionRows.map(async (vr) => {
      const { rows: sectionRows } = await pool.query<{
        id: string; title: string; content: string;
        confidence_score: string; reviewed: boolean; order_index: number;
      }>(
        `SELECT id, title, content, confidence_score, reviewed, order_index
         FROM soc2_policy_sections
         WHERE version_id = $1
         ORDER BY order_index ASC`,
        [vr.id]
      );
      return {
        id: vr.id,
        version: vr.version,
        generated_at: vr.generated_at.toISOString(),
        generated_by: vr.generated_by as GeneratedBy,
        changelog: vr.changelog,
        sections: sectionRows.map((sr) => ({
          id: sr.id,
          title: sr.title,
          content: sr.content,
          confidence_score: Number(sr.confidence_score),
          reviewed: sr.reviewed,
          order_index: sr.order_index,
        })),
      };
    })
  );

  const currentVersion = versionsWithSections.find((v) =>
    versionRows.find((vr) => vr.id === v.id)?.is_current
  ) ?? versionsWithSections[0];

  return {
    id: row.id,
    type: row.type as PolicyType,
    title: row.title,
    status: row.status as PolicyStatus,
    current_version: currentVersion,
    versions: versionsWithSections,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function markSectionReviewed(
  policyId: string,
  sectionId: string
): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `UPDATE soc2_policy_sections SET reviewed = TRUE
       WHERE id = $1
       AND version_id IN (
         SELECT id FROM soc2_policy_versions
         WHERE policy_id = $2 AND is_current = TRUE
       )`,
      [sectionId, policyId]
    );
  } finally {
    await pool.end();
  }
}

export async function updatePolicyStatus(
  policyId: string,
  status: PolicyStatus
): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(
      `UPDATE soc2_policies SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, policyId]
    );
  } finally {
    await pool.end();
  }
}
