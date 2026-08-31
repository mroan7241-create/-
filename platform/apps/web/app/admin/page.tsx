'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Bike,
  Building2,
  ClipboardList,
  Inbox,
  Package,
  ScrollText,
  Truck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import {
  apiFetch,
  computeProjectActivitySchedule,
  type Activity,
  type AuditLogEntry,
  type ProjectActivityScheduleSummary,
} from '../lib/api';
import { useRoleGuard } from '../lib/use-role-guard';
import { AppShell } from '../components/AppShell';
import { LoadingState, ErrorState } from '../components/States';
import { actionLabel } from '../lib/action-labels';

/**
 * لوحة تحكم ADMIN — منقولة حرفيًا (البنية/التسلسل البصري) من
 * platform/docs/design/admin-r2-2026-08-16.html: هيرو بالتحية + 4 وحدات تشغيل
 * (التسليم والتشغيل/الأجهزة/المستفيدون/الجمعيات) + وحدة أنشطة مشروع عريضة +
 * قائمة انتباه مُدرَّجة بالخطورة + سجل نشاط حديث. كل استعلام هنا حقيقي
 * (/pageSize=1، نقرأ total من الترقيم) — لا أرقام وهمية أُضيفت لملء الوحدات.
 */

const ENTITY_ICON: Record<string, LucideIcon> = {
  ASSOCIATION: Building2,
  BENEFICIARY: Users,
  DEVICE: Package,
  INVENTORY: Package,
  RECEIPT: ClipboardList,
  DELEGATE: Bike,
  DELIVERY: Truck,
  APPLICATION: Inbox,
};

function entityIcon(entityType: string): LucideIcon {
  return ENTITY_ICON[entityType] ?? ScrollText;
}

interface Counts {
  pendingApplications: number;
  associations: number;
  activeAssociations: number;
  inactiveAssociations: number;
  totalBeneficiaries: number;
  approvedBeneficiaries: number;
  beneficiariesPendingReview: number;
  rejectedBeneficiaries: number;
  warehouseDevices: number;
  allocatedDevices: number;
  damagedDevices: number;
  receiptsAwaitingConfirmation: number;
  delegates: number;
  devicesWithDelegate: number;
  devicesDelivered: number;
  deliveriesPreparing: number;
  deliveriesOutWithDelegate: number;
  deliveriesFailed: number;
}

/**
 * Hostinger/Supavisor production has a deliberately bounded database pool.
 * Each paginated API request performs a rows query plus a count query, so
 * firing every dashboard card at once can exhaust Prisma's pool and turn a
 * healthy empty dashboard into intermittent HTTP 500 responses. Keep the
 * browser-side fan-out below the pool boundary while preserving the same API
 * contracts and exact totals.
 */
