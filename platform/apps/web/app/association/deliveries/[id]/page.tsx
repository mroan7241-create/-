'use client';

import { AppShell } from '../../../components/AppShell';
import { DeliveryDetailView } from '../../../components/DeliveryDetailView';
import { useRoleGuard } from '../../../lib/use-role-guard';

export default function AssociationDeliveryDetailPage({ params }: { params: { id: string } }) {
  const { user, loading } = useRoleGuard(['ASSOCIATION']);

  if (loading || !user) return null;

  return (
    <AppShell user={user}>
      <DeliveryDetailView missionId={params.id} listHref="/association/deliveries" />
    </AppShell>
  );
}
