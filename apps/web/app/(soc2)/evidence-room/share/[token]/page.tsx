import type { JSX } from "react";
import { notFound } from "next/navigation";
import { getExportByToken } from "@/lib/soc2/evidence-exporter";
import type { PolicyItem, EvidenceArtifact } from "@/lib/soc2/evidence-exporter";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Props {
  params: { token: string };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function PolicyTable({ policies }: { policies: PolicyItem[] }): JSX.Element {
  if (policies.length === 0) {
    return (
      <div className="empty">
        <p>No approved policies in this export.</p>
      </div>
    );
  }
  return (
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Policy</th>
          <th>Category</th>
          <th>Version</th>
          <th>Approved</th>
          <th>Document</th>
        </tr>
      </thead>
      <tbody>
        {policies.map((p, idx) => (
          <tr key={p.id}>
            <td className="muted" style={{ width: "2.5rem" }}>
              {idx + 1}
            </td>
            <td style={{ fontWeight: 500 }}>{p.title}</td>
            <td className="muted">{p.category}</td>
            <td className="muted">{p.version}</td>
            <td className="muted">{formatDate(p.approvedAt)}</td>
            <td>
              {p.fileUrl ? (
                <a
                  href={p.fileUrl}
                  className="btn secondary"
                  style={{ fontSize: "0.8em" }}
                  target="_blank"
                  rel="noreferrer"
                >
                  View
                </a>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EvidenceTable({ artifacts }: { artifacts: EvidenceArtifact[] }): JSX.Element {
  if (artifacts.length === 0) {
    return (
      <div className="empty">
        <p>No verified evidence artifacts in this export.</p>
      </div>
    );
  }

  const byControl = artifacts.reduce<Record<string, EvidenceArtifact[]>>((acc, a) => {
    const key = a.controlName || a.controlId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(a);
    return acc;
  }, {});

  return (
    <table>
      <thead>
        <tr>
          <th>Control</th>
          <th>Evidence</th>
          <th>Type</th>
          <th>Verified</th>
          <th>Artifact</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(byControl).flatMap(([control, items]) =>
          items.map((a, idx) => (
            <tr key={a.id}>
              {idx === 0 ? (
                <td
                  rowSpan={items.length}
                  style={{ fontWeight: 600, verticalAlign: "top", paddingTop: "0.75rem" }}
                >
                  {control}
                </td>
              ) : null}
              <td>{a.title}</td>
              <td className="muted">{a.evidenceType}</td>
              <td className="muted">{formatDate(a.verifiedAt)}</td>
              <td>
                {a.fileUrl ? (
                  <a
                    href={a.fileUrl}
                    className="btn secondary"
                    style={{ fontSize: "0.8em" }}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View
                  </a>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

export default async function EvidenceSharePage({ params }: Props): Promise<JSX.Element> {
  const exportData = await getExportByToken(params.token);
  if (!exportData) notFound();

  const exportDate = exportData.createdAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const expiryDate = exportData.shareExpiresAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main style={{ maxWidth: "960px" }}>
      {/* Header card — branding suitable for sharing with a CPA firm */}
      <div
        className="card"
        style={{
          marginBottom: "2.5rem",
          padding: "2.5rem 2rem",
          borderLeft: "4px solid var(--substrate-accent, #1d4ed8)",
        }}
      >
        <p className="muted" style={{ fontSize: "0.8em", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
          SOC 2 Pre-Audit Evidence Package
        </p>
        <h1 style={{ marginTop: 0, fontSize: "1.75rem" }}>
          {exportData.companyName}
        </h1>
        <p style={{ marginBottom: 0 }}>
          This package was generated on <strong>{exportDate}</strong> and includes{" "}
          <strong>{exportData.policyCount} approved{" "}
          {exportData.policyCount === 1 ? "policy" : "policies"}</strong> and{" "}
          <strong>
            {exportData.evidenceCount} verified evidence{" "}
            {exportData.evidenceCount === 1 ? "artifact" : "artifacts"}
          </strong>
          .
        </p>
        <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85em" }}>
          Readiness score at time of export:{" "}
          <strong style={{ fontSize: "1rem" }}>{exportData.readinessScore}%</strong>
        </p>

        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "max-content 1fr",
            columnGap: "1.5rem",
            rowGap: "0.25rem",
            marginTop: "1.25rem",
            fontSize: "0.8em",
          }}
        >
          <dt className="muted">SHA-256</dt>
          <dd style={{ fontFamily: "monospace", wordBreak: "break-all", margin: 0 }}>
            {exportData.checksum}
          </dd>
          <dt className="muted">Link expires</dt>
          <dd style={{ margin: 0 }}>{expiryDate}</dd>
        </dl>
      </div>

      {/* Table of contents */}
      <nav style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ fontSize: "1rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Table of Contents
        </h2>
        <ol style={{ paddingLeft: "1.5rem", lineHeight: "1.9" }}>
          <li>
            <a href="#policies" style={{ textDecoration: "none" }}>
              Policy Documents ({exportData.policyCount})
            </a>
          </li>
          <li>
            <a href="#evidence" style={{ textDecoration: "none" }}>
              Evidence Artifacts ({exportData.evidenceCount})
            </a>
          </li>
        </ol>
      </nav>

      {/* Section 1 — Policies */}
      <section id="policies" style={{ marginBottom: "3rem" }}>
        <h2>1. Policy Documents</h2>
        <p className="muted">
          All documents below have been formally approved and are included in this
          evidence package.
        </p>
        <PolicyTable policies={exportData.policies} />
      </section>

      {/* Section 2 — Evidence artifacts */}
      <section id="evidence" style={{ marginBottom: "3rem" }}>
        <h2>2. Evidence Artifacts</h2>
        <p className="muted">
          Evidence is grouped by SOC 2 control. Each artifact has been verified and
          linked to its corresponding control objective.
        </p>
        <EvidenceTable artifacts={exportData.evidenceArtifacts} />
      </section>

      {/* Footer */}
      <footer
        className="muted"
        style={{
          borderTop: "1px solid var(--substrate-border, #e5e7eb)",
          paddingTop: "1.5rem",
          fontSize: "0.8em",
          lineHeight: "1.6",
        }}
      >
        <p>
          This read-only evidence package was prepared by {exportData.companyName} using
          Nexus SOC 2 Compliance Automation. It is intended for use by authorised auditors
          and CPA firms only. This link expires on {expiryDate}.
        </p>
        <p>
          Integrity verification: SHA-256{" "}
          <code style={{ fontFamily: "monospace" }}>{exportData.checksum}</code>
        </p>
      </footer>
    </main>
  );
}