export default function AdminDashboardPage() {
  const [dashboardLoadedAt] = useState(() => Date.now());
  const { user, loading: guardLoading } = useRoleGuard(['ADMIN']);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latestOps, setLatestOps] = useState<AuditLogEntry[] | null>(null);
  const [projectSchedule, setProjectSchedule] = useState<ProjectActivityScheduleSummary | null>(null);
  const [activityRange, setActivityRange] = useState<0 | 7 | 9999>(0);

  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const result = await apiFetch<{ counts: Counts; activities: Activity[]; recentOperations: AuditLogEntry[] }>('/dashboard/admin');
        setCounts(result.counts);
        setProjectSchedule(computeProjectActivitySchedule(result.activities));
        setLatestOps(result.recentOperations);
      } catch {
        setError('تعذّر تحميل بيانات لوحة التحكم.');
      }
    })();
  }, [user]);

  if (guardLoading || !user) return null;

  type Attn = { key: string; tier: 'urgent' | 'decision' | 'monitor'; count: number; tone: 'bad' | 'warn' | 'neutral'; what: string; why: string; domain: string; href: string };
  const attn: Attn[] = [];
  if (counts) {
    if (counts.deliveriesFailed > 0)
      attn.push({ key: 'failed', tier: 'urgent', count: counts.deliveriesFailed, tone: 'bad', what: 'تسليمات متعذّرة بانتظار إجراء المندوب', why: 'فشلت محاولة التسليم الأخيرة، بانتظار تأجيل أو إعادة الجهاز للمستودع', domain: 'التسليم', href: '/admin/deliveries?status=DELIVERY_FAILED' });
    if (counts.pendingApplications > 0)
      attn.push({ key: 'apps', tier: 'decision', count: counts.pendingApplications, tone: 'warn', what: 'طلبات انضمام جمعيات بانتظار المراجعة', why: 'جمعيات جديدة تنتظر قرار القبول أو الرفض', domain: 'الجمعيات', href: '/admin/applications?status=UNDER_REVIEW' });
    if (counts.beneficiariesPendingReview > 0)
      attn.push({ key: 'ben', tier: 'decision', count: counts.beneficiariesPendingReview, tone: 'warn', what: 'مستفيدون بانتظار مراجعة الاحتياجات', why: 'طلبات احتياج جديدة لم تُعتمد بعد', domain: 'المستفيدون', href: '/admin/beneficiaries?reviewStatus=UNDER_REVIEW' });
    if (counts.receiptsAwaitingConfirmation > 0)
      attn.push({ key: 'rcpt', tier: 'monitor', count: counts.receiptsAwaitingConfirmation, tone: 'neutral', what: 'محاضر استلام بانتظار تأكيد الجمعية', why: 'أُرسلت المحاضر ولم تُؤكَّد من الجمعية المستلمة بعد', domain: 'المحاضر', href: '/admin/receipts?status=AWAITING_ASSOCIATION_CONFIRMATION' });
    if (counts.inactiveAssociations > 0)
      attn.push({ key: 'inactive', tier: 'monitor', count: counts.inactiveAssociations, tone: 'neutral', what: 'جمعيات موقوفة حاليًا', why: 'حسابات موقوفة لا يمكنها الدخول', domain: 'الجمعيات', href: '/admin/associations?status=INACTIVE' });
    if (projectSchedule && projectSchedule.delayedCount > 0)
      attn.push({ key: 'delayed', tier: 'monitor', count: projectSchedule.delayedCount, tone: 'neutral', what: 'أنشطة مشروع تجاوزت موعدها المخطَّط', why: 'دون تسجيل إنجاز فعلي حتى الآن', domain: 'المتابعة', href: '/admin/activities' });
  }
  const tiers: { tier: Attn['tier']; label: string }[] = [
    { tier: 'urgent', label: 'حرج' },
    { tier: 'decision', label: 'متوسط' },
    { tier: 'monitor', label: 'منخفض' },
  ];

  const visibleOps = latestOps?.filter((op) => {
    if (activityRange === 9999) return true;
    const ageDays = (dashboardLoadedAt - new Date(op.createdAt).getTime()) / 86_400_000;
    return ageDays <= activityRange;
  });

  return (
    <AppShell user={user}>
      <header className="zad-hero2">
        <div className="zad-hero2-decor" aria-hidden="true">
          <span className="zad-hero2-ring-a" />
          <span className="zad-hero2-ring-b" />
        </div>
        <div className="zad-hero2-text">
          <h1>مرحبًا، {user.name}</h1>
          <div className="zad-hero2-fresh">نظرة عامة على العمليات الحالية</div>
        </div>
      </header>

      {error && <ErrorState message={error} />}
      {!counts && !error && <LoadingState />}
      {counts && (
        <>
          <div className="zad-section-head2">
            <div className="zad-framed-title2"><div className="zad-rule2" /><h2>وحدات التشغيل</h2></div>
          </div>

          <div className="zad-modules2">
            <div className={`zad-module2${counts.deliveriesFailed > 0 ? ' zad-critical2' : ''}`}>
              <div className="zad-module2-head">
                <span className="zad-module2-icon"><Truck size={18} strokeWidth={1.9} aria-hidden="true" /></span>
                <div>
                  <Link className="zad-module2-title-link" href="/admin/deliveries">التسليم والتشغيل</Link>
                  <div className="zad-module2-sub">حالة عمليات التسليم الجارية</div>
                </div>
              </div>
              <div className="zad-primary-block2">
                <Link className="zad-primary-figure2" href="/admin/deliveries?status=DELIVERY_FAILED">
                  <span className="zad-fig2 zad-fig-compact2">{counts.deliveriesFailed}</span>
                </Link>
                <div className="zad-primary-meaning2">تسليمات متعذّرة</div>
              </div>
              <div className="zad-secondary-row2">
                <Link className="zad-seg-col2" href="/admin/deliveries?status=PREPARING"><span className="zad-sv2 zad-c1">{counts.deliveriesPreparing}</span><span className="zad-sl2">جاهزة</span></Link>
                <Link className="zad-seg-col2" href="/admin/deliveries?status=OUT_WITH_DELEGATE"><span className="zad-sv2 zad-c2">{counts.deliveriesOutWithDelegate}</span><span className="zad-sl2">قيد التنفيذ</span></Link>
              </div>
              <div className="zad-link-rail2" role="img" aria-label={`توزيع عمليات التسليم النشطة: ${counts.deliveriesPreparing} جاهزة، ${counts.deliveriesOutWithDelegate} قيد التنفيذ`}>
                <RailSeg tone="c1" value={counts.deliveriesPreparing} total={counts.deliveriesPreparing + counts.deliveriesOutWithDelegate} />
                <RailSeg tone="c2" value={counts.deliveriesOutWithDelegate} total={counts.deliveriesPreparing + counts.deliveriesOutWithDelegate} />
              </div>
            </div>

            <div className="zad-module2">
              <div className="zad-module2-head">
                <span className="zad-module2-icon"><Package size={18} strokeWidth={1.9} aria-hidden="true" /></span>
                <div>
                  <Link className="zad-module2-title-link" href="/admin/inventory">الأجهزة</Link>
                  <div className="zad-module2-sub">من المستودع إلى التسليم</div>
                </div>
              </div>
              <div className="zad-primary-block2">
                <Link className="zad-primary-figure2" href="/admin/inventory?status=DELIVERED">
                  <span className="zad-fig2">{counts.devicesDelivered}</span>
                </Link>
                <div className="zad-primary-meaning2">جهاز تم تسليمه حتى الآن</div>
              </div>
              <div className="zad-secondary-row2">
                <Link className="zad-seg-col2" href="/admin/inventory?status=WAREHOUSE"><span className="zad-sv2 zad-c1">{counts.warehouseDevices}</span><span className="zad-sl2">بالمستودع</span></Link>
                <Link className="zad-seg-col2" href="/admin/inventory?status=ALLOCATED"><span className="zad-sv2 zad-c2">{counts.allocatedDevices}</span><span className="zad-sl2">مخصَّصة</span></Link>
                <Link className="zad-seg-col2" href="/admin/inventory?status=WITH_DELEGATE"><span className="zad-sv2 zad-c3">{counts.devicesWithDelegate}</span><span className="zad-sl2">مع المناديب</span></Link>
                <Link className="zad-seg-col2" href="/admin/inventory?status=DAMAGED"><span className="zad-sv2 zad-c-bad">{counts.damagedDevices}</span><span className="zad-sl2">معطوبة</span></Link>
              </div>
              <div className="zad-link-rail2" role="img" aria-label="توزيع الأجهزة النشطة حاليًا">
                {(() => {
                  const total = counts.warehouseDevices + counts.allocatedDevices + counts.devicesWithDelegate + counts.damagedDevices;
                  return (
                    <>
                      <RailSeg tone="c1" value={counts.warehouseDevices} total={total} />
                      <RailSeg tone="c2" value={counts.allocatedDevices} total={total} />
                      <RailSeg tone="c3" value={counts.devicesWithDelegate} total={total} />
                      <RailSeg tone="c-bad" value={counts.damagedDevices} total={total} />
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="zad-module2">
              <div className="zad-module2-head">
                <span className="zad-module2-icon"><Users size={18} strokeWidth={1.9} aria-hidden="true" /></span>
                <div>
                  <Link className="zad-module2-title-link" href="/admin/beneficiaries">المستفيدون</Link>
                  <div className="zad-module2-sub">حالة المراجعة والاعتماد</div>
                </div>
              </div>
              <div className="zad-primary-block2">
                <Link className="zad-primary-figure2" href="/admin/beneficiaries">
                  <span className="zad-fig2">{counts.totalBeneficiaries}</span>
                </Link>
                <div className="zad-primary-meaning2">مستفيدًا مسجَّلًا</div>
              </div>
              <div className="zad-secondary-row2">
                <Link className="zad-seg-col2" href="/admin/beneficiaries?reviewStatus=APPROVED"><span className="zad-sv2 zad-c-good">{counts.approvedBeneficiaries}</span><span className="zad-sl2">معتمدون</span></Link>
                <Link className="zad-seg-col2" href="/admin/beneficiaries?reviewStatus=UNDER_REVIEW"><span className="zad-sv2 zad-c2">{counts.beneficiariesPendingReview}</span><span className="zad-sl2">بانتظار المراجعة</span></Link>
                <Link className="zad-seg-col2" href="/admin/beneficiaries?reviewStatus=REJECTED"><span className="zad-sv2 zad-c-bad">{counts.rejectedBeneficiaries}</span><span className="zad-sl2">مرفوضون</span></Link>
              </div>
              <div className="zad-link-rail2" role="img" aria-label="توزيع طلبات المستفيدين حسب حالة المراجعة">
                {(() => {
                  const total = counts.approvedBeneficiaries + counts.beneficiariesPendingReview + counts.rejectedBeneficiaries;
                  return (
                    <>
                      <RailSeg tone="c-good" value={counts.approvedBeneficiaries} total={total} />
                      <RailSeg tone="c2" value={counts.beneficiariesPendingReview} total={total} />
                      <RailSeg tone="c-bad" value={counts.rejectedBeneficiaries} total={total} />
                    </>
                  );
                })()}
              </div>
            </div>

            <div className="zad-module2">
              <div className="zad-module2-head">
                <span className="zad-module2-icon"><Building2 size={18} strokeWidth={1.9} aria-hidden="true" /></span>
                <div>
                  <Link className="zad-module2-title-link" href="/admin/associations">الجمعيات</Link>
                  <div className="zad-module2-sub">الشراكات النشطة</div>
                </div>
              </div>
              <div className="zad-primary-block2">
                <Link className="zad-primary-figure2" href="/admin/associations">
                  <span className="zad-fig2">{counts.associations}</span>
                </Link>
                <div className="zad-primary-meaning2">جمعية شريكة مسجَّلة</div>
              </div>
              <div className="zad-secondary-row2">
                <Link className="zad-seg-col2" href="/admin/associations?status=ACTIVE"><span className="zad-sv2 zad-c-good">{counts.activeAssociations}</span><span className="zad-sl2">نشطة</span></Link>
                <Link className="zad-seg-col2" href="/admin/associations?status=INACTIVE"><span className="zad-sv2 zad-c-bad">{counts.inactiveAssociations}</span><span className="zad-sl2">موقوفة</span></Link>
              </div>
              <div className="zad-link-rail2" role="img" aria-label={`من إجمالي ${counts.associations} جمعية`}>
                <RailSeg tone="c-good" value={counts.activeAssociations} total={counts.associations} />
                <RailSeg tone="c-bad" value={counts.inactiveAssociations} total={counts.associations} />
              </div>
            </div>
          </div>

          <div className="zad-module2 zad-activities-wide2">
            <div className="zad-module2-head">
              <span className="zad-module2-icon"><ScrollText size={18} strokeWidth={1.9} aria-hidden="true" /></span>
              <div>
                <Link className="zad-module2-title-link" href="/admin/activities">أنشطة المشروع</Link>
                <div className="zad-module2-sub">نظرة عامة على مراحل المشروع</div>
              </div>
            </div>
            {projectSchedule ? (
              <>
                <div className="zad-secondary-row2">
                  <Link className="zad-seg-col2" href="/admin/activities"><span className="zad-sv2 zad-c1">{projectSchedule.total}</span><span className="zad-sl2">إجمالي الأنشطة</span></Link>
                  <Link className="zad-seg-col2" href="/admin/activities"><span className="zad-sv2 zad-c-good">{projectSchedule.actualCompleted}</span><span className="zad-sl2">المكتمل</span></Link>
                  <Link className="zad-seg-col2" href="/admin/activities"><span className="zad-sv2 zad-c2">{projectSchedule.delayedCount}</span><span className="zad-sl2">متأخر</span></Link>
                </div>
                <div className="zad-link-rail2" role="img" aria-label="تقدّم أنشطة المشروع">
                  <RailSeg tone="c-good" value={projectSchedule.actualCompleted} total={projectSchedule.total} />
                  <RailSeg tone="c2" value={projectSchedule.delayedCount} total={projectSchedule.total} />
                </div>
                <div className="zad-activities-context2">
                  الحالي: <b>{projectSchedule.current ? `${projectSchedule.current.order}. ${projectSchedule.current.name}` : '—'}</b>
                  {' · '}القادم: <b>{projectSchedule.upcoming ? `${projectSchedule.upcoming.order}. ${projectSchedule.upcoming.name}` : '—'}</b>
                </div>
              </>
            ) : (
              <div className="zad-activities-context2">لا يوجد جدول أنشطة بعد.</div>
            )}
          </div>

          <div className="zad-section-head2">
            <div className="zad-framed-title2"><div className="zad-rule2" /><h2>يحتاج انتباهك الآن</h2></div>
            <span className="zad-section-meta2">{attn.length} بنود</span>
          </div>

          <div className="zad-split2">
            <div className="zad-attn-tiers2">
              {attn.length === 0 && <p style={{ fontSize: 14, opacity: 0.7 }}>لا توجد عناصر معلَّقة تحتاج انتباهًا حاليًا.</p>}
              {tiers.map(({ tier, label }) => {
                const items = attn.filter((a) => a.tier === tier);
                if (items.length === 0) return null;
                return (
                  <div key={tier}>
                    <div className="zad-attn-tier-head2"><span className={`zad-tier-dot2 zad-tier-${tier}2`} /><h4>{label}</h4><span className="zad-tier-count2">{items.length}</span></div>
                    <div className="zad-attention2">
                      {items.map((a) => (
                        <a key={a.key} href={a.href} className="zad-attn-item2 zad-focusable">
                          <span className={`zad-attn-count2 zad-${a.tone}2`}>{a.count}</span>
                          <span className="zad-attn-body2"><span className="zad-what2">{a.what}</span><span className="zad-why2">{a.why}</span></span>
                          <span className="zad-attn-meta2"><span className="zad-attn-domain2">{a.domain}</span></span>
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <div className="zad-activity-toolbar2">
                <span className="zad-section-meta2">سجل النشاط الأخير</span>
                <div className="zad-range-pills2">
                  <button type="button" className="zad-range-pill2" data-active={activityRange === 0} onClick={() => setActivityRange(0)}>اليوم</button>
                  <button type="button" className="zad-range-pill2" data-active={activityRange === 7} onClick={() => setActivityRange(7)}>٧ أيام</button>
                  <button type="button" className="zad-range-pill2" data-active={activityRange === 9999} onClick={() => setActivityRange(9999)}>الكل</button>
                </div>
              </div>
              {!visibleOps || visibleOps.length === 0 ? (
                <p style={{ fontSize: 14, opacity: 0.7 }}>لا توجد عمليات مسجَّلة ضمن هذه الفترة.</p>
              ) : (
                <div className="zad-activity-panel2">
                  {visibleOps.map((op) => {
                    const EntityIcon = entityIcon(op.entityType);
                    return (
                      <div className="zad-activity-row2" key={op.id}>
                        <span className="zad-activity-icon2"><EntityIcon size={15} strokeWidth={1.8} aria-hidden="true" /></span>
                        <span className="zad-activity-main2">
                          <span className="zad-op2">{actionLabel(op.action)}</span>
                          <div className="zad-activity-actor2">{op.actorAccount ? op.actorAccount.name : 'النظام'}</div>
                        </span>
                        <span className="zad-activity-time2">{new Date(op.createdAt).toLocaleString('ar-SA')}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}

function RailSeg({ tone, value, total }: { tone: 'c1' | 'c2' | 'c3' | 'c-good' | 'c-bad'; value: number; total: number }) {
  if (value <= 0 || total <= 0) return null;
  return <span className={`zad-rail-seg2 zad-${tone}`} style={{ width: `${(value / total) * 100}%` }} />;
}
