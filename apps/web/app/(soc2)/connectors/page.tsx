import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/admin-auth";
import {
  getAllConnectors,
  initiateAWSAuth,
  testAWSConnection,
  isConnectorStale,
  type ConnectorRecord,
} from "@/lib/soc2/connectors/aws";

// ── Server actions ────────────────────────────────────────────────────────────

async function initiateConnect() {
  "use server";
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { authUrl, codeVerifier, state } = await initiateAWSAuth(user.id);

  const isProd = process.env.NODE_ENV === "production";
  cookies().set("aws_pkce_verifier", codeVerifier, {
    httpOnly: true,
    secure: isProd,
    maxAge: 600,
    sameSite: "lax",
    path: "/",
  });
  cookies().set("aws_pkce_state", state, {
    httpOnly: true,
    secure: isProd,
    maxAge: 600,
    sameSite: "lax",
    path: "/",
  });

  redirect(authUrl);
}

async function handleTestConnection() {
  "use server";
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const result = await testAWSConnection(user.id);

  if (result.success) {
    redirect("/connectors?testResult=success");
  } else {
    const qs = new URLSearchParams({
      testResult: "error",
      errorCode: result.errorCode ?? "unknown",
      message: result.message ?? "",
    });
    redirect(`/connectors?${qs.toString()}`);
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: ConnectorRecord["status"] }) {
  const labels: Record<ConnectorRecord["status"], string> = {
    connected: "Connected",
    syncing: "Syncing",
    error: "Error",
    not_connected: "Not connected",
  };
  const colors: Record<ConnectorRecord["status"], string> = {
    connected: "#16a34a",
    syncing: "#2563eb",
    error: "#dc2626",
    not_connected: "#6b7280",
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 10px",
        borderRadius: "9999px",
        fontSize: "0.75rem",
        fontWeight: 600,
        color: "#fff",
        backgroundColor: colors[status],
      }}
    >
      {labels[status]}
    </span>
  );
}

function formatDate(d: Date | null): string {
  if (!d) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function errorDocLink(errorCode: string | null): {
  href: string;
  label: string;
} {
  if (errorCode === "insufficient_permissions") {
    return {
      href: "https://docs.aws.amazon.com/config/latest/developerguide/required-aws-permissions.html",
      label: "View required IAM permissions →",
    };
  }
  return {
    href: "https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot_iam.html",
    label: "Troubleshoot AWS credentials →",
  };
}

function errorLabel(errorCode: string | null): string {
  if (errorCode === "insufficient_permissions") {
    return "Insufficient IAM permissions — the connected role is missing config:DescribeConfigRules. Attach AWSConfigReadOnlyAccess and reconnect.";
  }
  if (errorCode === "invalid_credentials") {
    return "Invalid or expired credentials — the access token is no longer valid. Reconnect to issue a fresh token.";
  }
  return "An unexpected error occurred. Reconnect or contact support.";
}

// ── Page ──────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: {
    connected?: string;
    testResult?: string;
    errorCode?: string;
    message?: string;
  };
}

