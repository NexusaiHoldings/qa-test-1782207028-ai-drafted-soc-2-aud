import type { CSSProperties } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/admin-auth";
import {
  handleAWSCallback,
  syncAWSConnector,
} from "@/lib/soc2/connectors/aws";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  };
}

interface DocLink {
  href: string;
  label: string;
}

// ── Error helpers ─────────────────────────────────────────────────────────────

function errorDetails(errorCode: string): { heading: string; body: string; docLink: DocLink } {
  if (errorCode === "insufficient_permissions") {
    return {
      heading: "Insufficient IAM permissions",
      body: "The AWS role authorized during the OAuth flow is missing the required Config permissions. Attach the AWSConfigReadOnlyAccess managed policy to the role and retry.",
      docLink: {
        href: "https://docs.aws.amazon.com/config/latest/developerguide/required-aws-permissions.html",
        label: "View required IAM permissions →",
      },
    };
  }
  if (errorCode === "invalid_credentials") {
    return {
      heading: "Invalid credentials",
      body: "AWS declined the authorization request. This can happen if the OAuth client ID is misconfigured or the user denied access. Please start the connection flow again.",
      docLink: {
        href: "https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot_iam.html",
        label: "Troubleshoot AWS credentials →",
      },
    };
  }
  return {
    heading: "Connection failed",
    body: errorCode === "access_denied"
      ? "You cancelled the AWS authorization. Return to the connectors page and try again."
      : `An unexpected error occurred (${errorCode}). Please try reconnecting.`,
    docLink: {
      href: "https://docs.aws.amazon.com/config/latest/developerguide/getting-started.html",
      label: "AWS Config documentation →",
    },
  };
}

// ── Stepper component ─────────────────────────────────────────────────────────

type StepState = "done" | "active" | "pending";

