'use client';

import { useEffect, useState } from 'react';
import {
  APPLICATION_STATUS_LABELS,
  ApiClientError,
  apiFetch,
  type ApplicationPublicStatus,
} from '../../lib/api';
import {
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  ltrStyle,
  mutedStyle,
  narrowPageStyle,
  primaryButtonStyle,
  statusBadgeStyle,
} from '../../lib/ui';

const LAST_SUBMITTED_KEY = 'alzad.apply.lastClientRequestId';

/**
 * متابعة حالة الطلب — تعرض ما يعرضه الخادم حرفيًا ولا شيء غيره: لا اسم
 * ولا بريد ولا جوال ولا رقم ترخيص ولا إجابات. هذا عقد خصوصية مقصود
 * (المعرّف وحده ليس إثبات هوية) — راجع ASSOCIATION_APPLICATIONS.md.
 */
export default function ApplicationStatusPage() {
  const [clientRequestId, setClientRequestId] = useState('');
  const [result, setResult] = useState<ApplicationPublicStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(LAST_SUBMITTED_KEY);
    if (stored) setClientRequestId(stored);
  }, []);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await apiFetch<ApplicationPublicStatus>(
        `/association-applications/status/${encodeURIComponent(clientRequestId.trim())}`,
      );
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر الاتصال بالخادم. حاول مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={narrowPageStyle}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>متابعة حالة طلب الانضمام</h1>
      <p style={{ ...mutedStyle, marginTop: 0, marginBottom: 24 }}>
        أدخل معرّف المتابعة الذي ظهر لك عند إرسال الطلب.
      </p>

      <form onSubmit={lookup} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={labelStyle}>
          معرّف المتابعة
          <input
            required
            value={clientRequestId}
            onChange={(e) => setClientRequestId(e.target.value)}
            style={{ ...inputStyle, ...ltrStyle }}
          />
        </label>
        <button type="submit" disabled={loading} style={primaryButtonStyle}>
          {loading ? 'جارٍ البحث…' : 'عرض الحالة'}
        </button>
        {error && (
          <p role="alert" style={errorStyle}>
            {error}
          </p>
        )}
      </form>

      {result && (
        <section style={{ ...cardStyle, marginTop: 20 }}>
          {!result.found ? (
            <p style={{ margin: 0 }}>لا يوجد طلب مطابق لهذا المعرّف.</p>
          ) : (
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 12, alignItems: 'center' }}>
              <dt>رقم الطلب</dt>
              <dd style={{ margin: 0, ...ltrStyle }}>{result.id}</dd>

              <dt>الحالة</dt>
              <dd style={{ margin: 0 }}>
                <span
                  style={statusBadgeStyle(
                    result.status === 'ACCEPTED' ? 'good' : result.status === 'REJECTED' ? 'bad' : 'neutral',
                  )}
                >
                  {result.status ? APPLICATION_STATUS_LABELS[result.status] : '—'}
                </span>
              </dd>

              <dt>تاريخ التقديم</dt>
              <dd style={{ margin: 0 }}>
                {result.submittedAt ? new Date(result.submittedAt).toLocaleDateString('ar-SA') : '—'}
              </dd>

              {result.status === 'REJECTED' && result.rejectionReason ? (
                <>
                  <dt>سبب الرفض</dt>
                  <dd style={{ margin: 0 }}>{result.rejectionReason}</dd>
                </>
              ) : null}
            </dl>
          )}
        </section>
      )}
    </main>
  );
}
