import { getReadinessData } from "@/lib/soc2/readiness-score";
import type { ControlItem, ActionItem } from "@/lib/soc2/readiness-score";

const GAUGE_R = 70;
const GAUGE_CX = 90;
const GAUGE_CY = 90;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_R;

function ReadinessGauge({ score }: { score: number }) {
  const offset = GAUGE_CIRCUMFERENCE * (1 - score / 100);
  return (
    <svg
      width="180"
      height="180"
      viewBox="0 0 180 180"
      role="img"
      aria-label={`Readiness score: ${score}%`}
    >
      <circle
        cx={GAUGE_CX}
        cy={GAUGE_CY}
        r={GAUGE_R}
        fill="none"
        stroke="var(--substrate-border)"
        strokeWidth="14"
      />
      <circle
        cx={GAUGE_CX}
        cy={GAUGE_CY}
        r={GAUGE_R}
        fill="none"
        stroke="var(--substrate-accent)"
        strokeWidth="14"
        strokeDasharray={`${GAUGE_CIRCUMFERENCE} ${GAUGE_CIRCUMFERENCE}`}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${GAUGE_CX} ${GAUGE_CY})`}
      />
      <text
        x={GAUGE_CX}
        y={GAUGE_CY - 6}
        textAnchor="middle"
        fontSize="28"
        fontWeight="700"
        fill="var(--substrate-fg)"
      >
        {score}%
      </text>
      <text
        x={GAUGE_CX}
        y={GAUGE_CY + 18}
        textAnchor="middle"
        fontSize="11"
        fill="var(--substrate-muted)"
        letterSpacing="0.08em"
      >
        READINESS
      </text>
    </svg>
  );
}

function StatusPill({ status }: { status: ControlItem["status"] }) {
  const config: Record<ControlItem["status"], { label: string; cls: string }> = {
    mapped: { label: "Evidence Mapped", cls: "pill success" },
    gap: { label: "Gap", cls: "pill" },
    not_started: { label: "Not Started", cls: "pill danger" },
  };
  const { label, cls } = config[status];
  return <span className={cls}>{label}</span>;
}

function ControlCard({ item }: { item: ControlItem }) {
  return (
    <div className="card">
      <small
        className="muted"
        style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontSize: "0.75rem" }}
      >
        {item.category}
      </small>
      <p style={{ fontWeight: 600, margin: "0.35rem 0 0.6rem", lineHeight: 1.3 }}>{item.name}</p>
      <StatusPill status={item.status} />
      {item.gapDescription && (
        <p
          className="muted"
          style={{ fontSize: "0.85rem", marginTop: "0.5rem", marginBottom: 0 }}
        >
          {item.gapDescription}
        </p>
      )}
    </div>
  );
}

function TimelineBar({
  weeksToAudit,
  targetAuditDate,
}: {
  weeksToAudit: number | null;
  targetAuditDate: string | null;
}) {
  if (!targetAuditDate || weeksToAudit === null) return null;
  const totalWeeks = 26;
  const elapsed = Math.max(0, totalWeeks - weeksToAudit);
  const pct = Math.min(100, Math.round((elapsed / totalWeeks) * 100));
  const auditLabel = new Date(targetAuditDate).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>Audit Timeline</span>
        <span className="muted" style={{ fontSize: "0.85rem" }}>
          {weeksToAudit} weeks to {auditLabel}
        </span>
      </div>
      <div
        style={{
          height: "10px",
          background: "var(--substrate-border)",
          borderRadius: "999px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: "var(--substrate-border-strong)",
            borderRadius: "999px",
          }}
        />
      </div>
    </div>
  );
}

function NextActions({ actions }: { actions: ActionItem[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="card" style={{ marginTop: "1.5rem" }}>
      <h2 style={{ marginTop: 0, marginBottom: "1rem" }}>Next 3 Actions</h2>
      <ol style={{ paddingLeft: "1.25rem", margin: 0 }}>
        {actions.map((action) => (
          <li key={action.id} style={{ marginBottom: "1rem" }}>
            <strong>{action.title}</strong>
            <span className="pill" style={{ marginLeft: "0.5rem", verticalAlign: "middle" }}>
              {action.category}
            </span>
            <p
              className="muted"
              style={{ marginTop: "0.3rem", marginBottom: 0, fontSize: "0.9rem" }}
            >
              {action.description}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="empty" style={{ maxWidth: "520px", margin: "3rem auto" }}>
      <svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        style={{ margin: "0 auto 1.25rem", display: "block" }}
      >
        <rect width="64" height="64" rx="16" fill="var(--substrate-surface-2)" />
        <circle
          cx="32"
          cy="32"
          r="16"
          stroke="var(--substrate-accent)"
          strokeWidth="2.5"
          strokeDasharray="6 4"
        />
        <circle cx="32" cy="32" r="6" fill="var(--substrate-border)" />
      </svg>
      <h2 style={{ marginTop: 0, marginBottom: "0.5rem", fontSize: "1.1rem" }}>
        Connect your AWS account to get your first readiness score
      </h2>
      <p style={{ marginBottom: "1.25rem" }}>
        Once you connect a data source, we&apos;ll automatically map evidence to SOC&nbsp;2
        controls and compute your audit readiness percentage.
      </p>
      <a href="/connectors" className="btn">
        Connect a data source
      </a>
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const orgId =
    typeof searchParams.org === "string"
      ? searchParams.org
      : (process.env.DEFAULT_ORG_ID ?? "default");

  const data = await getReadinessData(orgId);

  return (
    <>
      <style>{`
        .soc2-top {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 2rem;
          align-items: start;
          margin-top: 1.5rem;
        }
        .soc2-control-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1rem;
          margin: 0.75rem 0 1.5rem;
        }
        @media (max-width: 640px) {
          .soc2-top { grid-template-columns: 1fr; }
          .soc2-control-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <h1>Audit Readiness Dashboard</h1>
      <p>Track your SOC 2 compliance progress and close evidence gaps before your audit deadline.</p>

      {!data.hasData ? (
        <EmptyState />
      ) : (
        <>
          <div className="soc2-top">
            <div style={{ textAlign: "center" }}>
              <ReadinessGauge score={data.score} />
              <p
                className="muted"
                style={{ fontSize: "0.85rem", marginTop: "0.4rem", marginBottom: 0 }}
              >
                {data.mappedControls} of {data.totalControls} controls covered
              </p>
            </div>

            <div>
              <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <div
                  className="card"
                  style={{ flex: 1, minWidth: "110px", textAlign: "center", paddingTop: "1rem" }}
                >
                  <div
                    style={{
                      fontSize: "1.75rem",
                      fontWeight: 700,
                      color: "var(--substrate-success)",
                    }}
                  >
                    {data.mappedControls}
                  </div>
                  <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                    Evidence Mapped
                  </div>
                </div>
                <div
                  className="card"
                  style={{ flex: 1, minWidth: "110px", textAlign: "center", paddingTop: "1rem" }}
                >
                  <div style={{ fontSize: "1.75rem", fontWeight: 700 }}>{data.gapControls}</div>
                  <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                    Gaps Identified
                  </div>
                </div>
                <div
                  className="card"
                  style={{ flex: 1, minWidth: "110px", textAlign: "center", paddingTop: "1rem" }}
                >
                  <div
                    style={{
                      fontSize: "1.75rem",
                      fontWeight: 700,
                      color: "var(--substrate-danger)",
                    }}
                  >
                    {data.notStartedControls}
                  </div>
                  <div className="muted" style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                    Not Started
                  </div>
                </div>
              </div>

              <TimelineBar
                weeksToAudit={data.weeksToAudit}
                targetAuditDate={data.targetAuditDate}
              />
            </div>
          </div>

          <h2>Control Status</h2>
          <div className="soc2-control-grid">
            {data.controls.map((control) => (
              <ControlCard key={control.id} item={control} />
            ))}
          </div>

          <NextActions actions={data.nextActions} />
        </>
      )}
    </>
  );
}
