'use client';
import Link from 'next/link';
import { useMemo } from 'react';
import { Building2, Users, Package, Truck, ClipboardList, ArrowUpLeft } from 'lucide-react';
import { useAbanmi } from './portal-context';
import { activityOverview, exploreHref } from './portal-model';
import { analyzeAbanmi, APPLICATION_STAGE_LABELS, type ApplicationStage } from '../lib/abanmi-analytics';

export default function AbanmiDashboardPage() {
  const { report } = useAbanmi();
  const metrics = useMemo(() => report ? analyzeAbanmi(report) : null, [report]);
  if (!report || !metrics) return null;
  const activity = activityOverview(report.activities);
  const count = (rows: Array<{ _count: { _all: number } }>) => rows.reduce((n, r) => n + r._count._all, 0);
  const cards = [
    { title: 'الجمعيات المشاركة', value: report.overall.associations, icon: Building2, href: exploreHref('associations'), note: 'التوقيع والمستفيدون ورحلة الأجهزة' },
    { title: 'المستفيدون', value: report.overall.beneficiaries, icon: Users, href: exploreHref('beneficiaries'), note: 'القرار والاحتياجات والتسليم لكل رمز مستفيد' },
    { title: 'الاحتياجات المعتمدة', value: metrics.approvedNeeds, icon: Package, href: exploreHref('needs', { status: 'APPROVED' }), note: 'أنواع الأجهزة وحالة تنفيذ الاحتياجات' },
    { title: 'التسليمات', value: report.overall.deliveries, icon: Truck, href: exploreHref('deliveries'), note: 'الحالة والمحاولات وشواهد التسليم' },
    { title: 'محاضر الاستلام', value: count(report.procurement.receipts), icon: ClipboardList, href: exploreHref('receipts'), note: 'ما أُرسل وما استُلم والكميات والفروقات' },
    { title: 'الأجهزة المسلّمة', value: metrics.deliveredDevices, icon: Package, href: exploreHref('inventory', { status: 'DELIVERED' }), note: 'التوزيع حسب الجمعية ونوع الجهاز' },
  ];
  return <>
    <header className="ab-hero"><div><span className="ab-eyebrow">مشروع الأجهزة الكهربائية</span><h1>المشروع، بصورة أوضح.</h1><p>متابعة الجمعيات والتنفيذ والشواهد. افتح أي مؤشر للاطلاع على تفاصيله.</p></div><Link className="ab-hero-link" href="/abanmi/activities">متابعة الأنشطة <ArrowUpLeft size={20} /></Link></header>
    <section className="ab-kpis" aria-label="مؤشرات المشروع">{cards.map(({ icon: Icon, ...card }) => <Link className="ab-kpi" href={card.href} key={card.title}><div><span className="ab-icon"><Icon size={21} /></span><ArrowUpLeft size={18} /></div><strong>{card.value.toLocaleString('ar-SA')}</strong><h2>{card.title}</h2><p>{card.note}</p></Link>)}</section>
    <section className="ab-section"><div className="ab-heading"><div><span className="ab-eyebrow">من التقديم إلى الاختيار</span><h2>رحلة انضمام الجمعيات</h2></div><Link href={exploreHref('applications')}>جميع الطلبات ←</Link></div><div className="ab-stages">{(Object.keys(APPLICATION_STAGE_LABELS) as ApplicationStage[]).map(stage => <Link key={stage} href={exploreHref('applications', { stage })}><strong>{metrics.stages[stage]}</strong><span>{APPLICATION_STAGE_LABELS[stage]}</span></Link>)}</div></section>
    <section className="ab-section"><div className="ab-heading"><div><span className="ab-eyebrow">القراءة التنفيذية</span><h2>ما الذي يحتاج متابعة؟</h2></div></div><div className="ab-executive"><article><span>التنفيذ</span><Link className="ab-big-link" href={exploreHref('needs', { status: 'APPROVED' })}>{metrics.progressPercent === null ? 'لا تتوفر نسبة بعد' : `${metrics.progressPercent}٪`}</Link><p>تغطية الاحتياجات المعتمدة بالأجهزة المسلّمة، وليست قياسًا للالتزام الزمني.</p><Link href={exploreHref('needs')}>تفاصيل الاحتياجات ←</Link></article><article><span>الأنشطة الجارية</span><Link className="ab-big-link" href="/abanmi/activities?status=current">{activity.current.length}</Link><p>{activity.current[0] ? activity.current[0].subActivityName ?? activity.current[0].mainActivityName : 'لا توجد أنشطة بحالة جارٍ أو متأخر.'}</p><Link href="/abanmi/activities">المنجز والقادم والشواهد ←</Link></article><article><span>المتابعة التشغيلية</span><strong>{metrics.alerts.length ? 'توجد حالات تحتاج متابعة' : 'لا حالات مرصودة'}</strong><p>المؤشرات مستقلة وقد تتداخل؛ لا نجمعها باعتبارها حالات فريدة.</p><Link href={exploreHref('deliveries')}>تفاصيل التسليمات ←</Link></article></div>
      {metrics.alerts.length > 0 && <div className="ab-alerts">{metrics.alerts.map(item => <Link key={item.label} href={item.label.includes('محاضر') ? exploreHref('receipts', { status: 'RECEIVED_WITH_DISCREPANCIES' }) : item.label.includes('تالفة') ? exploreHref('inventory', { status: 'DAMAGED' }) : exploreHref('deliveries', { status: item.label.includes('متعذرة') ? 'DELIVERY_FAILED' : item.label.includes('إرجاع') ? 'PENDING_RETURN_APPROVAL' : 'PENDING_DELIVERY_APPROVAL' })}><b>{item.count}</b><span>{item.label}</span><small>{item.action}</small></Link>)}</div>}
    </section>
    <section className="ab-section"><div className="ab-heading"><h2>مراحل التنفيذ</h2></div><div className="ab-stages">{metrics.journey.map((stage, i) => <Link key={stage.label} href={exploreHref((['participation', 'beneficiaries', 'purchaseOrders', 'receipts', 'allocations', 'deliveries', 'closure'] as const)[i], { status: i === 1 ? 'APPROVED' : i === 4 ? 'ACTIVE' : i === 5 ? 'COMPLETED' : i === 6 ? 'CLOSED' : '' })}><strong>{stage.done}</strong><span>{stage.label}</span><small>{stage.caption}</small></Link>)}</div></section>
    <section className="ab-section"><div className="ab-heading"><h2>التغطية حسب المنطقة</h2><Link href={exploreHref('associations')}>عرض الجمعيات ←</Link></div><div className="ab-regions">{metrics.regions.map(row => <Link key={row.region} href={exploreHref('associations', { region: row.region })}><span>{row.region}</span><strong>{row.associations}</strong><small>جمعية مشاركة · {row.delivered} جهاز مسلّم</small></Link>)}</div>{!metrics.regions.length && <p className="ab-empty">لا توجد جمعيات مشاركة ضمن البيانات الحالية. طلبات الانضمام متاحة في قسمها أعلاه.</p>}</section>
    <div className="ab-report-entry"><div><h2>تحتاج نسخة رسمية؟</h2><p>التقارير والتصدير في قسم مستقل، بتحديد المنطقة والجمعية والفترة.</p></div><Link className="ab-primary" href="/abanmi/reports">التقارير والتصدير</Link></div>
  </>;
}
