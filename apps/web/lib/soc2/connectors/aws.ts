import crypto from "crypto";

// ── Types ────────────────────────────────────────────────────────────────────

export type ConnectorStatus =
  | "connected"
  | "syncing"
  | "error"
  | "not_connected";

export interface ConnectorRecord {
  id: string;
  orgId: string;
  provider: string;
  status: ConnectorStatus;
  lastSyncAt: Date | null;
  recordCount: number;
  errorMessage: string | null;
  errorCode: string | null;
  updatedAt: Date;
}

export interface AWSInitResult {
  authUrl: string;
  codeVerifier: string;
  state: string;
}

// ── DB pool — same singleton pattern as apps/web/lib/db.ts ───────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pool: any = null;

function getPool(): {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
} {
  if (_pool) return _pool;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool: PgPool } = require("pg") as {
    Pool: new (config: Record<string, unknown>) => {
      query: (
        sql: string,
        params?: unknown[],
      ) => Promise<{ rows: unknown[] }>;
    };
  };
  _pool = new PgPool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return _pool;
}

// ── Schema bootstrap ─────────────────────────────────────────────────────────

let _schemaReady = false;

async function ensureSchema(): Promise<void> {
  if (_schemaReady) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS soc2_connectors (
      id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id           TEXT        NOT NULL,
      provider         TEXT        NOT NULL,
      status           TEXT        NOT NULL DEFAULT 'not_connected',
      access_token     TEXT,
      refresh_token    TEXT,
      token_expires_at TIMESTAMPTZ,
      scopes           TEXT[],
      last_sync_at     TIMESTAMPTZ,
      record_count     INTEGER     DEFAULT 0,
      error_message    TEXT,
      error_code       TEXT,
      metadata         JSONB       DEFAULT '{}',
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (org_id, provider)
    )
  `);
  _schemaReady = true;
}

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate PKCE params and the AWS SSO OAuth authorization URL.
 * The caller must store codeVerifier + state in httpOnly cookies before
 * redirecting the browser to authUrl.
 */
export async function initiateAWSAuth(orgId: string): Promise<AWSInitResult> {
  void orgId; // orgId reserved for per-org SSO tenant routing (future)
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(16).toString("hex");

  const ssoBase =
    process.env.AWS_SSO_START_URL ?? "https://your-sso.awsapps.com/start";
  const clientId = process.env.AWS_SSO_CLIENT_ID ?? "";
  const appBase =
    process.env.APP_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000";
  const redirectUri = `${appBase}/connectors/aws/callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "sso:account:access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return {
    authUrl: `${ssoBase}/oauth2/authorize?${params.toString()}`,
    codeVerifier,
    state,
  };
}

/**
 * Exchange the OAuth authorization code for tokens and persist them.
 * Marks the connector status as 'syncing' on success, 'error' on failure.
 */
