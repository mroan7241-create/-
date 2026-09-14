'use client';

import Link from 'next/link';
import { AppShell } from '../../components/AppShell';
import { WorkflowHub } from '../../components/WorkflowHub';
import { useRoleGuard } from '../../lib/use-role-guard';
import { cardStyle, secondaryButtonStyle } from '../../lib/ui';

export default function AssociationParticipationPage() {
  const { user, loading } = useRoleGuard(['ASSOCIATION']);
  if (loading || !user) return null;
  return <AppShell user={user}>
    <h1>حالة المشاركة والإغلاق</h1>
    <p>هنا تعرف جمعيتكم أين وصلت المشاركة، وما المتبقي، وهل أصبحت جاهزة للإغلاق.</p>
    <div className="journey-grid" style={{ margin: '18px 0' }}>
      <section style={cardStyle}><strong>الميثاق والتفعيل</strong><p>راجع حالة الميثاق والتجهيز من سجل المشاركة أدناه.</p><Link href="/association/covenant" style={{ ...secondaryButtonStyle, textDecoration: 'none' }}>فتح الميثاق</Link></section>
      <section style={cardStyle}><strong>التنفيذ</strong><p>المستفيدون والأجهزة والتسليمات والاعتمادات المفتوحة.</p><Link href="/association/reports" style={{ ...secondaryButtonStyle, textDecoration: 'none' }}>فتح تقرير التنفيذ</Link></section>
      <section style={cardStyle}><strong>جاهزية الإغلاق</strong><p>افحص الموانع الفعلية قبل رفع تقرير الإغلاق؛ لا يزيل تحديد الإشعار كمقروء أي مانع.</p></section>
    </div>
    <WorkflowHub user={user} sectionKeys={['participations', 'notifications']} />
  </AppShell>;
}
