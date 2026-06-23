import { insertArtifact, type ArtifactType, type EvidenceArtifact } from "./evidence-mapper";

export interface ExtractionResult {
  readonly artifact: EvidenceArtifact;
  readonly summaryGenerated: boolean;
}

const REMEDIATION_SUGGESTIONS: Readonly<Record<string, string>> = {
  "CC1.1": "Define and document a Code of Conduct; capture signed employee acknowledgments.",
  "CC1.2": "Schedule quarterly board review meetings with recorded minutes as evidence.",
  "CC2.1": "Enable centralized logging (AWS CloudWatch / GCP Cloud Logging) and export monthly summaries.",
  "CC3.1": "Conduct a formal risk assessment and store the signed report as a PDF artifact.",
  "CC3.2": "Configure automated risk scanning via a SIEM tool and schedule monthly exports.",
  "CC4.1": "Configure automated control evaluation reports from AWS Config or Azure Policy.",
  "CC5.1": "Export IAM policy documents as config snapshots from your cloud provider.",
  "CC6.1": "Run an AWS Config rule for MFA enforcement on IAM users and export compliance reports.",
  "CC6.2": "Export access provisioning audit logs from your IdP (Okta, Google Workspace).",
  "CC6.3": "Export role-based access review reports from AWS IAM Access Analyzer.",
  "CC6.6": "Enable AWS GuardDuty or GCP Security Command Center and export periodic findings.",
  "CC6.7": "Verify TLS enforcement across endpoints and export SSL/TLS certificate audit reports.",
  "CC6.8": "Enable endpoint malware protection (CrowdStrike, Defender) and export scan completion reports.",
  "CC7.1": "Connect AWS CloudTrail monitoring and export monthly activity summaries.",
  "CC7.2": "Configure security event alerts in your SIEM and export weekly alert history.",
  "CC7.3": "Document the security incident evaluation process and store post-incident reviews.",
  "CC7.4": "Run a tabletop incident response exercise quarterly and store the exercise report.",
  "CC7.5": "Configure breach notification workflows and export disclosure procedure documentation.",
  "CC8.1": "Enable GitHub branch protection with PR review requirements and export change audit logs.",
  "A1.1": "Connect AWS CloudWatch capacity dashboards and export monthly utilization reports.",
};

const ARTIFACT_TYPE_ICONS: Readonly<Record<ArtifactType, string>> = {
  screenshot: "📸",
  log_export: "📋",
  config_snapshot: "⚙️",
  access_review: "🔑",
};

const SOURCE_CONNECTOR_NAMES: Readonly<Record<string, string>> = {
  aws_config: "AWS Config",
  aws_cloudtrail: "AWS CloudTrail",
  aws_iam: "AWS IAM",
  aws_guardduty: "AWS GuardDuty",
  gcp_scc: "GCP Security Command Center",
  gcp_logging: "GCP Cloud Logging",
  github: "GitHub",
  okta: "Okta",
  google_workspace: "Google Workspace",
  manual_upload: "Manual Upload",
};

export function getArtifactTypeIcon(artifactType: string): string {
  return ARTIFACT_TYPE_ICONS[artifactType as ArtifactType] ?? "📄";
}

export function getSourceConnectorDisplayName(sourceConnector: string): string {
  return SOURCE_CONNECTOR_NAMES[sourceConnector] ?? sourceConnector;
}

export function getRemediationSuggestion(controlId: string): string {
  return (
    REMEDIATION_SUGGESTIONS[controlId] ??
    `Connect a cloud data source to automatically collect evidence for control ${controlId}.`
  );
}

function buildFallbackSummary(
  rawData: Record<string, unknown>,
  controlId: string,
  artifactType: string
): string {
  const keys = Object.keys(rawData).slice(0, 3).join(", ");
  const keyInfo = keys.length > 0 ? ` Captured fields: ${keys}.` : "";
  return `${artifactType.replace(/_/g, " ")} evidence collected for SOC 2 control ${controlId}.${keyInfo}`;
}

export async function generateAiSummary(
  rawData: Record<string, unknown>,
  controlId: string,
  artifactType: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com";

  if (!apiKey) {
    return buildFallbackSummary(rawData, controlId, artifactType);
  }

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a SOC 2 compliance expert. Analyze the provided evidence artifact and generate a concise 1-2 sentence summary of its compliance relevance for the given control. Focus on what the evidence demonstrates.",
          },
          {
            role: "user",
            content: `Summarize this ${artifactType.replace(/_/g, " ")} evidence for SOC 2 control ${controlId}:\n${JSON.stringify(rawData, null, 2)}`,
          },
        ],
        max_tokens: 150,
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      return buildFallbackSummary(rawData, controlId, artifactType);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content && content.length > 0
      ? content
      : buildFallbackSummary(rawData, controlId, artifactType);
  } catch {
    return buildFallbackSummary(rawData, controlId, artifactType);
  }
}

export async function extractAndStoreArtifact(
  controlId: string,
  sourceConnector: string,
  rawData: Record<string, unknown>,
  artifactType: ArtifactType
): Promise<ExtractionResult> {
  const fallback = buildFallbackSummary(rawData, controlId, artifactType);
  const extractedSummary = await generateAiSummary(rawData, controlId, artifactType);
  const summaryGenerated = extractedSummary !== fallback;

  const artifact = await insertArtifact({
    controlId,
    artifactType,
    sourceConnector,
    rawData,
    extractedSummary,
    humanVerified: false,
  });

  return { artifact, summaryGenerated };
}