export async function handleAWSCallback(
  code: string,
  codeVerifier: string,
  orgId: string,
): Promise<void> {
  await ensureSchema();

  const ssoBase = process.env.AWS_SSO_START_URL ?? "";
  const clientId = process.env.AWS_SSO_CLIENT_ID ?? "";
  const appBase =
    process.env.APP_BASE_URL ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000";
  const redirectUri = `${appBase}/connectors/aws/callback`;

  const tokenRes = await fetch(`${ssoBase}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errData = (await tokenRes
      .json()
      .catch(() => ({}))) as Record<string, string>;
    const errorCode =
      errData.error === "invalid_client" || errData.error === "invalid_grant"
        ? "invalid_credentials"
        : "insufficient_permissions";
    const message = errData.error_description ?? "Authentication failed";

    const pool = getPool();
    await pool.query(
      `INSERT INTO soc2_connectors
         (id, org_id, provider, status, error_message, error_code, updated_at)
       VALUES (gen_random_uuid(), $1, 'aws', 'error', $2, $3, NOW())
       ON CONFLICT (org_id, provider) DO UPDATE
         SET status = 'error', error_message = $2, error_code = $3, updated_at = NOW()`,
      [orgId, message, errorCode],
    );
    throw new Error(errorCode);
  }

  const tokens = (await tokenRes.json()) as Record<string, unknown>;
  const pool = getPool();

  await pool.query(
    `INSERT INTO soc2_connectors
       (id, org_id, provider, status, access_token, refresh_token,
        token_expires_at, scopes, error_message, error_code, updated_at)
     VALUES (gen_random_uuid(), $1, 'aws', 'syncing', $2, $3, $4, $5, NULL, NULL, NOW())
     ON CONFLICT (org_id, provider) DO UPDATE
       SET status = 'syncing', access_token = $2, refresh_token = $3,
           token_expires_at = $4, scopes = $5,
           error_message = NULL, error_code = NULL, updated_at = NOW()`,
    [
      orgId,
      tokens.access_token as string,
      (tokens.refresh_token as string) ?? null,
      tokens.expires_in
        ? new Date(Date.now() + (tokens.expires_in as number) * 1000)
        : null,
      tokens.scope ? (tokens.scope as string).split(" ") : [],
    ],
  );
}

/**
 * Probe AWS Config API with the stored token to verify connectivity.
 * Updates the connector status in the DB based on the result.
 */
export async function testAWSConnection(orgId: string): Promise<{
  success: boolean;
  errorCode?: string;
  message?: string;
}> {
  await ensureSchema();
  const pool = getPool();

  const res = await pool.query(
    `SELECT access_token, token_expires_at
     FROM soc2_connectors
     WHERE org_id = $1 AND provider = 'aws'`,
    [orgId],
  );

  if ((res.rows as unknown[]).length === 0) {
    return {
      success: false,
      errorCode: "not_connected",
      message: "No AWS connector configured",
    };
  }

  const row = (res.rows as Array<Record<string, unknown>>)[0];
  const expiresAt = row.token_expires_at
    ? new Date(row.token_expires_at as string)
    : null;

  if (expiresAt && expiresAt < new Date()) {
    await pool.query(
      `UPDATE soc2_connectors
       SET status = 'error', error_code = 'invalid_credentials',
           error_message = 'Access token expired', updated_at = NOW()
       WHERE org_id = $1 AND provider = 'aws'`,
      [orgId],
    );
    return {
      success: false,
      errorCode: "invalid_credentials",
      message: "Access token expired — please reconnect",
    };
  }

  const region = process.env.AWS_REGION ?? "us-east-1";
  try {
    const configRes = await fetch(
      `https://config.${region}.amazonaws.com/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "StarlingDoveService.DescribeConfigRules",
          Authorization: `Bearer ${row.access_token as string}`,
        },
        body: JSON.stringify({ Limit: 1 }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (configRes.status === 403) {
      await pool.query(
        `UPDATE soc2_connectors
         SET status = 'error', error_code = 'insufficient_permissions',
             error_message = 'IAM role lacks config:DescribeConfigRules permission',
             updated_at = NOW()
         WHERE org_id = $1 AND provider = 'aws'`,
        [orgId],
      );
      return {
        success: false,
        errorCode: "insufficient_permissions",
        message:
          "Insufficient IAM permissions — attach AWSConfigReadOnlyAccess to the role",
      };
    }

    if (configRes.status === 401) {
      await pool.query(
        `UPDATE soc2_connectors
         SET status = 'error', error_code = 'invalid_credentials',
             error_message = 'Invalid or expired AWS credentials', updated_at = NOW()
         WHERE org_id = $1 AND provider = 'aws'`,
        [orgId],
      );
      return {
        success: false,
        errorCode: "invalid_credentials",
        message: "Invalid AWS credentials — please reconnect",
      };
    }

    if (!configRes.ok) {
      return {
        success: false,
        message: `AWS Config API returned ${configRes.status}`,
      };
    }

    await pool.query(
      `UPDATE soc2_connectors
       SET status = 'connected', error_message = NULL, error_code = NULL, updated_at = NOW()
       WHERE org_id = $1 AND provider = 'aws'`,
      [orgId],
    );
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, message: `Network error: ${msg}` };
  }
}

/**
 * Pull all AWS Config rules for an org and persist the count.
 * Uses paginated DescribeConfigRules calls; marks status 'error' on any failure.
 */
