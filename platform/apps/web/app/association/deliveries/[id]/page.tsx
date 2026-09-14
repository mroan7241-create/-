'use client';

import { AppShell } from '../../../components/AppShell';
import { DeliveryDetailView } from '../../../components/DeliveryDetailView';
import { useRoleGuard } from '../../../lib/use-role-guard';
import { useParams } from 'next/navigation';

export default function AssociationDeliveryDetailPage() {
  const params = useParams<{ id: string }>();
  const { user, loading } = useRoleGuard(['ASSOCIATION']);

  if (loading || !user) return null;

  return (
    <AppShell user={user}>
      <DeliveryDetailView missionId={params.id} listHref="/association/deliveries" />
    </AppShell>
  );
}
