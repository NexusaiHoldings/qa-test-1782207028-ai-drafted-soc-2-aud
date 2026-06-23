import type { JSX } from "react";
import { buildDb } from "@/lib/db";
import {
  getLatestReport,
  getReportHistory,
  type GapReport,
  type GapSeverity,
  type PrioritizedGap,
  type GapStatus,
} from "@/lib/soc2/gap-analyzer";

// ── Severity display helpers ─────────────────────────────────────────────────

const SEVERITY_BG: Record<GapSeverity, string> = {
  Critical: "#dc2626",
  High: "#ea580c",
  Medium: "#d97706",
  Low: "#16a34a",
};

function SeverityPill({ severity }: { severity: GapSeverity }): JSX.Element {
  return (
    <span
      style={{
        background: SEVERITY_BG[severity],
        color: "#fff",
        padding: "2px 10px",
        borderRadius: "9999px",
        fontSize: "12px",
        fontWeight: 600,
        display: "inline-block",
        whiteSpace: "nowrap",
      }}
    >
      {severity}
    </span>
  );
}

// ── Readiness score ring ─────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }): JSX.Element {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const fill = circ * (score / 100);
  const color = score >= 80 ? "#16a34a" : score >= 60 ? "#d97706" : "#dc2626";
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-label={`${score}% readiness`}>
      <circle cx="48" cy="48" r={r} fill="none" stroke="#e5e7eb" strokeWidth="8" />
      <circle
        cx="48"
        cy="48"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeDasharray={`${fill} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 48 48)"
      />
      <text x="48" y="53" textAnchor="middle" fontSize="18" fontWeight="700" fill={color}>
        {score}%
      </text>
    </svg>
  );
}

// ── Sparkline (last N weeks of scores) ───────────────────────────────────────

function Sparkline({ reports }: { reports: GapReport[] }): JSX.Element | null {
  if (reports.length < 2) return null;
  const scores = [...reports].reverse().map((r) => r.overall_readiness_score);
  const W = 220;
  const H = 48;
  const minS = Math.min(...scores);
  const maxS = Math.max(...scores);
  const range = maxS - minS || 1;
  const pts = scores
    .map((s, i) => {
      const x = (i / (scores.length - 1)) * W;
      const y = H - ((s - minS) / range) * (H - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = scores[scores.length - 1];
  const prev = scores[scores.length - 2];
  const delta = last - prev;
  const trendColor = delta >= 0 ? "#16a34a" : "#dc2626";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        aria-label="8-week readiness trend"
        style={{ overflow: "visible" }}
      >
        <polyline
          points={pts}
          fill="none"
          stroke={trendColor}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {scores.map((s, i) => {
          const x = (i / (scores.length - 1)) * W;
          const y = H - ((s - minS) / range) * (H - 8) - 4;
          return (
            <circle key={i} cx={x} cy={y} r="3" fill={trendColor} />
          );
        })}
      </svg>
      <span style={{ fontSize: "13px", color: trendColor, fontWeight: 600 }}>
        {delta >= 0 ? "+" : ""}
        {delta}% vs last week
      </span>
    </div>
  );
}

// ── Per-control status table ─────────────────────────────────────────────────

function ControlStatusTable({ statuses }: { statuses: GapStatus[] }): JSX.Element {
  const STATUS_LABEL: Record<string, { label: string; color: string }> = {
    met: { label: "Met", color: "#16a34a" },
    partial: { label: "Partial", color: "#d97706" },
    not_met: { label: "Not Met", color: "#dc2626" },
  };
  return (
    <table>
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>Control</th>
          <th style={{ textAlign: "left" }}>Category</th>
          <th style={{ textAlign: "center" }}>Status</th>
          <th style={{ textAlign: "center" }}>Evidence</th>
          <th style={{ textAlign: "left" }}>Notes</th>
        </tr>
      </thead>
      <tbody>
        {statuses.map((s) => {
          const { label, color } = STATUS_LABEL[s.status] ?? { label: s.status, color: "#6b7280" };
          return (
            <tr key={s.control_id}>
              <td>
                <strong>{s.control_id}</strong>
                <br />
                <span className="muted" style={{ fontSize: "13px" }}>
                  {s.control_name}
                </span>
              </td>
              <td className="muted" style={{ fontSize: "13px" }}>
                {s.category}
              </td>
              <td style={{ textAlign: "center" }}>
                <span style={{ color, fontWeight: 600, fontSize: "13px" }}>{label}</span>
              </td>
              <td style={{ textAlign: "center" }}>{s.evidence_count}</td>
              <td className="muted" style={{ fontSize: "13px" }}>
                {s.notes}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Prioritized gap table ────────────────────────────────────────────────────

function GapTable({ gaps }: { gaps: PrioritizedGap[] }): JSX.Element {
  if (gaps.length === 0) {
    return (
      <div className="empty">
        <strong>All 20 controls are evidenced.</strong>
        <p>No gaps to remediate — maintain your evidence freshness and schedule the next review.</p>
      </div>
    );
  }
  return (
    <table>
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>Control</th>
          <th style={{ textAlign: "center" }}>Severity</th>
          <th style={{ textAlign: "center" }}>Est. Effort</th>
          <th style={{ textAlign: "left" }}>Remediation Steps</th>
        </tr>
      </thead>
      <tbody>
        {gaps.map((g) => (
          <tr key={g.control_id}>
            <td>
              <strong>{g.control_id}</strong>
              <br />
              <span className="muted" style={{ fontSize: "13px" }}>
                {g.control_name}
              </span>
            </td>
            <td style={{ textAlign: "center" }}>
              <SeverityPill severity={g.severity} />
            </td>
            <td style={{ textAlign: "center", fontWeight: 600 }}>{g.estimated_effort}</td>
            <td>
              <ol style={{ margin: 0, paddingLeft: "1.2em" }}>
                {g.remediation_steps.map((step, idx) => (
                  <li key={idx} style={{ fontSize: "13px", marginBottom: "2px" }}>
                    {step}
                  </li>
                ))}
              </ol>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── History table ────────────────────────────────────────────────────────────

function HistoryTable({ reports }: { reports: GapReport[] }): JSX.Element {
  if (reports.length === 0) {
    return (
      <div className="empty">
        <p>No historical reports yet. Reports accumulate each Monday after the cron runs.</p>
      </div>
    );
  }
  return (
    <table>
      <thead>
        <tr>
          <th style={{ textAlign: "left" }}>Week of</th>
          <th style={{ textAlign: "center" }}>Readiness</th>
          <th style={{ textAlign: "center" }}>Total Gaps</th>
          <th style={{ textAlign: "center" }}>Critical</th>
          <th style={{ textAlign: "center" }}>High</th>
          <th style={{ textAlign: "center" }}>Controls Met</th>
        </tr>
      </thead>
      <tbody>
        {reports.map((r) => {
          const critCount = r.prioritized_gaps.filter((g) => g.severity === "Critical").length;
          const highCount = r.prioritized_gaps.filter((g) => g.severity === "High").length;
          const metCount = r.per_control_gap_status.filter((s) => s.status === "met").length;
          const total = r.per_control_gap_status.length;
          return (
            <tr key={r.id}>
              <td>{r.report_date}</td>
              <td style={{ textAlign: "center", fontWeight: 600 }}>
                {r.overall_readiness_score}%
              </td>
              <td style={{ textAlign: "center" }}>{r.prioritized_gaps.length}</td>
              <td style={{ textAlign: "center" }}>
                {critCount > 0 ? (
                  <span style={{ color: "#dc2626", fontWeight: 600 }}>{critCount}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td style={{ textAlign: "center" }}>
                {highCount > 0 ? (
                  <span style={{ color: "#ea580c", fontWeight: 600 }}>{highCount}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td style={{ textAlign: "center" }}>
                {metCount}/{total}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function GapsPage({
  searchParams,
}: {
  searchParams: { history?: string };
}): Promise<JSX.Element> {
  const db = buildDb();
  const [latest, history] = await Promise.all([
    getLatestReport(db).catch(() => null),
    getReportHistory(db, 8).catch(() => [] as GapReport[]),
  ]);

  const showHistory = searchParams.history === "1";
  const criticalCount = latest?.prioritized_gaps.filter((g) => g.severity === "Critical").length ?? 0;
  const highCount = latest?.prioritized_gaps.filter((g) => g.severity === "High").length ?? 0;
  const metCount = latest?.per_control_gap_status.filter((s) => s.status === "met").length ?? 0;
  const totalControls = latest?.per_control_gap_status.length ?? 20;

  return (
    <main>
      <h1>SOC 2 Weekly Gap Analysis</h1>
      <p>
        Automated weekly comparison of evidence artifacts against 20 SOC 2 Trust Services
        Criteria controls. Runs every Monday at 08:00 UTC — replacing your consultant&apos;s
        manual gap review.
      </p>

      {latest === null ? (
        <div className="empty">
          <strong>No gap report generated yet.</strong>
          <p>
            The first report will be generated on the next Monday cron run at 08:00 UTC.
            You can trigger it manually by calling{" "}
            <code>/api/cron/gap-analysis</code>.
          </p>
        </div>
      ) : (
        <>
          {/* ── Score + trend row ───────────────────────────────────── */}
          <div
            className="card"
            style={{ display: "flex", gap: "2rem", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "1.5rem" }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
              <ScoreRing score={latest.overall_readiness_score} />
              <span className="muted" style={{ fontSize: "12px" }}>
                Overall Readiness
              </span>
            </div>

            <div style={{ flex: 1, minWidth: 220 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                  gap: "1rem",
                  marginBottom: "1rem",
                }}
              >
                <div>
                  <div style={{ fontSize: "24px", fontWeight: 700, color: "#16a34a" }}>
                    {metCount}
                  </div>
                  <div className="muted" style={{ fontSize: "12px" }}>
                    Controls Met
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "24px",
                      fontWeight: 700,
                      color: criticalCount > 0 ? "#dc2626" : "#6b7280",
                    }}
                  >
                    {criticalCount}
                  </div>
                  <div className="muted" style={{ fontSize: "12px" }}>
                    Critical Gaps
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontSize: "24px",
                      fontWeight: 700,
                      color: highCount > 0 ? "#ea580c" : "#6b7280",
                    }}
                  >
                    {highCount}
                  </div>
                  <div className="muted" style={{ fontSize: "12px" }}>
                    High Gaps
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "24px", fontWeight: 700 }}>{totalControls}</div>
                  <div className="muted" style={{ fontSize: "12px" }}>
                    Total Controls
                  </div>
                </div>
              </div>

              {history.length >= 2 && (
                <div>
                  <div className="muted" style={{ fontSize: "12px", marginBottom: "0.25rem" }}>
                    8-week readiness trend
                  </div>
                  <Sparkline reports={history} />
                </div>
              )}
            </div>

            <div className="muted" style={{ fontSize: "12px", minWidth: 100 }}>
              Report date
              <br />
              <strong style={{ color: "inherit" }}>{latest.report_date}</strong>
            </div>
          </div>

          {/* ── Executive summary ───────────────────────────────────── */}
          <div
            className="card"
            style={{
              borderLeft: "4px solid #2563eb",
              marginBottom: "1.5rem",
              background: "rgba(37,99,235,0.04)",
            }}
          >
            <h2 style={{ fontSize: "15px", marginTop: 0 }}>Executive Summary</h2>
            {latest.executive_summary.split("\n\n").map((para, idx) => (
              <p key={idx} style={{ margin: "0 0 0.75rem" }}>
                {para}
              </p>
            ))}
          </div>

          {/* ── Prioritized gap table ───────────────────────────────── */}
          <h2>Prioritized Remediation Checklist</h2>
          <p className="muted">
            {latest.prioritized_gaps.length} open gap(s) sorted by risk severity. Resolve Critical
            items this week.
          </p>
          <GapTable gaps={latest.prioritized_gaps} />

          {/* ── Per-control status breakdown ────────────────────────── */}
          <h2 style={{ marginTop: "2rem" }}>Control-by-Control Status</h2>
          <p className="muted">
            Full status across all 20 SOC 2 controls based on linked evidence artifacts.
          </p>
          <ControlStatusTable statuses={latest.per_control_gap_status} />

          {/* ── History toggle ──────────────────────────────────────── */}
          <div style={{ marginTop: "2rem" }}>
            {showHistory ? (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "0.75rem",
                  }}
                >
                  <h2 style={{ margin: 0 }}>Report History (last 8 weeks)</h2>
                  <a href="/gaps" className="btn secondary">
                    Hide history
                  </a>
                </div>
                <HistoryTable reports={history} />
              </>
            ) : (
              <a href="/gaps?history=1" className="btn secondary">
                View history
              </a>
            )}
          </div>
        </>
      )}
    </main>
  );
}