export async function syncAWSConnector(
  orgId: string,
): Promise<{ recordCount: number }> {
  await ensureSchema();
  const pool = getPool();

  await pool.query(
    `UPDATE soc2_connectors SET status = 'syncing', updated_at = NOW()
     WHERE org_id = $1 AND provider = 'aws'`,
    [orgId],
  );

  const tokenRes = await pool.query(
    `SELECT access_token FROM soc2_connectors WHERE org_id = $1 AND provider = 'aws'`,
    [orgId],
  );

  if ((tokenRes.rows as unknown[]).length === 0) {
    throw new Error(`No AWS connector found for org ${orgId}`);
  }

  const { access_token: accessToken } = (
    tokenRes.rows as Array<{ access_token: string }>
  )[0];
  const region = process.env.AWS_REGION ?? "us-east-1";
  let totalRules = 0;
  let nextToken: string | undefined;

  try {
    do {
      const body: Record<string, unknown> = { Limit: 100 };
      if (nextToken) body.NextToken = nextToken;

      const resp = await fetch(`https://config.${region}.amazonaws.com/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": "StarlingDoveService.DescribeConfigRules",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });

      if (!resp.ok) {
        const errData = (await resp
          .json()
          .catch(() => ({}))) as Record<string, string>;
        const errorCode =
          resp.status === 403
            ? "insufficient_permissions"
            : "invalid_credentials";
        const message =
          errData.message ?? `HTTP ${resp.status} from AWS Config API`;

        await pool.query(
          `UPDATE soc2_connectors
           SET status = 'error', error_code = $2, error_message = $3, updated_at = NOW()
           WHERE org_id = $1 AND provider = 'aws'`,
          [orgId, errorCode, message],
        );
        throw new Error(errorCode);
      }

      const data = (await resp.json()) as {
        ConfigRules?: unknown[];
        NextToken?: string;
      };
      totalRules += (data.ConfigRules ?? []).length;
      nextToken = data.NextToken;
    } while (nextToken);
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message === "insufficient_permissions" ||
        err.message === "invalid_credentials")
    ) {
      throw err;
    }
    const message = err instanceof Error ? err.message : "Sync failed";
    await pool.query(
      `UPDATE soc2_connectors
       SET status = 'error', error_message = $2, updated_at = NOW()
       WHERE org_id = $1 AND provider = 'aws'`,
      [orgId, message],
    );
    throw err;
  }

  await pool.query(
    `UPDATE soc2_connectors
     SET status = 'connected', record_count = $2, last_sync_at = NOW(),
         error_message = NULL, error_code = NULL, updated_at = NOW()
     WHERE org_id = $1 AND provider = 'aws'`,
    [orgId, totalRules],
  );

  return { recordCount: totalRules };
}

/** Fetch one connector record for an org + provider (null if not configured). */
export async function getConnector(
  orgId: string,
  provider: string,
): Promise<ConnectorRecord | null> {
  await ensureSchema();
  const pool = getPool();

  const res = await pool.query(
    `SELECT id, org_id, provider, status, last_sync_at, record_count,
            error_message, error_code, updated_at
     FROM soc2_connectors
     WHERE org_id = $1 AND provider = $2`,
    [orgId, provider],
  );

  if ((res.rows as unknown[]).length === 0) return null;
  return rowToRecord((res.rows as Array<Record<string, unknown>>)[0]);
}

/** Fetch all connector records for an org. */
export async function getAllConnectors(
  orgId: string,
): Promise<ConnectorRecord[]> {
  await ensureSchema();
  const pool = getPool();

  const res = await pool.query(
    `SELECT id, org_id, provider, status, last_sync_at, record_count,
            error_message, error_code, updated_at
     FROM soc2_connectors
     WHERE org_id = $1
     ORDER BY provider`,
    [orgId],
  );

  return (res.rows as Array<Record<string, unknown>>).map(rowToRecord);
}

/**
 * Fetch all connectors that are due for a cron sync:
 * - status = 'connected' and not synced in the last 6 h, OR
 * - stuck in status = 'syncing' for > 1 h.
 */
export async function getAllConnectorsForCron(): Promise<ConnectorRecord[]> {
  await ensureSchema();
  const pool = getPool();

  const res = await pool.query(
    `SELECT id, org_id, provider, status, last_sync_at, record_count,
            error_message, error_code, updated_at
     FROM soc2_connectors
     WHERE
       (status = 'connected'
        AND (last_sync_at IS NULL OR last_sync_at < NOW() - INTERVAL '6 hours'))
       OR (status = 'syncing' AND updated_at < NOW() - INTERVAL '1 hour')
     ORDER BY last_sync_at ASC NULLS FIRST`,
    [],
  );

  return (res.rows as Array<Record<string, unknown>>).map(rowToRecord);
}

/** True when the connector's last sync is older than maxAgeDays. */
export function isConnectorStale(
  lastSyncAt: Date | null,
  maxAgeDays = 7,
): boolean {
  if (!lastSyncAt) return false;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return Date.now() - new Date(lastSyncAt).getTime() > maxAgeMs;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function rowToRecord(row: Record<string, unknown>): ConnectorRecord {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    provider: row.provider as string,
    status: row.status as ConnectorStatus,
    lastSyncAt: row.last_sync_at
      ? new Date(row.last_sync_at as string)
      : null,
    recordCount: (row.record_count as number) ?? 0,
    errorMessage: (row.error_message as string) ?? null,
    errorCode: (row.error_code as string) ?? null,
    updatedAt: new Date(row.updated_at as string),
  };
}
