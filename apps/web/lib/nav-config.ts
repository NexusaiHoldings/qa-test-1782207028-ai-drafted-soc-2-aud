export const NAV_CONFIG = {
  primary: [
    { label: "Home", href: "/" },
    { label: "Dashboard", href: "/dashboard" },
    { label: "Connectors", href: "/connectors" },
    { label: "Policies", href: "/policies" },
    { label: "Controls", href: "/controls" },
    { label: "Gaps", href: "/gaps" },
    { label: "Evidence Room", href: "/evidence-room" },
  ],
  groups: [
    {
      title: "Audit Readiness",
      links: [
        {
          label: "Audit Readiness Dashboard",
          href: "/dashboard",
          description: "Monitor readiness status, control coverage, and auditor milestones.",
        },
        {
          label: "Gap Analysis Report",
          href: "/gaps",
          description: "Review identified gaps and track remediation progress.",
        },
        {
          label: "Control Evidence Mapper",
          href: "/controls",
          description: "Link controls to evidence and ensure coverage.",
        },
        {
          label: "Auditor Evidence Room",
          href: "/evidence-room",
          description: "Provide auditors with curated, review-ready documentation.",
        },
      ],
    },
    {
      title: "Implementation",
      links: [
        {
          label: "Cloud Connector Setup",
          href: "/connectors",
          description: "Configure and monitor integrations with cloud services.",
        },
        {
          label: "Policy Document Suite",
          href: "/policies",
          description: "Draft, review, and publish compliance policies.",
        },
      ],
    },
  ],
} as const;
