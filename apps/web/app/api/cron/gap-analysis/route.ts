/**
 * GET /api/cron/gap-analysis — weekly SOC 2 gap analysis cron handler.
 *
 * Runs every Monday at 08:00 UTC (configure in vercel.json or external
 * scheduler: schedule "0 8 * * 1"). Compares current evidence artifact
 * state against the 20 SOC 2 control requirements, computes a readiness
 * score, generates a prioritized remediation checklist, persists the
 * report, and dispatches a Slack notification with the score delta and
 * top 3 gaps.
 *
 * Auth: Vercel sends `Authorization: Bearer <CRON_SECRET>` when
 * CRON_SECRET is set. Unguarded in dev when the env var is absent.
 */

import { NextResponse } from "next/server";
import { buildDb } from "@/lib/db";
import { runGapAnalysis } from "@/lib/soc2/gap-analyzer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // unguarded in dev; prod must set CRON_SECRET
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return new NextResponse("forbidden", { status: 403 });
  }

  const db = buildDb();

  let report;
  try {
    report = await runGapAnalysis(db);
  } catch (err) {
    console.error("[cron/gap-analysis] analysis failed:", err);
    return NextResponse.json(
      { error: String((err as Error).message ?? err) },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    report_id: report.id,
    report_date: report.report_date,
    overall_readiness_score: report.overall_readiness_score,
    gap_count: report.prioritized_gaps.length,
    critical_count: report.prioritized_gaps.filter((g) => g.severity === "Critical").length,
    high_count: report.prioritized_gaps.filter((g) => g.severity === "High").length,
  });
}
