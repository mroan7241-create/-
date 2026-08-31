'use client';
import { AppShell } from '../../components/AppShell'; import { WorkflowHub } from '../../components/WorkflowHub'; import { useRoleGuard } from '../../lib/use-role-guard';
export default function AdminProcurementPage() { const { user, loading } = useRoleGuard(['ADMIN']); if (loading || !user) return null; return <AppShell user={user}><h1>المشتريات والشحنات</h1><p>أوامر الشراء والشحنات ومراقبة أحداث الأتمتة المتعثرة.</p><WorkflowHub user={user} sectionKeys={['procurement', 'outbox']} /></AppShell>; }
