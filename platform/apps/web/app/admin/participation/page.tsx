'use client';
import { AppShell } from '../../components/AppShell'; import { WorkflowHub } from '../../components/WorkflowHub'; import { useRoleGuard } from '../../lib/use-role-guard';
export default function AdminParticipationPage() { const { user, loading } = useRoleGuard(['ADMIN']); if (loading || !user) return null; return <AppShell user={user}><h1>الاتفاقيات والتجهيز والتفعيل</h1><p>متابعة المشاركات من الاتفاقية حتى التفعيل والإغلاق.</p><WorkflowHub user={user} sectionKeys={['participations', 'project-closure', 'notifications']} /></AppShell>; }
