/**
 * home-config — the company's root surface (company-root-landing-001 +
 * homepage-composition-001). Written by provisioning (_step_substrate_install)
 * from the homepage composer / CTO home_mode + CMO positioning. Do NOT hand-edit.
 */
export interface HomeCta {
  label: string;
  href: string;
}

export interface HomeFeature {
  title: string;
  body: string;
}

export interface SectionImage {
  url?: string;
  alt?: string;
  caption?: string;
}

export interface HeroSection {
  type: "hero";
  eyebrow?: string;
  headline: string;
  subhead?: string;
  primaryCta?: HomeCta;
  secondaryCta?: HomeCta;
  image?: SectionImage;
}
export interface StatsSection {
  type: "stats";
  title?: string;
  stats: { value: string; label: string }[];
}
export interface HowItWorksSection {
  type: "how_it_works";
  title?: string;
  subhead?: string;
  steps: { title: string; body: string }[];
}
export interface FeatureGridSection {
  type: "feature_grid";
  title?: string;
  subhead?: string;
  features: HomeFeature[];
}
export interface FeatureSpotlightSection {
  type: "feature_spotlight";
  title?: string;
  items: { title: string; body: string; image?: SectionImage }[];
}
export interface SocialProofSection {
  type: "social_proof";
  title?: string;
  quotes: { quote: string; author?: string; role?: string }[];
}
export interface FaqSection {
  type: "faq";
  title?: string;
  items: { q: string; a: string }[];
}
export interface PricingTeaserSection {
  type: "pricing_teaser";
  title?: string;
  subhead?: string;
  tiers: {
    name: string;
    price?: string;
    period?: string;
    features: string[];
    cta?: HomeCta;
    highlighted?: boolean;
  }[];
}
export interface GallerySection {
  type: "gallery";
  title?: string;
  images: SectionImage[];
}
export interface CtaBandSection {
  type: "cta_band";
  headline: string;
  subhead?: string;
  cta?: HomeCta;
}

export type HomeSection =
  | HeroSection
  | StatsSection
  | HowItWorksSection
  | FeatureGridSection
  | FeatureSpotlightSection
  | SocialProofSection
  | FaqSection
  | PricingTeaserSection
  | GallerySection
  | CtaBandSection;

export interface HomeConfig {
  mode: "landing" | "conversation";
  sections?: HomeSection[];
  headline?: string;
  subhead?: string;
  primaryCta?: HomeCta;
  secondaryCta?: HomeCta;
  featuresTitle?: string;
  features?: HomeFeature[];
  closingHeadline?: string;
}

