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
 * لوحة تحكم ASSOCIATION الحقيقية — كل الاستعلامات تُصفَّى تلقائيًا على
 * مستوى الخادم لجمعية المستخدم الحالي فقط (session-scoped)، لا تمرير
 * associationId يدويًا إطلاقًا. راجع PRODUCT_PARITY_MASTER.md §4. تشمل
 * الآن بيانات NODE-5/6 الحقيقية (مناديب/تسليمات) بعد اكتمالها.
 */
export default function AssociationDashboardPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ASSOCIATION']);
  const [counts, setCounts] = useState<{
    beneficiariesTotal: number;
    beneficiariesPendingReview: number;
    receiptsAwaitingConfirmation: number;
    devicesAllocated: number;
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
        const [allBen, pendingBen, awaitingReceipts, allocatedDevices, delegates, withDelegate, delivered, failedDeliveries] = await Promise.all([
          safe('/beneficiaries?pageSize=1'), safe('/beneficiaries?reviewStatus=UNDER_REVIEW&pageSize=1'), safe('/receipts?status=AWAITING_ASSOCIATION_CONFIRMATION&pageSize=1'),
          safe('/inventory/devices?status=ALLOCATED&pageSize=1'), safe('/delegates?pageSize=1'), safe('/inventory/devices?status=WITH_DELEGATE&pageSize=1'),
          safe('/inventory/devices?status=DELIVERED&pageSize=1'), safe('/deliveries?status=DELIVERY_FAILED&pageSize=1'),
        ]);
        setCounts({
          beneficiariesTotal: allBen.total,
          beneficiariesPendingReview: pendingBen.total,
          receiptsAwaitingConfirmation: awaitingReceipts.total,
          devicesAllocated: allocatedDevices.total,
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
    if (counts.receiptsAwaitingConfirmation > 0)
      alerts.push({ key: 'rcpt', severity: 'critical', text: `${counts.receiptsAwaitingConfirmation} محضر استلام بانتظار تأكيدكم`, href: '/association/receipts?status=AWAITING_ASSOCIATION_CONFIRMATION' });
    if (counts.beneficiariesPendingReview > 0)
      alerts.push({ key: 'ben', severity: 'medium', text: `${counts.beneficiariesPendingReview} مستفيد لديكم بانتظار مراجعة الإدارة`, href: '/association/beneficiaries?reviewStatus=UNDER_REVIEW' });
    if (counts.deliveriesFailed > 0)
      alerts.push({ key: 'failed-delivery', severity: 'critical', text: `${counts.deliveriesFailed} تسليم متعذّر بانتظار إعادة المحاولة`, href: '/association/deliveries?status=DELIVERY_FAILED' });
  }

  return (
    <AppShell user={user}>
      <PageHeader title={`مرحبًا، ${user.name}`} subtitle="نظرة عامة على عمليات جمعيتكم" />
      {error && <ErrorState message={error} />}
      {!counts && !error && <LoadingState />}
      {counts && (
        <>
          <div style={statCardGridStyle}>
            <StatCard label="إجمالي المستفيدين" value={counts.beneficiariesTotal} href="/association/beneficiaries" />
            <StatCard label="بانتظار مراجعة الإدارة" value={counts.beneficiariesPendingReview} href="/association/beneficiaries?reviewStatus=UNDER_REVIEW" tone={counts.beneficiariesPendingReview > 0 ? 'warn' : 'default'} />
            <StatCard label="محاضر بانتظار تأكيدكم" value={counts.receiptsAwaitingConfirmation} href="/association/receipts?status=AWAITING_ASSOCIATION_CONFIRMATION" tone={counts.receiptsAwaitingConfirmation > 0 ? 'warn' : 'default'} />
            <StatCard label="أجهزة مخصَّصة لمستفيدين" value={counts.devicesAllocated} href="/association/inventory?status=ALLOCATED" />
            <StatCard label="مناديبنا" value={counts.delegates} href="/association/delegates" />
            <StatCard label="أجهزة مع مناديب" value={counts.devicesWithDelegate} href="/association/inventory?status=WITH_DELEGATE" />
            <StatCard label="أجهزة مُسلَّمة" value={counts.devicesDelivered} href="/association/inventory?status=DELIVERED" />
            <StatCard label="تسليمات متعذّرة" value={counts.deliveriesFailed} href="/association/deliveries?status=DELIVERY_FAILED" tone={counts.deliveriesFailed > 0 ? 'warn' : 'default'} />
          </div>

          <h2 style={{ fontSize: 16, marginBottom: 10 }}>يحتاج انتباهكم الآن</h2>
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
