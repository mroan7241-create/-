'use client';

import { AppShell } from '../../components/AppShell';
import { useRoleGuard } from '../../lib/use-role-guard';

export default function AdminAccessEmptyPage() {
  const { user, loading } = useRoleGuard(['ADMIN']);
  if (loading || !user) return null;
  return <AppShell user={user}><h1>صلاحيات الحساب</h1><p>لم تُمنح لهذا الحساب صلاحية فتح أي قسم حاليًا. تواصل مع مدير المنصة لتحديث صلاحياتك.</p></AppShell>;
}