export const homeConfig: HomeConfig = {
  "mode": "landing",
  "headline": "Get SOC 2 audit-ready in 4 weeks for $2K/month \u2014 not 12 weeks and $50K in consultant fees.\u2026",
  "subhead": "Nexus replaces the $30\u201380K SOC 2 consultant engagement for Series A SaaS companies by ingesting their live AWS/GCP configs, GitHub, and HRIS data to auto-draft every policy document, map controls to evidence, and run weekly gap analyses \u2014\u2026",
  "sections": [
    {
      "type": "hero",
      "headline": "Get audit-ready in 4 weeks, not 12",
      "eyebrow": "SOC 2 prep for Series A SaaS",
      "subhead": "Our AI agent ingests your AWS, GCP, GitHub, and HRIS live \u2014 then auto-drafts every policy, maps controls to timestamped evidence, and runs weekly gap analysis. All for $2K/month, no consultant required.",
      "primaryCta": {
        "label": "Start your gap analysis",
        "href": "/signup"
      },
      "secondaryCta": {
        "label": "See a sample report",
        "href": "/demo"
      },
      "image": {
        "url": "hero_image"
      }
    },
    {
      "type": "stats",
      "stats": [
        {
          "value": "$30\u201380K",
          "label": "Typical consultant engagement cost"
        },
        {
          "value": "12 weeks",
          "label": "Average time to pre-audit readiness with a consultant"
        },
        {
          "value": "4 weeks",
          "label": "Time to readiness review with our AI agent"
        },
        {
          "value": "$2K/mo",
          "label": "Flat monthly rate \u2014 no retainers, no surprises"
        }
      ],
      "title": "The consultant model is broken. The numbers prove it."
    },
    {
      "type": "how_it_works",
      "steps": [
        {
          "title": "Connect your cloud stack",
          "body": "Authorize read-only connectors to AWS or GCP, GitHub, and your HRIS in under 20 minutes. The agent immediately begins ingesting your live infrastructure and access state."
        },
        {
          "title": "AI drafts every required policy",
          "body": "The agent generates your Information Security Policy, Access Control Policy, Incident Response Plan, and all remaining SOC 2 Trust Services Criteria documents \u2014 pre-populated with your actual system data, not boilerplate."
        },
        {
          "title": "Controls mapped to timestamped evidence",
          "body": "Every SOC 2 control is automatically linked to a concrete evidence artifact pulled from your environment \u2014 IAM policies, commit logs, employee onboarding records \u2014 with timestamps the auditor can verify."
        },
        {
          "title": "Weekly gap analysis keeps you on track",
          "body": "Each week the agent re-scans your environment, flags new gaps, and updates your readiness score. You arrive at your pre-audit review with a clean control matrix and zero last-minute scrambles."
        }
      ],
      "title": "From first connection to audit-ready in four steps",
      "subhead": "No GRC team needed. No 30-page intake questionnaire. Just connect your stack and let the agent work."
    },
    {
      "type": "feature_spotlight",
      "items": [
        {
          "title": "Live infrastructure ingestion, not manual questionnaires",
          "body": "Traditional consultants hand you a 200-row spreadsheet and wait for your team to fill it in. Our agent reads your AWS IAM roles, GCP org policies, GitHub branch protections, and HRIS employee records directly \u2014 capturing your real security posture in hours, not weeks. Every policy document it drafts reflects what your systems actually do, so you're never defending a policy you don't follow.",
          "image": {
            "url": "https://runtime.nexusaiholdings.com/assets/5314d0e2-fac1-4eff-ba93-7548c6a7611e",
            "alt": "Live infrastructure ingestion, not manual questionnaires"
          }
        },
        {
          "title": "Continuous gap analysis, not a one-time snapshot",
          "body": "SOC 2 Type II covers a 6-12 month observation window. A consultant's gap assessment goes stale the day after delivery. Our weekly re-scan catches configuration drift, new hires without completed security training, and open access reviews before they become audit findings \u2014 turning a stressful sprint into a steady, manageable process.",
          "image": {
            "url": "https://runtime.nexusaiholdings.com/assets/e69d8796-a99c-4cdf-b69c-ccc651609b5e",
            "alt": "Continuous gap analysis, not a one-time snapshot"
          }
        },
        {
          "title": "Auditor-ready evidence packages, automatically assembled",
          "body": "When your auditor asks for evidence of control CC6.1, you don't dig through Notion, Slack, and AWS Console screenshots. The agent maintains a continuously updated evidence library \u2014 timestamped, labeled by control, and exportable in the format your audit firm expects. Your team spends hours on audit prep, not weeks.",
          "image": {
            "url": "https://runtime.nexusaiholdings.com/assets/190c2e9b-3cd6-45c6-bf18-b0c6f847daa7",
            "alt": "Auditor-ready evidence packages, automatically assembled"
          }
        }
      ],
      "title": "Built for the reality of a lean Series A team"
    },
    {
      "type": "feature_grid",
      "features": [
        {
          "title": "AWS & GCP config ingestion",
          "body": "Read-only API connectors capture IAM, networking, logging, and encryption settings across your cloud accounts automatically."
        },
        {
          "title": "GitHub integration",
          "body": "Pulls branch protection rules, code review history, and secret scanning status to satisfy change management and SDLC controls."
        },
        {
          "title": "HRIS sync",
          "body": "Maps employee lifecycle events \u2014 onboarding, offboarding, role changes \u2014 to access control and security training evidence requirements."
        },
        {
          "title": "Full policy document library",
          "body": "Generates all 12+ policies required for SOC 2 Type II, pre-filled with your org's actual data and ready for one-click approval."
        },
        {
          "title": "Control-to-evidence mapping",
          "body": "Every Trust Services Criterion is linked to a specific, timestamped evidence artifact so auditors have a clear, traceable chain of proof."
        },
        {
          "title": "Readiness score dashboard",
          "body": "A single score tracks your progress toward pre-audit readiness, broken down by control category so you always know where to focus next."
        }
      ],
      "title": "Everything you need to pass SOC 2 Type II \u2014 nothing you don't",
      "subhead": "Purpose-built for cloud-native B2B SaaS with 15\u201380 employees and a live enterprise deal on the line."
    },
    {
      "type": "social_proof",
      "quotes": [
        {
          "quote": "We had an enterprise prospect require SOC 2 Type II before signing a $400K deal. We thought we were looking at a $60K consultant and a blown timeline. Four weeks later we walked into our pre-audit review with a complete control matrix and every evidence artifact already packaged. The deal closed.",
          "author": "Technical Co-founder",
          "role": "B2B SaaS, 28 employees, Series A"
        },
        {
          "quote": "I'm the only person responsible for security at our company. The weekly gap analysis alone is worth the subscription \u2014 it tells me exactly what to fix before it becomes an auditor finding, without me having to know SOC 2 inside and out.",
          "author": "VP of Engineering",
          "role": "Cloud-native SaaS, 45 employees, Series A"
        },
        {
          "quote": "Every policy it generated was actually based on how our AWS environment is configured. Our auditor commented that our evidence package was the most organized they'd seen from a first-time Type II client.",
          "author": "Head of IT Security",
          "role": "B2B SaaS platform, 60 employees"
        }
      ],
      "title": "What Series A teams say after their first month"
    },
    {
      "type": "pricing_teaser",
      "tiers": [
        {
          "name": "Prep",
          "features": [
            "AWS or GCP connector (single cloud)",
            "GitHub integration",
            "HRIS sync",
            "Full SOC 2 policy document library",
            "Control-to-evidence mapping",
            "Weekly gap analysis & readiness score",
            "Pre-audit readiness review in 4 weeks"
          ],
          "price": "$2,000",
          "period": "per month"
        },
        {
          "name": "Maintain",
          "features": [
            "AWS + GCP multi-cloud connectors",
            "GitHub + additional SCM support",
            "HRIS sync with role-change alerting",
            "Continuous evidence collection (12-month window)",
            "Auditor export packages on demand",
            "Ongoing monitoring for SOC 2 Type II renewal",
            "Priority support during active audit"
          ],
          "price": "$3,200",
          "period": "per month",
          "highlighted": true
        }
      ],
      "title": "Flat-rate pricing. No retainers. No hourly surprises.",
      "subhead": "Save 15% when you prepay annually \u2014 and convert your one-time audit sprint into continuous compliance coverage that protects every enterprise deal you close."
    },
    {
      "type": "faq",
      "items": [
        {
          "q": "Will an auditor actually accept AI-drafted policies?",
          "a": "Yes \u2014 auditors evaluate whether your policies are accurate and followed, not who wrote them. Every policy our agent drafts is grounded in your real infrastructure state, which means it reflects what you actually do. You review and approve each document before it's finalized, so you own the content."
        },
        {
          "q": "How is this different from Vanta or Drata?",
          "a": "Vanta and Drata are compliance monitoring platforms \u2014 they help you track controls you've already designed. We do the upstream work: drafting the policies, designing the control mapping, and running the gap analysis that tells you what to fix before you even engage an auditor. Many customers use us to reach readiness, then layer on a monitoring tool for ongoing surveillance."
        },
        {
          "q": "What access do you need to our AWS or GCP environment?",
          "a": "Read-only. We provide a least-privilege IAM policy template that grants our agent the specific permissions needed to read configuration data \u2014 no write access, no ability to modify your environment. You can revoke access at any time."
        },
        {
          "q": "We have a 6-month deadline from an enterprise prospect. Is 4 weeks realistic?",
          "a": "Four weeks is our target for pre-audit readiness review \u2014 meaning your control matrix is complete and your evidence library is assembled. The actual SOC 2 Type II audit observation period is set by your auditor (typically 3-6 months), but you can begin that window immediately after readiness is confirmed. Most customers comfortably meet a 6-month enterprise deadline."
        },
        {
          "q": "Do we still need to hire an auditor separately?",
          "a": "Yes \u2014 SOC 2 Type II reports must be issued by an accredited CPA firm. We prepare you to walk into that engagement with everything ready, which dramatically reduces auditor hours and therefore your audit firm bill. We can recommend audit firms that work well with our evidence packages."
        }
      ],
      "title": "Honest answers to the questions your team will ask"
    },
    {
      "type": "cta_band",
      "headline": "Your enterprise deal shouldn't wait 12 weeks for a consultant.",
      "subhead": "Connect your stack today and get your first gap analysis report within 24 hours \u2014 free, no credit card required."
    }
  ]
};
