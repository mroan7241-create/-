'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, listAuditLog, type AuditLogEntry, type Paginated } from '../lib/api';
import { useRoleGuard } from '../lib/use-role-guard';
import { AppShell } from '../components/AppShell';
import { LoadingState, ErrorState } from '../components/States';
import { actionLabel } from '../lib/action-labels';

/**
 * لوحة تحكم ASSOCIATION — منقولة حرفيًا (البنية/التسلسل البصري) من
 * platform/docs/design/association-r2-2026-08-16.html: هوية مختلفة عمدًا عن
 * admin — استعلام إجراء أولًا "ماذا يحتاج إجراء مني الآن؟" (queue-grid من
 * فئات عمل حقيقية) بدل بطاقات KPI، ثم نظرة عامة رقمية أهدأ، ثم آخر العمليات.
 * كل استعلام هنا حقيقي ومُصفّى خادميًا لجمعية المستخدم الحالي فقط. فئة "طلبات
 * تصحيح إثبات" من المرجع أُسقطت عمدًا: لا حالة/حقل حقيقي قابل للاستعلام
 * لهذا العدد حاليًا في المخطط، ولا يجوز اختراع صفر دائم يُقرأ كقيمة محسوبة.
 */
export default function AssociationDashboardPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ASSOCIATION']);
  const todayLabel = new Date().toLocaleDateString('ar-SA-u-ca-gregory', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const [counts, setCounts] = useState<{
    beneficiariesTotal: number;
    beneficiariesPendingReview: number;
    receiptsAwaitingConfirmation: number;
    devicesAllocated: number;
    delegates: number;
    devicesWithDelegate: number;
    devicesDelivered: number;
    deliveriesPendingApproval: number;
    deliveriesPendingReturnApproval: number;
    deliveriesDeferred: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latestOps, setLatestOps] = useState<AuditLogEntry[] | null>(null);

  useEffect(() => {
    if (!user) return;
    listAuditLog({ pageSize: 6 })
      .then((res) => setLatestOps(res.items))
      .catch(() => setLatestOps([]));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const [
          allBen,
          pendingBen,
          awaitingReceipts,
          allocatedDevices,
          delegates,
          withDelegate,
          delivered,
          pendingApproval,
          pendingReturnApproval,
          deferred,
        ] = await Promise.all([
          apiFetch<Paginated<unknown>>('/beneficiaries?pageSize=1'),
          apiFetch<Paginated<unknown>>('/beneficiaries?reviewStatus=UNDER_REVIEW&pageSize=1'),
          apiFetch<Paginated<unknown>>('/receipts?status=AWAITING_ASSOCIATION_CONFIRMATION&pageSize=1'),
          apiFetch<Paginated<unknown>>('/inventory/devices?status=ALLOCATED&pageSize=1'),
          apiFetch<Paginated<unknown>>('/delegates?pageSize=1'),
          apiFetch<Paginated<unknown>>('/inventory/devices?status=WITH_DELEGATE&pageSize=1'),
          apiFetch<Paginated<unknown>>('/inventory/devices?status=DELIVERED&pageSize=1'),
          apiFetch<Paginated<unknown>>('/deliveries?status=PENDING_DELIVERY_APPROVAL&pageSize=1'),
          apiFetch<Paginated<unknown>>('/deliveries?status=PENDING_RETURN_APPROVAL&pageSize=1'),
          apiFetch<Paginated<unknown>>('/deliveries?status=DEFERRED&pageSize=1'),
        ]);
        setCounts({
          beneficiariesTotal: allBen.total,
          beneficiariesPendingReview: pendingBen.total,
          receiptsAwaitingConfirmation: awaitingReceipts.total,
          devicesAllocated: allocatedDevices.total,
          delegates: delegates.total,
          devicesWithDelegate: withDelegate.total,
          devicesDelivered: delivered.total,
          deliveriesPendingApproval: pendingApproval.total,
          deliveriesPendingReturnApproval: pendingReturnApproval.total,
          deliveriesDeferred: deferred.total,
        });
      } catch {
        setError('تعذّر تحميل بيانات لوحة التحكم.');
      }
    })();
  }, [user]);

  if (guardLoading || !user) return null;

  const queues = counts
    ? [
        { key: 'approval', n: counts.deliveriesPendingApproval, t: 'تسليمات بانتظار الاعتماد', d: 'إثبات وصل، بانتظار مراجعتكم', href: '/association/deliveries?status=PENDING_DELIVERY_APPROVAL' },
        { key: 'return', n: counts.deliveriesPendingReturnApproval, t: 'إعادة بانتظار الاستلام الفعلي', d: 'جهاز عائد من مندوب', href: '/association/deliveries?status=PENDING_RETURN_APPROVAL' },
        { key: 'receipt', n: counts.receiptsAwaitingConfirmation, t: 'محضر استلام يحتاج تأكيدكم', d: 'وصل من إدارة الزاد', href: '/association/receipts?status=AWAITING_ASSOCIATION_CONFIRMATION' },
        { key: 'ben', n: counts.beneficiariesPendingReview, t: 'مستفيدون يحتاجون إجراء', d: 'بانتظار مراجعة إدارة الزاد', href: '/association/beneficiaries?reviewStatus=UNDER_REVIEW' },
        { key: 'deferred', n: counts.deliveriesDeferred, t: 'تسليمات مؤجَّلة', d: 'بانتظار إعادة الجدولة', href: '/association/deliveries?status=DEFERRED' },
      ]
    : [];

  return (
    <AppShell user={user}>
      <header className="zad-hero2">
        <div className="zad-hero2-decor" aria-hidden="true">
          <span className="zad-hero2-ring-a" />
          <span className="zad-hero2-ring-b" />
        </div>
        <div className="zad-hero2-text">
          <h1>مرحبًا، {user.name}</h1>
          <div className="zad-hero2-fresh">نظرة عامة على عمليات جمعيتكم</div>
        </div>
        <span className="zad-hero2-chip">{todayLabel}</span>
      </header>

      {error && <ErrorState message={error} />}
      {!counts && !error && <LoadingState />}
      {counts && (
        <>
          <div className="zad-action-hero2">
            <h2>ماذا يحتاج إجراء مني الآن؟</h2>
            <div className="zad-ah-sub2">فئات العمل الحقيقية المبنية على حالتكم الحالية. الصفر يعني لا يوجد عنصر فعلي حاليًا.</div>
            <div className="zad-queue-grid2">
              {queues.map((q) => (
                <a key={q.key} href={q.href} className={`zad-queue-card2${q.n === 0 ? ' zad-is-empty2' : ''}`}>
                  <span className="zad-qn2">{q.n}</span>
                  <span>
                    <span className="zad-qt2" style={{ display: 'block' }}>{q.t}</span>
                    <span className="zad-qd2" style={{ display: 'block' }}>{q.d}</span>
                  </span>
                </a>
              ))}
            </div>
          </div>

          <div className="zad-section-head2">
            <div className="zad-framed-title2"><div className="zad-rule2" /><h2>نظرة عامة</h2></div>
          </div>
          <div className="zad-summary-strip2">
            <Link className="zad-sum-card2" href="/association/beneficiaries"><div className="zad-sv2b">{counts.beneficiariesTotal}</div><div className="zad-sl2b">إجمالي المستفيدين</div></Link>
            <span className="zad-sum-card2"><div className="zad-sv2b">{counts.devicesAllocated}</div><div className="zad-sl2b">أجهزة مخصَّصة</div></span>
            <Link className="zad-sum-card2" href="/association/delegates"><div className="zad-sv2b">{counts.delegates}</div><div className="zad-sl2b">مناديبنا</div></Link>
            <Link className="zad-sum-card2" href="/association/deliveries"><div className="zad-sv2b">{counts.devicesWithDelegate}</div><div className="zad-sl2b">أجهزة مع مناديب</div></Link>
            <span className="zad-sum-card2"><div className="zad-sv2b">{counts.devicesDelivered}</div><div className="zad-sl2b">أجهزة مُسلَّمة</div></span>
          </div>

          <div className="zad-section-head2">
            <div className="zad-framed-title2"><div className="zad-rule2" /><h2>آخر العمليات</h2></div>
          </div>
          {!latestOps || latestOps.length === 0 ? (
            <p style={{ fontSize: 14, opacity: 0.7 }}>لا توجد عمليات مسجَّلة بعد.</p>
          ) : (
            <div className="zad-rlist2">
              {latestOps.map((op) => (
                <div className="zad-rcard2" key={op.id} style={{ cursor: 'default' }}>
                  <div className="zad-rcard2-top">
                    <span className="zad-rcard2-name">{actionLabel(op.action)}</span>
                    <span className="zad-section-meta2">{new Date(op.createdAt).toLocaleString('ar-SA')}</span>
                  </div>
                  <div className="zad-rcard2-line">{op.actorAccount ? op.actorAccount.name : 'النظام'}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
