'use client';
import { AppShell } from '../../components/AppShell'; import { WorkflowHub } from '../../components/WorkflowHub'; import { useRoleGuard } from '../../lib/use-role-guard';
export default function AdminEscalationsPage() { const { user, loading } = useRoleGuard(['ADMIN']); if (loading || !user) return null; return <AppShell user={user}><h1>التصعيدات وضوابط SLA</h1><p>معالجة التصعيدات وضبط تقويم أيام العمل دون قيم مفترضة.</p><WorkflowHub user={user} sectionKeys={['escalations']} /></AppShell>; }