export default async function ConnectorsPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const connectors = await getAllConnectors(user.id).catch(
    () => [] as ConnectorRecord[],
  );
  const aws = connectors.find((c) => c.provider === "aws") ?? null;
  const isStale = aws?.status === "connected" && isConnectorStale(aws.lastSyncAt, 7);

  return (
    <main>
      {/* Staleness warning banner */}
      {isStale && (
        <div
          className="card"
          style={{ borderLeft: "4px solid #f59e0b", marginBottom: "1.5rem" }}
        >
          <p style={{ margin: 0 }}>
            <strong>Warning:</strong> Your AWS Config data is more than 7 days
            old. Last synced:{" "}
            <strong>{formatDate(aws!.lastSyncAt)}</strong>. Compliance evidence
            may be outdated.
          </p>
        </div>
      )}

      {/* Connection success flash */}
      {searchParams.connected === "1" && (
        <div
          className="card"
          style={{ borderLeft: "4px solid #16a34a", marginBottom: "1.5rem" }}
        >
          <p style={{ margin: 0 }}>
            <strong>AWS Config connected.</strong> Your first sync is complete.
          </p>
        </div>
      )}

      {/* Test connection result flash */}
      {searchParams.testResult === "success" && (
        <div
          className="card"
          style={{ borderLeft: "4px solid #16a34a", marginBottom: "1.5rem" }}
        >
          <p style={{ margin: 0 }}>
            <strong>Connection test passed.</strong> AWS Config API is
            reachable with the stored credentials.
          </p>
        </div>
      )}
      {searchParams.testResult === "error" && (
        <div
          className="card"
          style={{ borderLeft: "4px solid #dc2626", marginBottom: "1.5rem" }}
        >
          <p style={{ margin: 0 }}>
            <strong>Connection test failed.</strong>{" "}
            {searchParams.message ?? "Unknown error."}
          </p>
        </div>
      )}

      <h1>Cloud Connectors</h1>
      <p>
        Connect your cloud infrastructure to pull compliance evidence
        automatically. Each connector runs on a scheduled sync and surfaces
        misconfigurations as SOC 2 control findings.
      </p>

      {/* ── AWS Config card ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}
        >
          <div>
            <h2 style={{ marginTop: 0, marginBottom: "0.25rem" }}>
              AWS Config
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              Pulls Config rules, compliance evaluations, and resource
              inventory from your AWS account via read-only SSO OAuth.
            </p>
          </div>
          {aws ? (
            <StatusPill status={aws.status} />
          ) : (
            <StatusPill status="not_connected" />
          )}
        </div>

        {aws ? (
          <>
            <table style={{ marginTop: "1rem", marginBottom: "1rem" }}>
              <tbody>
                <tr>
                  <td className="muted" style={{ paddingRight: "2rem" }}>
                    Last sync
                  </td>
                  <td>{formatDate(aws.lastSyncAt)}</td>
                </tr>
                <tr>
                  <td className="muted" style={{ paddingRight: "2rem" }}>
                    Records pulled
                  </td>
                  <td>{aws.recordCount.toLocaleString()} Config rules</td>
                </tr>
              </tbody>
            </table>

            {/* Error detail */}
            {aws.status === "error" && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fca5a5",
                  borderRadius: "6px",
                  padding: "0.75rem 1rem",
                  marginBottom: "1rem",
                }}
              >
                <p style={{ margin: "0 0 0.4rem" }}>
                  <strong>Connection error:</strong>{" "}
                  {errorLabel(aws.errorCode)}
                </p>
                <a
                  href={errorDocLink(aws.errorCode).href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="muted"
                >
                  {errorDocLink(aws.errorCode).label}
                </a>
              </div>
            )}

            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              {/* Test connection */}
              <form action={handleTestConnection}>
                <button type="submit" className="btn secondary">
                  Test connection
                </button>
              </form>

              {/* Re-authorize (reconnect) */}
              <form action={initiateConnect}>
                <button type="submit" className="btn secondary">
                  Reconnect
                </button>
              </form>
            </div>
          </>
        ) : (
          <div style={{ marginTop: "1rem" }}>
            <form action={initiateConnect}>
              <button type="submit" className="btn">
                Connect AWS
              </button>
            </form>
            <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
              Uses OAuth PKCE — no long-lived credentials stored in your
              browser. You&apos;ll be redirected to AWS SSO to authorize
              read-only access.
            </p>
          </div>
        )}
      </div>

      {/* ── GCP Security Command Center (coming soon) ────────────────────── */}
      <ComingSoonCard
        title="GCP Security Command Center"
        description="Pulls Security Command Center findings and asset inventory from your GCP organization via service account OAuth."
      />

      {/* ── GitHub (coming soon) ─────────────────────────────────────────── */}
      <ComingSoonCard
        title="GitHub"
        description="Pulls branch protection rules, secret scanning alerts, and dependency vulnerability reports via GitHub OAuth App."
      />

      {/* ── HRIS — Rippling / BambooHR (coming soon) ────────────────────── */}
      <ComingSoonCard
        title="HRIS (Rippling / BambooHR)"
        description="Pulls employee roster, role, and offboarding events to automate access-review evidence for CC6.2 and CC6.3."
      />
    </main>
  );
}

function ComingSoonCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      className="card"
      style={{ marginBottom: "1.25rem", opacity: 0.7 }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <div>
          <h2 style={{ marginTop: 0, marginBottom: "0.25rem" }}>{title}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {description}
          </p>
        </div>
        <span
          style={{
            display: "inline-block",
            padding: "2px 10px",
            borderRadius: "9999px",
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "#374151",
            backgroundColor: "#e5e7eb",
          }}
        >
          Coming soon
        </span>
      </div>
    </div>
  );
}
