'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getAbanmiReport, type AbanmiReport } from '../lib/api';
import { useRoleGuard } from '../lib/use-role-guard';
import { AppShell } from '../components/AppShell';
import { ErrorState, LoadingState } from '../components/States';
const Context = createContext<{ report: AbanmiReport | null; error: string; busy: boolean; refresh: () => Promise<void> } | null>(null);
export function AbanmiPortal({ children }: { children: React.ReactNode }) {
  const { user, loading } = useRoleGuard(['ABANMI']);
  const [report, setReport] = useState<AbanmiReport | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const flight = useRef<Promise<void> | null>(null); const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (flight.current) return flight.current;
    setBusy(true); setError('');
    const request = getAbanmiReport().then(next => { if (mounted.current) setReport(next); }).catch(() => { if (mounted.current) setError('تعذّر تحديث بيانات المشروع؛ لم تُستبدل البيانات السابقة.'); }).finally(() => { flight.current = null; if (mounted.current) setBusy(false); });
    flight.current = request; return request;
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (user?.id) void refresh(); }, [user?.id, refresh]);
  if (loading || !user) return <LoadingState />;
  return <AppShell user={user}><Context.Provider value={{ report, error, busy, refresh }}><div className="ab-portal" dir="rtl"><div className="ab-toolbar"><span>بوابة أبانمي <span className="ab-badge">للمتابعة فقط</span></span><div><small>{report ? `لقطة البيانات: ${new Date(report.generatedAt).toLocaleString('ar-SA')}` : 'جارٍ جلب البيانات'}</small><button type="button" onClick={() => void refresh()} disabled={busy}>{busy ? 'جارٍ التحديث…' : 'تحديث البيانات'}</button></div></div>{error && <ErrorState message={error} />}{!report && !error ? <LoadingState /> : children}</div></Context.Provider></AppShell>;
}
export function useAbanmi() { const value = useContext(Context); if (!value) throw new Error('Abanmi provider missing'); return value; }
