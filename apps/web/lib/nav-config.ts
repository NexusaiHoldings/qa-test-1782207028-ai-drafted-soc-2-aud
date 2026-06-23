export interface NavLink {
  label: string;
  href: string;
  icon?: string;
}

export interface NavGroup {
  label: string;
  links: NavLink[];
}

export interface NavConfig {
  primary: NavLink[];
  groups: NavGroup[];
}

export const NAV_CONFIG: NavConfig = {
  primary: [
    { label: "Audit Readiness Dashboard", href: "/dashboard" },
    { label: "Cloud Connector Setup", href: "/connectors" },
    { label: "Policy Document Suite", href: "/policies" },
    { label: "Control Evidence Mapper", href: "/controls" },
    { label: "Gap Analysis Report", href: "/gaps" },
    { label: "Auditor Evidence Room", href: "/evidence-room" },
  ],
  groups: [
    {
      label: "Governance",
      links: [
        { label: "Policy Document Suite", href: "/policies" },
        { label: "Control Evidence Mapper", href: "/controls" },
      ],
    },
    {
      label: "Audit",
      links: [
        { label: "Audit Readiness Dashboard", href: "/dashboard" },
        { label: "Gap Analysis Report", href: "/gaps" },
        { label: "Auditor Evidence Room", href: "/evidence-room" },
      ],
    },
    {
      label: "Integrations",
      links: [{ label: "Cloud Connector Setup", href: "/connectors" }],
    },
  ],
};
