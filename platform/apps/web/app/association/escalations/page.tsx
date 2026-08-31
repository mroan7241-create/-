'use client';
import { AppShell } from '../../components/AppShell'; import { WorkflowHub } from '../../components/WorkflowHub'; import { useRoleGuard } from '../../lib/use-role-guard';
export default function AssociationEscalationsPage() { const { user, loading } = useRoleGuard(['ASSOCIATION']); if (loading || !user) return null; return <AppShell user={user}><h1>التصعيدات التشغيلية</h1><p>فتح التصعيدات ومتابعتها ضمن نطاق جمعيتكم.</p><WorkflowHub user={user} sectionKeys={['escalations']} /></AppShell>; }
