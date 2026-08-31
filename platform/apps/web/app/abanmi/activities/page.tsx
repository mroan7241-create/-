'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../../components/AppShell';
import { ErrorState, LoadingState } from '../../components/States';
import { ACTIVITY_STATUS_LABELS, listActivities, type Activity } from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { cardStyle } from '../../lib/ui';

export default function AbanmiActivitiesPage() {
  const { user, loading } = useRoleGuard(['ABANMI']);
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (user) listActivities().then(setActivities).catch(() => setError('تعذّر تحميل متابعة المشروع.')); }, [user]);
  if (loading || !user) return null;
  const phases = activities ? [...new Set(activities.map((row) => row.phaseName))] : [];
  return <AppShell user={user}><header className="zad-hero2"><div className="zad-hero2-text"><h1>متابعة المشروع</h1><div className="zad-hero2-fresh">تقدم المراحل والأنشطة — للقراءة فقط</div></div></header>
    {error && <ErrorState message={error} />}{!activities && !error && <LoadingState />}
    {activities && phases.map((phase) => <section key={phase} style={{ ...cardStyle, marginBottom: 18, minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}><h2>{phase}</h2><div className="table-scroll"><table><thead><tr><th>النشاط</th><th>الحالة</th><th>نسبة الإنجاز</th><th>البداية</th><th>النهاية</th><th>الشاهد</th></tr></thead><tbody>{activities.filter((row) => row.phaseName === phase).map((row) => <tr key={row.id}><td>{row.subActivityName ?? row.mainActivityName}</td><td>{ACTIVITY_STATUS_LABELS[row.status]}</td><td>{Number(row.completionPercent)}٪</td><td>{row.startDate ? new Date(row.startDate).toLocaleDateString('ar-SA') : '—'}</td><td>{row.endDate ? new Date(row.endDate).toLocaleDateString('ar-SA') : '—'}</td><td>{row.evidenceUrl ? <a href={row.evidenceUrl} target="_blank" rel="noreferrer">فتح الشاهد</a> : '—'}</td></tr>)}</tbody></table></div></section>)}
  </AppShell>;
}
