import { revalidatePath } from 'next/cache';
import {
  getPolicies,
  getPolicy,
  markSectionReviewed,
  updatePolicyStatus,
  canExportPolicy,
} from '@/lib/soc2/policy-generator';
import type { PolicyDocument, PolicySection, PolicyStatus, PolicyVersion } from '@/lib/soc2/policy-generator';

const STATUS_LABELS: Record<PolicyStatus, string> = {
  draft: 'Draft',
  under_review: 'Under Review',
  approved: 'Approved',
  exported: 'Exported',
};

const STATUS_COLORS: Record<PolicyStatus, string> = {
  draft: '#6b7280',
  under_review: '#d97706',
  approved: '#16a34a',
  exported: '#2563eb',
};

function StatusBadge({ status }: { status: PolicyStatus }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: '12px',
        fontSize: '0.78rem',
        fontWeight: 600,
        color: '#fff',
        background: STATUS_COLORS[status],
        letterSpacing: '0.02em',
      }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function ConfidenceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = score >= 0.85 ? '#16a34a' : score >= 0.75 ? '#ca8a04' : '#dc2626';
  return (
    <span
      className="muted"
      style={{ fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
    >
      <span
        style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      AI confidence: {pct}%
    </span>
  );
}

function VersionTimeline({ versions }: { versions: PolicyVersion[] }) {
  return (
    <details style={{ marginBottom: '1.5rem', border: '1px solid var(--border)', borderRadius: '6px', padding: '0' }}>
      <summary
        style={{
          cursor: 'pointer',
          padding: '0.75rem 1rem',
          fontWeight: 600,
          fontSize: '0.9rem',
          userSelect: 'none',
          listStyle: 'none',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>Version History ({versions.length} version{versions.length !== 1 ? 's' : ''})</span>
        <span className="muted" style={{ fontSize: '0.8rem', fontWeight: 400 }}>Click to expand</span>
      </summary>
      <div style={{ padding: '0 1rem 1rem', borderTop: '1px solid var(--border)' }}>
        {versions.map((ver, idx) => (
          <div
            key={ver.id}
            style={{
              display: 'flex',
              gap: '1rem',
              padding: '0.75rem 0',
              borderBottom: idx < versions.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                background: idx === 0 ? 'var(--accent, #2563eb)' : 'var(--border)',
                color: idx === 0 ? '#fff' : 'inherit',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '0.85rem',
                flexShrink: 0,
              }}
            >
              v{ver.version}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                {ver.generated_by === 'ai' ? 'AI Generated' : 'Human Edit'}
              </div>
              <div className="muted" style={{ fontSize: '0.8rem' }}>
                {new Date(ver.generated_at).toLocaleString()} &middot; {ver.changelog}
              </div>
              <div className="muted" style={{ fontSize: '0.8rem', marginTop: '2px' }}>
                {ver.sections.length} sections &middot;{' '}
                {ver.sections.filter((s) => s.confidence_score >= 0.75 || s.reviewed).length} reviewed
              </div>
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

function PolicySectionView({
  section,
  policyId,
  handleReview,
}: {
  section: PolicySection;
  policyId: string;
  handleReview: (formData: FormData) => Promise<void>;
}) {
  const isLowConfidence = section.confidence_score < 0.75;
  const needsReview = isLowConfidence && !section.reviewed;

  return (
    <div
      id={`section-${section.id}`}
      style={{
        marginBottom: '2rem',
        borderRadius: '6px',
        overflow: 'hidden',
        border: needsReview ? '1px solid #f59e0b' : '1px solid var(--border)',
      }}
    >
      {needsReview && (
        <div
          style={{
            background: '#fffbeb',
            borderBottom: '1px solid #f59e0b',
            padding: '0.6rem 1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.875rem',
            color: '#92400e',
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: '1rem' }}>&#9888;</span>
          Review recommended &mdash; AI confidence low
        </div>
      )}
      <div
        style={{
          padding: '1.25rem 1.5rem',
          background: needsReview
            ? '#fffdf5'
            : section.reviewed
            ? '#f0fdf4'
            : 'transparent',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>{section.title}</h3>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <ConfidenceBar score={section.confidence_score} />
            {section.reviewed && (
              <span style={{ fontSize: '0.8rem', color: '#16a34a', fontWeight: 600 }}>
                &#10003; Reviewed
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            fontSize: '18px',
            lineHeight: 1.7,
            color: 'inherit',
            background: needsReview ? 'rgba(245, 158, 11, 0.07)' : 'transparent',
            borderRadius: '4px',
            padding: needsReview ? '0.75rem' : '0',
          }}
        >
          <p style={{ margin: 0 }}>{section.content}</p>
        </div>

        {needsReview && (
          <form action={handleReview} style={{ marginTop: '1rem' }}>
            <input type="hidden" name="section_id" value={section.id} />
            <input type="hidden" name="policy_id" value={policyId} />
            <button type="submit" className="btn secondary" style={{ fontSize: '0.875rem' }}>
              Mark Section as Reviewed
            </button>
            <span className="muted" style={{ marginLeft: '0.75rem', fontSize: '0.8rem' }}>
              Export blocked until all low-confidence sections are reviewed
            </span>
          </form>
        )}
      </div>
    </div>
  );
}

export default async function PolicyEditorPage({
  params,
}: {
  params: { id: string };
}) {
  const [policy, allPolicies] = await Promise.all([
    getPolicy(params.id),
    getPolicies(),
  ]);

  if (!policy) {
    return (
      <main>
        <h1>Policy Not Found</h1>
        <p>
          The requested policy could not be found.{' '}
          <a href="/policies">Back to policy suite</a>
        </p>
      </main>
    );
  }

  const exportable = canExportPolicy(policy);
  const lowConfidenceCount = policy.current_version.sections.filter(
    (s) => s.confidence_score < 0.75 && !s.reviewed
  ).length;

  async function handleMarkReviewed(formData: FormData) {
    'use server';
    const sectionId = formData.get('section_id') as string;
    const policyId = formData.get('policy_id') as string;
    await markSectionReviewed(policyId, sectionId);
    revalidatePath(`/policies/${policyId}`);
  }

  async function handleStatusChange(formData: FormData) {
    'use server';
    const newStatus = formData.get('status') as PolicyStatus;
    await updatePolicyStatus(policy!.id, newStatus);
    revalidatePath(`/policies/${policy!.id}`);
  }

  async function handleExport(formData: FormData) {
    'use server';
    const policyIdVal = formData.get('policy_id') as string;
    await updatePolicyStatus(policyIdVal, 'exported');
    revalidatePath(`/policies/${policyIdVal}`);
    revalidatePath('/policies');
  }

  return (
    <main style={{ maxWidth: '100%', padding: 0 }}>
      <style>{`
        .policy-layout { display: flex; gap: 0; min-height: 80vh; }
        .policy-sidebar { width: 260px; flex-shrink: 0; border-right: 1px solid var(--border, #e5e7eb); padding: 1.5rem 1rem; }
        .policy-editor { flex: 1; min-width: 0; padding: 1.5rem 2rem; overflow-y: auto; }
        .sidebar-policy-link { display: block; padding: 0.6rem 0.75rem; border-radius: 6px; text-decoration: none; color: inherit; margin-bottom: 0.25rem; }
        .sidebar-policy-link:hover { background: var(--hover, #f3f4f6); }
        .sidebar-policy-link.active { background: var(--active, #eff6ff); font-weight: 600; }
        @media (max-width: 768px) { .policy-layout { flex-direction: column; } .policy-sidebar { width: 100%; border-right: none; border-bottom: 1px solid var(--border, #e5e7eb); } }
      `}</style>

      <div className="policy-layout">
        {/* Left Sidebar */}
        <aside className="policy-sidebar">
          <div style={{ fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }} className="muted">
            SOC 2 Policies
          </div>
          {allPolicies.map((pol) => (
            <a
              key={pol.id}
              href={`/policies/${pol.id}`}
              className={`sidebar-policy-link${pol.id === policy.id ? ' active' : ''}`}
            >
              <div style={{ fontSize: '0.875rem', lineHeight: 1.4 }}>{pol.title}</div>
              <div style={{ marginTop: '3px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    padding: '1px 7px',
                    borderRadius: '10px',
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    color: '#fff',
                    background: STATUS_COLORS[pol.status],
                  }}
                >
                  {STATUS_LABELS[pol.status]}
                </span>
              </div>
            </a>
          ))}
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border, #e5e7eb)' }}>
            <a href="/policies" className="muted" style={{ fontSize: '0.8rem', textDecoration: 'none' }}>
              &#8592; All Policies
            </a>
          </div>
        </aside>

        {/* Main Editor */}
        <div className="policy-editor">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <h1 style={{ margin: '0 0 0.25rem' }}>{policy.title}</h1>
              <p className="muted" style={{ margin: 0, fontSize: '0.875rem' }}>
                Version {policy.current_version.version} &middot; Generated by AI &middot;{' '}
                {new Date(policy.current_version.generated_at).toLocaleDateString()}
                {lowConfidenceCount > 0 && (
                  <span style={{ color: '#d97706', marginLeft: '0.75rem' }}>
                    &#9888; {lowConfidenceCount} section{lowConfidenceCount !== 1 ? 's' : ''} need{lowConfidenceCount === 1 ? 's' : ''} review
                  </span>
                )}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <StatusBadge status={policy.status} />
              <form action={handleStatusChange}>
                <select
                  name="status"
                  defaultValue={policy.status}
                  style={{ fontSize: '0.85rem', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border, #e5e7eb)' }}
                >
                  <option value="draft">Draft</option>
                  <option value="under_review">Under Review</option>
                  <option value="approved">Approved</option>
                </select>
                <button type="submit" className="btn secondary" style={{ marginLeft: '0.5rem', fontSize: '0.8rem', padding: '4px 10px' }}>
                  Update
                </button>
              </form>
              {exportable ? (
                <form action={handleExport}>
                  <input type="hidden" name="policy_id" value={policy.id} />
                  <button type="submit" className="btn" style={{ fontSize: '0.85rem' }}>
                    Export to Evidence Room
                  </button>
                </form>
              ) : (
                <button disabled className="btn" style={{ opacity: 0.5, cursor: 'not-allowed', fontSize: '0.85rem' }} title="Review all flagged sections before exporting">
                  Export to Evidence Room
                </button>
              )}
            </div>
          </div>

          {lowConfidenceCount > 0 && (
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #f59e0b',
                borderRadius: '6px',
                padding: '0.75rem 1rem',
                marginBottom: '1.5rem',
                fontSize: '0.875rem',
                color: '#92400e',
              }}
            >
              <strong>&#9888; {lowConfidenceCount} section{lowConfidenceCount !== 1 ? 's' : ''} blocked from export.</strong>{' '}
              Review and approve AI-generated content with confidence below 75% before exporting this policy to the evidence room.
            </div>
          )}

          <VersionTimeline versions={policy.versions} />

          {policy.current_version.sections.map((section) => (
            <PolicySectionView
              key={section.id}
              section={section}
              policyId={policy.id}
              handleReview={handleMarkReviewed}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
