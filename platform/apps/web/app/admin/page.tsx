'use client';

import { useEffect, useState } from 'react';
import { apiFetch, listAuditLog, type AuditLogEntry, type Paginated } from '../lib/api';
import { useRoleGuard } from '../lib/use-role-guard';
import { AppShell } from '../components/AppShell';
import { PageHeader } from '../components/PageHeader';
import { StatCard } from '../components/StatCard';
import { LoadingState, ErrorState } from '../components/States';
import { statCardGridStyle, alertListStyle, alertCardStyle } from '../components/shell-styles';
import { cardStyle, ltrStyle, mutedStyle } from '../lib/ui';

/**
 * لوحة تحكم ADMIN الحقيقية — تستبدل غلاف NODE-1 المؤقت. كل رقم هنا من
 * استعلام /pageSize=1 حقيقي (نقرأ total من الترقيم، لا نجلب كل السجلات) —
 * راجع platform/docs/PRODUCT_PARITY_MASTER.md §4. تشمل الآن بيانات
 * NODE-5/6 الحقيقية (أجهزة مع مناديب/مُسلَّمة، تسليمات فاشلة) بعد اكتمالها
 * — لا تُخترَع تنبيهات وهمية.
 */
export default function AdminDashboardPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ADMIN']);
  const [counts, setCounts] = useState<{
    pendingApplications: number;
    associations: number;
    inactiveAssociations: number;
    beneficiariesPendingReview: number;
    warehouseDevices: number;
    receiptsAwaitingSend: number;
    receiptsAwaitingConfirmation: number;
    delegates: number;
    devicesWithDelegate: number;
    devicesDelivered: number;
    deliveriesFailed: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latestOps, setLatestOps] = useState<AuditLogEntry[] | null>(null);

  useEffect(() => {
    if (!user) return;
    listAuditLog({ pageSize: 8 })
      .then((res) => setLatestOps(res.items))
      .catch(() => setLatestOps([]));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const metricErrors: string[] = [];
      const safe = (path: string) => apiFetch<Paginated<unknown>>(path).catch((cause) => {
        metricErrors.push(`${path}: ${cause instanceof Error ? cause.message : 'UNKNOWN_ERROR'}`);
        return { items: [], total: 0, page: 1, pageSize: 1, totalPages: 0 };
      });
      try {
        const [pendingApps, allAssoc, inactiveAssoc, pendingBen, whDevices, draftReceipts, awaitingReceipts, delegates, withDelegate, delivered, failedDeliveries] = await Promise.all([
          safe('/association-applications?status=UNDER_REVIEW&pageSize=1'), safe('/associations?pageSize=1'), safe('/associations?status=INACTIVE&pageSize=1'),
          safe('/beneficiaries?reviewStatus=UNDER_REVIEW&pageSize=1'), safe('/inventory/devices?status=WAREHOUSE&pageSize=1'), safe('/receipts?status=DRAFT&pageSize=1'),
          safe('/receipts?status=AWAITING_ASSOCIATION_CONFIRMATION&pageSize=1'), safe('/delegates?pageSize=1'), safe('/inventory/devices?status=WITH_DELEGATE&pageSize=1'),
          safe('/inventory/devices?status=DELIVERED&pageSize=1'), safe('/deliveries?status=DELIVERY_FAILED&pageSize=1'),
        ]);
        setCounts({
          pendingApplications: pendingApps.total,
          associations: allAssoc.total,
          inactiveAssociations: inactiveAssoc.total,
          beneficiariesPendingReview: pendingBen.total,
          warehouseDevices: whDevices.total,
          receiptsAwaitingSend: draftReceipts.total,
          receiptsAwaitingConfirmation: awaitingReceipts.total,
          delegates: delegates.total,
          devicesWithDelegate: withDelegate.total,
          devicesDelivered: delivered.total,
          deliveriesFailed: failedDeliveries.total,
        });
        setError(metricErrors.length ? `تعذّرت مؤشرات محددة: ${metricErrors.join(' | ')}` : null);
      } catch {
        setError('تعذّر تحميل بيانات لوحة التحكم.');
      }
    })();
  }, [user]);

  if (guardLoading || !user) return null;

  const alerts: { key: string; severity: 'critical' | 'high' | 'medium'; text: string; href: string }[] = [];
  if (counts) {
    if (counts.pendingApplications > 0)
      alerts.push({ key: 'apps', severity: 'high', text: `${counts.pendingApplications} طلب انضمام بانتظار المراجعة`, href: '/admin/applications?status=UNDER_REVIEW' });
    if (counts.beneficiariesPendingReview > 0)
      alerts.push({ key: 'ben', severity: 'high', text: `${counts.beneficiariesPendingReview} مستفيد بانتظار مراجعة الاحتياجات`, href: '/admin/beneficiaries?reviewStatus=UNDER_REVIEW' });
    if (counts.receiptsAwaitingConfirmation > 0)
      alerts.push({ key: 'rcpt', severity: 'medium', text: `${counts.receiptsAwaitingConfirmation} محضر استلام بانتظار تأكيد الجمعية`, href: '/admin/receipts?status=AWAITING_ASSOCIATION_CONFIRMATION' });
    if (counts.inactiveAssociations > 0)
      alerts.push({ key: 'inactive', severity: 'medium', text: `${counts.inactiveAssociations} جمعية موقوفة حاليًا`, href: '/admin/associations?status=INACTIVE' });
    if (counts.deliveriesFailed > 0)
      alerts.push({ key: 'failed-delivery', severity: 'critical', text: `${counts.deliveriesFailed} تسليم متعذّر بانتظار إعادة المحاولة`, href: '/admin/deliveries?status=DELIVERY_FAILED' });
  }

  return (
    <AppShell user={user}>
      <PageHeader title={`مرحبًا، ${user.name}`} subtitle="نظرة عامة على العمليات الحالية" />
      {error && <ErrorState message={error} />}
      {!counts && !error && <LoadingState />}
      {counts && (
        <>
          <div style={statCardGridStyle}>
            <StatCard label="طلبات انضمام بانتظار المراجعة" value={counts.pendingApplications} href="/admin/applications?status=UNDER_REVIEW" tone={counts.pendingApplications > 0 ? 'warn' : 'default'} />
            <StatCard label="مستفيدون بانتظار المراجعة" value={counts.beneficiariesPendingReview} href="/admin/beneficiaries?reviewStatus=UNDER_REVIEW" tone={counts.beneficiariesPendingReview > 0 ? 'warn' : 'default'} />
            <StatCard label="إجمالي الجمعيات" value={counts.associations} href="/admin/associations" />
            <StatCard label="أجهزة بالمستودع" value={counts.warehouseDevices} href="/admin/inventory?status=WAREHOUSE" />
            <StatCard label="محاضر بانتظار الإرسال" value={counts.receiptsAwaitingSend} href="/admin/receipts?status=DRAFT" />
            <StatCard label="محاضر بانتظار تأكيد الجمعية" value={counts.receiptsAwaitingConfirmation} href="/admin/receipts?status=AWAITING_ASSOCIATION_CONFIRMATION" />
            <StatCard label="إجمالي المناديب" value={counts.delegates} href="/admin/delegates" />
            <StatCard label="أجهزة مع مناديب" value={counts.devicesWithDelegate} href="/admin/inventory?status=WITH_DELEGATE" />
            <StatCard label="أجهزة مُسلَّمة" value={counts.devicesDelivered} href="/admin/inventory?status=DELIVERED" />
            <StatCard label="تسليمات متعذّرة" value={counts.deliveriesFailed} href="/admin/deliveries?status=DELIVERY_FAILED" tone={counts.deliveriesFailed > 0 ? 'warn' : 'default'} />
          </div>

          <h2 style={{ fontSize: 16, marginBottom: 10 }}>يحتاج انتباهك الآن</h2>
          {alerts.length === 0 ? (
            <p style={{ fontSize: 14, opacity: 0.7 }}>لا توجد عناصر معلَّقة تحتاج انتباهًا حاليًا.</p>
          ) : (
            <div style={alertListStyle}>
              {alerts.map((a) => (
                <a key={a.key} href={a.href} style={alertCardStyle(a.severity)}>
                  <span>{a.text}</span>
                  <span aria-hidden="true">←</span>
                </a>
              ))}
            </div>
          )}

          <h2 style={{ fontSize: 16, margin: '24px 0 10px' }}>آخر العمليات</h2>
          {!latestOps || latestOps.length === 0 ? (
            <p style={{ fontSize: 14, opacity: 0.7 }}>لا توجد عمليات مسجَّلة بعد.</p>
          ) : (
            <div style={{ ...cardStyle, padding: 0 }}>
              {latestOps.map((op, i) => (
                <div
                  key={op.id}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderTop: i > 0 ? '1px solid var(--line)' : 'none', fontSize: 13 }}
                >
                  <span>
                    <span style={ltrStyle}>{op.action}</span>
                    {op.actorAccount ? ` — ${op.actorAccount.name}` : ' — النظام'}
                  </span>
                  <span style={mutedStyle}>{new Date(op.createdAt).toLocaleString('ar-SA')}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
