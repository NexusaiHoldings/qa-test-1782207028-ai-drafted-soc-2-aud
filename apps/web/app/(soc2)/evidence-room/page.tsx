import type { JSX } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/admin-auth";
import {
  getPreflightStatus,
  getEvidenceExports,
  createEvidenceExport,
} from "@/lib/soc2/evidence-exporter";
import type { EvidenceExport, PreflightItem } from "@/lib/soc2/evidence-exporter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleCreateExport(formData: FormData): Promise<void> {
  "use server";
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const orgId = (user as Record<string, unknown>).orgId as string | undefined;
  if (!orgId) throw new Error("No organisation found for session user.");

  await createEvidenceExport(user.id, orgId);
  redirect("/evidence-room");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function PreflightRow({ item }: { item: PreflightItem }): JSX.Element {
  const icon = item.passed ? "✓" : item.blocking ? "✗" : "⚠";
  const statusStyle: Record<string, string> = {
    "✓": "color: var(--substrate-success, #16a34a)",
    "✗": "color: var(--substrate-danger, #dc2626)",
    "⚠": "color: #b45309",
  };
  return (
    <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem" }}>
      <div>
        <strong style={Object.fromEntries(statusStyle[icon].split(";").map((s) => s.split(":").map((v) => v.trim()))) as Record<string, string>}>
          {icon} {item.label}
        </strong>
        <p className="muted" style={{ margin: "0.25rem 0 0" }}>{item.detail}</p>
      </div>
      <span className="muted" style={{ whiteSpace: "nowrap", fontSize: "0.85em" }}>
        {item.count} / {item.required}
      </span>
    </div>
  );
}

function ExportRow({ exp }: { exp: EvidenceExport }): JSX.Element {
  return (
    <tr>
      <td>{exp.createdAt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}</td>
      <td>
        <span style={{ fontWeight: 600 }}>{exp.readinessScore}%</span>
      </td>
      <td className="muted">{formatBytes(exp.fileSizeBytes)}</td>
      <td className="muted" style={{ fontSize: "0.75em", fontFamily: "monospace" }}>
        {exp.checksum.slice(0, 12)}…
      </td>
      <td>
        <a href={exp.fileUrl} className="btn secondary" style={{ fontSize: "0.85em" }}>
          Download
        </a>
      </td>
      <td>
        <a
          href={`/evidence-room/share/${exp.shareToken}`}
          className="btn secondary"
          style={{ fontSize: "0.85em" }}
          target="_blank"
          rel="noreferrer"
        >
          Share link
        </a>
      </td>
    </tr>
  );
}

export default async function EvidenceRoomPage(): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const orgId = (user as Record<string, unknown>).orgId as string | undefined;

  const [preflight, exports] = orgId
    ? await Promise.all([getPreflightStatus(orgId), getEvidenceExports(orgId)])
    : [{ canExport: false, items: [], readinessScore: 0 }, []];

  const blockingItems = preflight.items.filter((i) => i.blocking && !i.passed);

  return (
    <main>
      <h1>Auditor Evidence Room</h1>
      <p>
        Generate an immutable evidence package to share with your CPA firm for pre-audit
        readiness review. Each export is a signed, checksummed snapshot of all approved
        policies and verified evidence artifacts.
      </p>

      <section style={{ marginTop: "2rem" }}>
        <h2>Export Readiness Check</h2>
        {preflight.items.length === 0 ? (
          <div className="empty">
            <p>No compliance data found. Add policies and evidence artifacts to get started.</p>
          </div>
        ) : (
          <>
            {preflight.items.map((item) => (
              <PreflightRow key={item.label} item={item} />
            ))}

            <div style={{ marginTop: "1.5rem" }}>
              {preflight.canExport ? (
                <form action={handleCreateExport}>
                  <button type="submit" className="btn">
                    Generate Evidence Package
                  </button>
                  <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85em" }}>
                    Readiness score: <strong>{preflight.readinessScore}%</strong> — export includes{" "}
                    {preflight.items.find((i) => i.label === "Policies approved")?.count ?? 0} policies and{" "}
                    {preflight.items.find((i) => i.label === "Evidence artifacts verified")?.count ?? 0}{" "}
                    evidence artifacts.
                  </p>
                </form>
              ) : (
                <div className="empty">
                  <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                    Resolve the following before generating an export:
                  </p>
                  <ul>
                    {blockingItems.map((item) => (
                      <li key={item.label}>{item.detail}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      <section style={{ marginTop: "3rem" }}>
        <h2>Past Exports</h2>
        {exports.length === 0 ? (
          <div className="empty">
            <p>No exports yet. Run your first export above.</p>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Export Date</th>
                <th>Readiness</th>
                <th>Size</th>
                <th>SHA-256</th>
                <th>Download</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {exports.map((exp) => (
                <ExportRow key={exp.id} exp={exp} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
