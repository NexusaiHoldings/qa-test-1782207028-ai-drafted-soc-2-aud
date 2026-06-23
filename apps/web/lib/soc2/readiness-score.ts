// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any = null;

function getPool(): { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> } {
  if (_pool) return _pool;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require("pg") as {
    Pool: new (cfg: Record<string, unknown>) => {
      query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
    };
  };
  _pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

export interface ControlItem {
  id: string;
  name: string;
  category: string;
  status: "mapped" | "gap" | "not_started";
  priority: number;
  gapDescription: string | null;
}

export interface ActionItem {
  id: string;
  title: string;
  description: string;
  priority: number;
  category: string;
}

export interface ReadinessData {
  score: number;
  totalControls: number;
  mappedControls: number;
  gapControls: number;
  notStartedControls: number;
  targetAuditDate: string | null;
  weeksToAudit: number | null;
  controls: ControlItem[];
  nextActions: ActionItem[];
  hasData: boolean;
}

type ControlRow = {
  id: string;
  name: string;
  category: string;
  priority: number;
  gap_description: string | null;
  status: "mapped" | "gap" | "not_started";
};

type SettingsRow = {
  target_audit_date: string | null;
};

const EMPTY_DATA: ReadinessData = {
  score: 0,
  totalControls: 0,
  mappedControls: 0,
  gapControls: 0,
  notStartedControls: 0,
  targetAuditDate: null,
  weeksToAudit: null,
  controls: [],
  nextActions: [],
  hasData: false,
};

export async function getReadinessData(orgId: string): Promise<ReadinessData> {
  if (!process.env.DATABASE_URL) return { ...EMPTY_DATA };

  const pool = getPool();

  try {
    const controlResult = await pool.query(
      `SELECT
        c.id,
        c.name,
        c.category,
        c.priority,
        c.gap_description,
        CASE
          WHEN COUNT(e.id) > 0 THEN 'mapped'
          WHEN c.gap_description IS NOT NULL THEN 'gap'
          ELSE 'not_started'
        END AS status
       FROM soc2_controls c
       LEFT JOIN soc2_evidence e ON e.control_id = c.id AND e.org_id = $1
       WHERE c.in_scope = true
       GROUP BY c.id, c.name, c.category, c.priority, c.gap_description
       ORDER BY c.priority DESC`,
      [orgId]
    );

    const rows = controlResult.rows as ControlRow[];
    if (rows.length === 0) return { ...EMPTY_DATA };

    const controls: ControlItem[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      status: row.status,
      priority: row.priority,
      gapDescription: row.gap_description,
    }));

    const mappedControls = controls.filter((c) => c.status === "mapped").length;
    const gapControls = controls.filter((c) => c.status === "gap").length;
    const notStartedControls = controls.filter((c) => c.status === "not_started").length;
    const totalControls = controls.length;
    const score = totalControls > 0 ? Math.round((mappedControls / totalControls) * 100) : 0;

    let targetAuditDate: string | null = null;
    let weeksToAudit: number | null = null;

    try {
      const settingsResult = await pool.query(
        `SELECT target_audit_date FROM soc2_settings WHERE org_id = $1 LIMIT 1`,
        [orgId]
      );
      const settingsRows = settingsResult.rows as SettingsRow[];
      if (settingsRows.length > 0 && settingsRows[0].target_audit_date) {
        targetAuditDate = settingsRows[0].target_audit_date;
        const auditMs = new Date(targetAuditDate).getTime();
        const diffMs = auditMs - Date.now();
        weeksToAudit = Math.max(0, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)));
      }
    } catch {
      // soc2_settings table may not exist yet; timeline is optional
    }

    const nextActions: ActionItem[] = controls
      .filter((c) => c.status !== "mapped")
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3)
      .map((c) => ({
        id: c.id,
        title:
          c.status === "gap"
            ? `Remediate gap in ${c.name}`
            : `Start evidence collection for ${c.name}`,
        description:
          c.gapDescription ??
          `Collect and map evidence for the ${c.category} control area to satisfy SOC 2 criteria.`,
        priority: c.priority,
        category: c.category,
      }));

    return {
      score,
      totalControls,
      mappedControls,
      gapControls,
      notStartedControls,
      targetAuditDate,
      weeksToAudit,
      controls,
      nextActions,
      hasData: true,
    };
  } catch {
    // Tables not yet provisioned or DB unreachable — show empty onboarding state
    return { ...EMPTY_DATA };
  }
}
