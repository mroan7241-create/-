'use client';
import { AppShell } from '../../components/AppShell'; import { WorkflowHub } from '../../components/WorkflowHub'; import { useRoleGuard } from '../../lib/use-role-guard';
export default function AssociationOperationsPage() { const { user, loading } = useRoleGuard(['ASSOCIATION']); if (loading || !user) return null; return <AppShell user={user}><h1>متابعة دورات العمل</h1><WorkflowHub user={user} /></AppShell>; }
