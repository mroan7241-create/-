'use client';
import { AppShell } from '../../components/AppShell'; import { WorkflowHub } from '../../components/WorkflowHub'; import { useRoleGuard } from '../../lib/use-role-guard';
export default function AssociationParticipationPage() { const { user, loading } = useRoleGuard(['ASSOCIATION']); if (loading || !user) return null; return <AppShell user={user}><h1>الاتفاقيات وإغلاق المشاركة</h1><p>متابعة الاتفاقية والمنسق وتقرير الإغلاق ضمن نطاق جمعيتكم.</p><WorkflowHub user={user} sectionKeys={['participations', 'notifications']} /></AppShell>; }
