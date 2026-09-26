export function workflowLabel(row: Record<string, unknown>, section: string): string {
  if (section === 'participations') {
    const application = row.application as Record<string, unknown> | undefined;
    const association = row.association as Record<string, unknown> | undefined;
    const name = association?.name ?? application?.name;
    if (typeof name === 'string' && name.trim()) return `${name}${application?.publicCode ? ` — ${String(application.publicCode)}` : ''}`;
  }
  return String(row.publicCode ?? row.orderNumber ?? row.title ?? row.name ?? 'سجل تشغيلي');
}
