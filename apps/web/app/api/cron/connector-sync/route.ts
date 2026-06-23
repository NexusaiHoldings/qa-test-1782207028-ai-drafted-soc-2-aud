import { NextRequest, NextResponse } from "next/server";
import {
  getAllConnectorsForCron,
  syncAWSConnector,
} from "@/lib/soc2/connectors/aws";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Auth ──────────────────────────────────────────────────────────────────────

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured: allow only in development to avoid locking
    // out local cron testing. In production CRON_SECRET must be set.
    return process.env.NODE_ENV !== "production";
  }
  const authHeader = request.headers.get("authorization");
  return authHeader === `Bearer ${secret}`;
}

// ── Sync result types ─────────────────────────────────────────────────────────

interface SyncResult {
  orgId: string;
  provider: string;
  status: "synced" | "error" | "skipped";
  recordCount?: number;
  error?: string;
}

// ── Handler ───────────────────────────────────────────────────────────────────

/**
 * GET /api/cron/connector-sync
 *
 * Called by the Vercel cron scheduler (vercel.json crons entry).
 * Iterates all connectors that are due for a sync (connected + stale
 * OR stuck in 'syncing' state) and runs the appropriate provider sync.
 *
 * Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let connectors;
  try {
    connectors = await getAllConnectorsForCron();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[cron:connector-sync] failed to fetch connectors:", message);
    return NextResponse.json(
      { error: "Failed to fetch connectors", detail: message },
      { status: 500 },
    );
  }

  if (connectors.length === 0) {
    console.log("[cron:connector-sync] no connectors due for sync");
    return NextResponse.json({ synced: 0, results: [] });
  }

  const results: SyncResult[] = [];

  for (const connector of connectors) {
    if (connector.provider === "aws") {
      try {
        const { recordCount } = await syncAWSConnector(connector.orgId);
        console.log(
          `[cron:connector-sync] org=${connector.orgId} provider=aws synced recordCount=${recordCount}`,
        );
        results.push({
          orgId: connector.orgId,
          provider: "aws",
          status: "synced",
          recordCount,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error(
          `[cron:connector-sync] org=${connector.orgId} provider=aws error:`,
          message,
        );
        results.push({
          orgId: connector.orgId,
          provider: "aws",
          status: "error",
          error: message,
        });
      }
    } else {
      // Provider not yet implemented — mark skipped for observability
      results.push({
        orgId: connector.orgId,
        provider: connector.provider,
        status: "skipped",
      });
    }
  }

  const synced = results.filter((r) => r.status === "synced").length;
  const errored = results.filter((r) => r.status === "error").length;

  console.log(
    `[cron:connector-sync] complete — synced=${synced} errors=${errored} total=${results.length}`,
  );

  return NextResponse.json({
    synced,
    errored,
    total: results.length,
    results,
  });
}
