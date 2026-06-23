import type { JSX } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/admin-auth";
import {
  getControlsWithEvidenceCounts,
  getArtifactsForControl,
  verifyArtifact,
  type Soc2Control,
  type EvidenceArtifact,
} from "@/lib/soc2/evidence-mapper";
import {
  getArtifactTypeIcon,
  getSourceConnectorDisplayName,
  getRemediationSuggestion,
} from "@/lib/soc2/artifact-extractor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ControlListItem({
  ctrl,
  isSelected,
}: {
  readonly ctrl: Soc2Control;
  readonly isSelected: boolean;
}): JSX.Element {
  return (
    <li>
      <Link
        href={`/controls/${encodeURIComponent(ctrl.id)}`}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.4rem 0.6rem",
          borderRadius: "0.375rem",
          textDecoration: "none",
          color: "inherit",
          backgroundColor: isSelected ? "var(--color-accent-soft, #eff6ff)" : "transparent",
          fontWeight: isSelected ? 600 : 400,
          fontSize: "0.875rem",
        }}
      >
        <span>{ctrl.id}</span>
        <span
          style={{
            background: ctrl.evidenceCount > 0 ? "#2563eb" : "#dc2626",
            color: "#fff",
            borderRadius: "9999px",
            padding: "0.05rem 0.45rem",
            fontSize: "0.7rem",
            fontWeight: 700,
            minWidth: "1.25rem",
            textAlign: "center",
          }}
        >
          {ctrl.evidenceCount}
        </span>
      </Link>
    </li>
  );
}

function ArtifactCard({
  artifact,
  handleVerify,
}: {
  readonly artifact: EvidenceArtifact;
  readonly handleVerify: (formData: FormData) => Promise<void>;
}): JSX.Element {
  return (
    <div
      className="card"
      style={{
        position: "relative",
        boxShadow: "0 1px 6px rgba(0,0,0,0.07), 0 0 0 1px rgba(0,0,0,0.05)",
        marginBottom: "1rem",
      }}
    >
      {artifact.humanVerified && (
        <div
          style={{
            position: "absolute",
            top: "0.75rem",
            right: "0.75rem",
            color: "#16a34a",
            fontWeight: 700,
            fontSize: "0.8rem",
            display: "flex",
            alignItems: "center",
            gap: "0.2rem",
          }}
        >
          <span>✓</span>
          <span>Verified</span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
        <span style={{ fontSize: "1.1rem" }}>{getArtifactTypeIcon(artifact.artifactType)}</span>
        <span style={{ fontWeight: 600, textTransform: "capitalize" }}>
          {artifact.artifactType.replace(/_/g, " ")}
        </span>
        <span
          style={{
            background: "#f1f5f9",
            color: "#374151",
            borderRadius: "0.25rem",
            padding: "0.1rem 0.45rem",
            fontSize: "0.72rem",
            fontWeight: 500,
          }}
        >
          {getSourceConnectorDisplayName(artifact.sourceConnector)}
        </span>
      </div>

      <p className="muted" style={{ fontSize: "0.78rem", marginBottom: "0.4rem" }}>
        Collected: {artifact.collectedAt.toLocaleString()}
      </p>

      <p style={{ marginBottom: artifact.humanVerified ? "0" : "0.75rem" }}>
        {artifact.extractedSummary}
      </p>

      {!artifact.humanVerified && (
        <form action={handleVerify}>
          <input type="hidden" name="artifactId" value={artifact.id} />
          <button type="submit" className="btn secondary" style={{ fontSize: "0.82rem" }}>
            Mark as Verified
          </button>
        </form>
      )}
    </div>
  );
}

export default async function ControlDetailPage({
  params,
}: {
  params: { id: string };
}): Promise<JSX.Element> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const controlId = decodeURIComponent(params.id);

  const [controls, artifacts] = await Promise.all([
    getControlsWithEvidenceCounts(),
    getArtifactsForControl(controlId),
  ]);

  const selectedControl = controls.find((c) => c.id === controlId);

  async function handleVerify(formData: FormData): Promise<void> {
    "use server";
    const artifactId = formData.get("artifactId");
    if (typeof artifactId === "string" && artifactId.length > 0) {
      await verifyArtifact(artifactId);
      revalidatePath(`/controls/${encodeURIComponent(controlId)}`);
    }
  }

  if (!selectedControl) {
    return (
      <main>
        <h1>Control Not Found</h1>
        <p>The control ID <code>{controlId}</code> is not a recognized SOC 2 control.</p>
        <Link href="/controls/CC6.1" className="btn">Browse Controls</Link>
      </main>
    );
  }

  return (
    <main>
      <h1>SOC 2 Evidence Mapper</h1>
      <p>
        Track and verify timestamped evidence artifacts for each SOC 2 control. Gaps highlight
        controls that still need evidence collection.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px 1fr",
          gap: "1.5rem",
          marginTop: "1.5rem",
          alignItems: "start",
        }}
      >
        {/* Left panel — control list */}
        <aside>
          <p
            className="muted"
            style={{
              fontSize: "0.72rem",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
              marginBottom: "0.5rem",
            }}
          >
            Controls
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {controls.map((ctrl) => (
              <ControlListItem
                key={ctrl.id}
                ctrl={ctrl}
                isSelected={ctrl.id === controlId}
              />
            ))}
          </ul>
        </aside>

        {/* Right panel — artifact timeline */}
        <section>
          <div style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginBottom: "0.25rem" }}>
              {selectedControl.id} — {selectedControl.name}
            </h2>
            <p className="muted">{selectedControl.description}</p>
            <span
              className="muted"
              style={{ fontSize: "0.75rem", fontStyle: "italic" }}
            >
              {selectedControl.category}
            </span>
          </div>

          {artifacts.length === 0 ? (
            <div className="empty">
              <div style={{ marginBottom: "0.75rem" }}>
                <span
                  style={{
                    display: "inline-block",
                    background: "#dc2626",
                    color: "#fff",
                    borderRadius: "9999px",
                    padding: "0.15rem 0.75rem",
                    fontSize: "0.72rem",
                    fontWeight: 700,
                  }}
                >
                  No evidence
                </span>
              </div>
              <p>No evidence artifacts have been collected for this control yet.</p>
              <p className="muted" style={{ marginTop: "0.5rem" }}>
                <strong>Suggested action:</strong> {getRemediationSuggestion(controlId)}
              </p>
            </div>
          ) : (
            <>
              <p className="muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
                {artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""} collected
              </p>
              {artifacts.map((artifact) => (
                <ArtifactCard
                  key={artifact.id}
                  artifact={artifact}
                  handleVerify={handleVerify}
                />
              ))}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
