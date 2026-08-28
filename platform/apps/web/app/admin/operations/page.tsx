'use client';
import { AppShell } from '../../components/AppShell'; import { WorkflowHub } from '../../components/WorkflowHub'; import { useRoleGuard } from '../../lib/use-role-guard';
export default function AdminOperationsPage() { const { user, loading } = useRoleGuard(['ADMIN']); if (loading || !user) return null; return <AppShell user={user}><h1>إدارة دورات العمل</h1><WorkflowHub user={user} /></AppShell>; }
