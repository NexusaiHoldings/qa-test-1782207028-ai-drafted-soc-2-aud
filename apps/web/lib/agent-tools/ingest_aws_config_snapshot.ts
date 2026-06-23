/**
 * Agent tool: ingest_aws_config_snapshot
 * Polls AWS Config API for compliance rule results and stores raw snapshots
 * as evidence artifacts linked to SOC 2 control IDs.
 * Autonomy class: mutation — confirm-gated, routes through cross-boundary bridge.
 */

import type { HandlerContext, HandlerResult } from "@nexus/identity-and-access";
import { createHash, createHmac, randomUUID } from "crypto";

type Args = Record<string, unknown>;

interface ComplianceResult {
  ConfigRuleName: string;
  Compliance: {
    ComplianceType: string;
    ComplianceContributorCount?: {
      CappedCount: number;
      CapExceeded: boolean;
    };
  };
}

interface DescribeComplianceResponse {
  ComplianceByConfigRules: ComplianceResult[];
  NextToken?: string;
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  regionName: string,
  serviceName: string,
): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, regionName);
  const kService = hmacSha256(kRegion, serviceName);
  return hmacSha256(kService, "aws4_request");
}

async function signedAwsConfigRequest(
  region: string,
  target: string,
  body: string,
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken: string | undefined,
): Promise<Response> {
  const endpoint = `https://config.${region}.amazonaws.com/`;
  const url = new URL(endpoint);

  const now = new Date();
  const amzDate =
    now
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "") + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);

  const rawHeaders: Record<string, string> = {
    "content-type": "application/x-amz-json-1.1",
    host: url.hostname,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    "x-amz-target": target,
  };
  if (sessionToken) rawHeaders["x-amz-security-token"] = sessionToken;

  const sortedKeys = Object.keys(rawHeaders).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${rawHeaders[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");

  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/config/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, "config");
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const fetchHeaders: Record<string, string> = { ...rawHeaders, Authorization: authorization };

  return fetch(endpoint, { method: "POST", headers: fetchHeaders, body });
}

async function fetchAllComplianceResults(
  region: string,
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken: string | undefined,
): Promise<ComplianceResult[]> {
  const results: ComplianceResult[] = [];
  let nextToken: string | undefined;

  do {
    const payload: Record<string, unknown> = {};
    if (nextToken) payload.NextToken = nextToken;

    const response = await signedAwsConfigRequest(
      region,
      "StarlingDoveService.DescribeComplianceByConfigRule",
      JSON.stringify(payload),
      accessKeyId,
      secretAccessKey,
      sessionToken,
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AWS Config ${response.status}: ${text}`);
    }

    const data = (await response.json()) as DescribeComplianceResponse;
    results.push(...data.ComplianceByConfigRules);
    nextToken = data.NextToken;
  } while (nextToken);

  return results;
}

const SOC2_KEYWORD_MAP: Record<string, string[]> = {
  "CC6.1": ["encrypt", "kms", "ssl", "tls", "certificate"],
  "CC6.2": ["iam", "access", "mfa", "password", "credential"],
  "CC6.3": ["security-group", "vpc", "network", "acl", "firewall"],
  "CC7.1": ["cloudtrail", "log", "monitor", "config", "audit"],
  "CC7.2": ["guardduty", "inspector", "macie", "shield", "detect"],
  "A1.1":  ["backup", "snapshot", "versioning", "replication", "recovery"],
};

function mapRuleToControls(ruleName: string): string[] {
  const lower = ruleName.toLowerCase();
  const matched = Object.entries(SOC2_KEYWORD_MAP)
    .filter(([, kws]) => kws.some((kw) => lower.includes(kw)))
    .map(([ctrl]) => ctrl);
  return matched.length > 0 ? matched : ["CC6.1"];
}

export async function handleIngestAwsConfigSnapshot(
  ctx: HandlerContext,
  args: Args,
): Promise<HandlerResult> {
  const orgId = typeof args.org_id === "string" ? args.org_id.trim() : "";
  if (!orgId) return { status: 400, body: "org_id is required" };

  const region =
    typeof args.region === "string" && args.region.trim()
      ? args.region.trim()
      : (process.env.AWS_REGION ?? "us-east-1");

  const accountId =
    typeof args.account_id === "string" ? args.account_id.trim() : "";

  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const sessionToken = process.env.AWS_SESSION_TOKEN;

  if (!accessKeyId || !secretAccessKey) {
    return { status: 500, body: "AWS credentials not configured" };
  }

  let rules: ComplianceResult[];
  try {
    rules = await fetchAllComplianceResults(
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
    );
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    return { status: 502, body: `AWS Config fetch failed: ${msg}` };
  }

  const snapshotId = randomUUID();
  const fetchedAt = new Date().toISOString();
  const compliantCount = rules.filter(
    (r) => r.Compliance.ComplianceType === "COMPLIANT",
  ).length;
  const nonCompliantCount = rules.filter(
    (r) => r.Compliance.ComplianceType === "NON_COMPLIANT",
  ).length;

  try {
    await ctx.db.execute(
      `INSERT INTO aws_config_snapshots
         (id, org_id, account_id, region, raw_snapshot, fetched_at,
          rule_count, compliant_count, non_compliant_count, created_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6::timestamptz,
               $7, $8, $9, NOW())
       ON CONFLICT (org_id, account_id, region, fetched_at)
       DO UPDATE SET
         raw_snapshot       = EXCLUDED.raw_snapshot,
         rule_count         = EXCLUDED.rule_count,
         compliant_count    = EXCLUDED.compliant_count,
         non_compliant_count = EXCLUDED.non_compliant_count`,
      snapshotId,
      orgId,
      accountId || null,
      region,
      JSON.stringify({ account_id: accountId, region, fetched_at: fetchedAt, rules }),
      fetchedAt,
      rules.length,
      compliantCount,
      nonCompliantCount,
    );
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    return { status: 500, body: `Failed to store snapshot: ${msg}` };
  }

  const artifactInserts = rules.flatMap((rule) =>
    mapRuleToControls(rule.ConfigRuleName).map((controlId) =>
      ctx.db.execute(
        `INSERT INTO soc2_evidence_artifacts
           (id, org_id, snapshot_id, control_id, rule_name,
            compliance_type, raw_evidence, collected_at, created_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb,
                 $8::timestamptz, NOW())
         ON CONFLICT (org_id, snapshot_id, control_id, rule_name) DO NOTHING`,
        randomUUID(),
        orgId,
        snapshotId,
        controlId,
        rule.ConfigRuleName,
        rule.Compliance.ComplianceType,
        JSON.stringify(rule),
        fetchedAt,
      ),
    ),
  );

  try {
    await Promise.all(artifactInserts);
  } catch (artErr) {
    const msg = artErr instanceof Error ? artErr.message : String(artErr);
    return { status: 500, body: `Failed to store evidence artifacts: ${msg}` };
  }

  await ctx.events.publish("aws_config.snapshot_ingested", {
    org_id: orgId,
    snapshot_id: snapshotId,
    rule_count: rules.length,
    compliant_count: compliantCount,
    non_compliant_count: nonCompliantCount,
  });

  return {
    status: 200,
    body: {
      snapshot_id: snapshotId,
      rule_count: rules.length,
      compliant_count: compliantCount,
      non_compliant_count: nonCompliantCount,
      evidence_artifact_count: artifactInserts.length,
    },
  };
}
