export type NavLink = {
  label: string;
  href: string;
};

export type NavGroup = {
  label: string;
  links: NavLink[];
};

export type NavConfig = {
  primary: NavLink[];
  groups: NavGroup[];
};

const primaryLinks: NavLink[] = [
  { label: "Audit Readiness Dashboard", href: "/dashboard" },
  { label: "Cloud Connector Setup", href: "/connectors" },
  { label: "Policy Document Suite", href: "/policies" },
  { label: "Control Evidence Mapper", href: "/controls" },
  { label: "Gap Analysis Report", href: "/gaps" },
  { label: "Auditor Evidence Room", href: "/evidence-room" },
];

const groupedLinks: NavGroup[] = [
  {
    label: "Audit Preparation",
    links: [
      { label: "Audit Readiness Dashboard", href: "/dashboard" },
      { label: "Control Evidence Mapper", href: "/controls" },
      { label: "Gap Analysis Report", href: "/gaps" },
    ],
  },
  {
    label: "Operational Tooling",
    links: [
      { label: "Cloud Connector Setup", href: "/connectors" },
      { label: "Policy Document Suite", href: "/policies" },
      { label: "Auditor Evidence Room", href: "/evidence-room" },
    ],
  },
];

export const NAV_CONFIG: NavConfig = {
  primary: primaryLinks,
  groups: groupedLinks,
};
