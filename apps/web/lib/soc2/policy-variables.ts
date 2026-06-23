import { Pool } from 'pg';

export type InfrastructureType = 'aws' | 'gcp' | 'azure' | 'hybrid' | 'on-premise';

export interface CompanyVariables {
  companyName: string;
  infrastructureType: InfrastructureType;
  employeeCount: number;
  industry: string;
  fiscalYearEnd: string;
  securityContactEmail: string;
  dataClassifications: string[];
}

export const DEFAULT_COMPANY_VARIABLES: CompanyVariables = {
  companyName: process.env.COMPANY_NAME ?? 'Acme Corporation',
  infrastructureType: (process.env.INFRASTRUCTURE_TYPE as InfrastructureType) ?? 'aws',
  employeeCount: parseInt(process.env.EMPLOYEE_COUNT ?? '50', 10),
  industry: process.env.INDUSTRY ?? 'Technology',
  fiscalYearEnd: process.env.FISCAL_YEAR_END ?? 'December 31',
  securityContactEmail: process.env.SECURITY_CONTACT_EMAIL ?? 'security@example.com',
  dataClassifications: ['Public', 'Internal', 'Confidential', 'Restricted'],
};

const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

export function substituteVariables(template: string, vars: CompanyVariables): string {
  const varMap: Record<string, string> = {
    COMPANY_NAME: vars.companyName,
    INFRASTRUCTURE_TYPE: vars.infrastructureType,
    EMPLOYEE_COUNT: String(vars.employeeCount),
    INDUSTRY: vars.industry,
    FISCAL_YEAR_END: vars.fiscalYearEnd,
    SECURITY_CONTACT_EMAIL: vars.securityContactEmail,
    DATA_CLASSIFICATIONS: vars.dataClassifications.join(', '),
  };
  return template.replace(PLACEHOLDER_RE, (_m: string, key: string) => {
    const normalized = key.trim().toUpperCase();
    return varMap[normalized] ?? `{{${key}}}`;
  });
}

export async function getCompanyVariables(): Promise<CompanyVariables> {
  if (!process.env.DATABASE_URL) {
    return { ...DEFAULT_COMPANY_VARIABLES };
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query<{
      company_name: string;
      infrastructure_type: string;
      employee_count: number;
      industry: string;
      fiscal_year_end: string;
      security_contact_email: string;
      data_classifications: string[];
    }>(
      `SELECT company_name, infrastructure_type, employee_count, industry,
              fiscal_year_end, security_contact_email, data_classifications
       FROM soc2_company_settings
       ORDER BY updated_at DESC
       LIMIT 1`
    );
    if (rows.length === 0) return { ...DEFAULT_COMPANY_VARIABLES };
    const row = rows[0];
    return {
      companyName: row.company_name,
      infrastructureType: row.infrastructure_type as InfrastructureType,
      employeeCount: Number(row.employee_count),
      industry: row.industry,
      fiscalYearEnd: row.fiscal_year_end,
      securityContactEmail: row.security_contact_email,
      dataClassifications: row.data_classifications,
    };
  } catch {
    return { ...DEFAULT_COMPANY_VARIABLES };
  } finally {
    await pool.end();
  }
}