function Step({
  label,
  state,
  index,
}: {
  label: string;
  state: StepState;
  index: number;
}) {
  const circleStyle: CSSProperties = {
    width: "2rem",
    height: "2rem",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: "0.85rem",
    flexShrink: 0,
    backgroundColor:
      state === "done" ? "#16a34a" : state === "active" ? "#2563eb" : "#e5e7eb",
    color: state === "pending" ? "#6b7280" : "#fff",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <div style={circleStyle}>
        {state === "done" ? "✓" : index + 1}
      </div>
      <span
        style={{
          fontWeight: state === "active" ? 600 : 400,
          color: state === "pending" ? "#9ca3af" : "inherit",
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function AWSCallbackPage({ searchParams }: PageProps) {
  const rawCode = searchParams.code;
  const rawState = searchParams.state;
  const oauthError = searchParams.error;

  // ── 1. Handle errors returned directly by AWS OAuth ──────────────────────
  if (oauthError) {
    const detail = errorDetails(oauthError);
    return renderError(detail);
  }

  const code = Array.isArray(rawCode) ? rawCode[0] : rawCode;
  const state = Array.isArray(rawState) ? rawState[0] : rawState;

  if (!code || !state) {
    redirect("/connectors");
  }

  // ── 2. Require authenticated session ─────────────────────────────────────
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // ── 3. Validate PKCE cookie state ────────────────────────────────────────
  const cookieStore = cookies();
  const storedVerifier = cookieStore.get("aws_pkce_verifier")?.value;
  const storedState = cookieStore.get("aws_pkce_state")?.value;

  if (!storedVerifier || !storedState) {
    return renderError(
      errorDetails("invalid_credentials"),
      "OAuth session expired. Please start the connection flow again from the connectors page.",
    );
  }

  if (storedState !== state) {
    return renderError(
      errorDetails("invalid_credentials"),
      "OAuth state mismatch — possible session issue. Please start the connection flow again.",
    );
  }

  // ── 4. Exchange code for tokens ───────────────────────────────────────────
  try {
    await handleAWSCallback(code!, storedVerifier, user.id);
  } catch (err) {
    const errorCode = err instanceof Error ? err.message : "unknown";
    return renderError(errorDetails(errorCode));
  }

  // ── 5. Initial sync ───────────────────────────────────────────────────────
  let recordCount = 0;
  let syncFailed = false;
  let syncErrorCode = "";

  try {
    const result = await syncAWSConnector(user.id);
    recordCount = result.recordCount;
  } catch (err) {
    syncFailed = true;
    syncErrorCode = err instanceof Error ? err.message : "unknown";
  }

  if (syncFailed) {
    return renderError(errorDetails(syncErrorCode));
  }

  // ── 6. Success: show stepper completion then auto-redirect ────────────────
  return (
    <>
      {/* Auto-redirect after 3 s */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "setTimeout(function(){window.location.href='/connectors?connected=1';},3000);",
        }}
      />
      <main>
        <h1>AWS Config connected</h1>
        <p>
          Your AWS account is authorized and the first sync is complete.
          You will be redirected to the connectors page in a moment.
        </p>

        {/* Stepper */}
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <Step label="Authorize with AWS SSO" state="done" index={0} />
            <StepConnector done />
            <Step label="Verify read-only scope" state="done" index={1} />
            <StepConnector done />
            <Step label="First sync" state="done" index={2} />
          </div>

          {/* Progress bar — fully filled on success */}
          <div
            style={{
              marginTop: "1.5rem",
              height: "6px",
              borderRadius: "9999px",
              backgroundColor: "#e5e7eb",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: "100%",
                borderRadius: "9999px",
                backgroundColor: "#16a34a",
              }}
            />
          </div>

          <p style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            <strong>
              Pulled {recordCount.toLocaleString()} AWS Config rule
              {recordCount !== 1 ? "s" : ""}.
            </strong>{" "}
            Redirecting to connectors…
          </p>
        </div>

        <a href="/connectors?connected=1" className="btn">
          Go to connectors now
        </a>
      </main>
    </>
  );
}

// ── Inline sub-components ─────────────────────────────────────────────────────

function StepConnector({ done }: { done: boolean }) {
  return (
    <div
      style={{
        width: "2px",
        height: "1.5rem",
        backgroundColor: done ? "#16a34a" : "#e5e7eb",
        marginLeft: "0.9375rem",
      }}
    />
  );
}

function renderError(
  detail: { heading: string; body: string; docLink: DocLink },
  override?: string,
) {
  return (
    <main>
      <h1>AWS connection failed</h1>
      <p>
        There was a problem connecting your AWS account. Review the details
        below and try again.
      </p>

      {/* Stepper — stuck at step 1 */}
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <Step label="Authorize with AWS SSO" state="done" index={0} />
          <StepConnector done={false} />
          <Step label="Verify read-only scope" state="active" index={1} />
          <StepConnector done={false} />
          <Step label="First sync" state="pending" index={2} />
        </div>

        {/* Progress bar — partially filled on error */}
        <div
          style={{
            marginTop: "1.5rem",
            height: "6px",
            borderRadius: "9999px",
            backgroundColor: "#e5e7eb",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: "33%",
              borderRadius: "9999px",
              backgroundColor: "#dc2626",
            }}
          />
        </div>
      </div>

      {/* Error detail card */}
      <div
        className="card"
        style={{
          borderLeft: "4px solid #dc2626",
          marginBottom: "1.5rem",
        }}
      >
        <h2 style={{ marginTop: 0, color: "#dc2626" }}>{detail.heading}</h2>
        <p style={{ marginBottom: "0.75rem" }}>
          {override ?? detail.body}
        </p>
        <a
          href={detail.docLink.href}
          target="_blank"
          rel="noopener noreferrer"
          className="muted"
        >
          {detail.docLink.label}
        </a>
      </div>

      <a href="/connectors" className="btn secondary">
        ← Back to connectors
      </a>
    </main>
  );
}
