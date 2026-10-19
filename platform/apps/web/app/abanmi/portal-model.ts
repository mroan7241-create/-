import type { Activity } from '../lib/api';
export const VIEWS = { applications: 'طلبات الانضمام', associations: 'الجمعيات المشاركة', beneficiaries: 'المستفيدون', needs: 'الاحتياجات', inventory: 'الأجهزة والمخزون', deliveries: 'التسليمات ومحاضر التسليم', receipts: 'محاضر الاستلام', purchaseOrders: 'أوامر الشراء', shipments: 'الشحنات', allocations: 'التخصيصات', participation: 'مشاركات الجمعيات', closure: 'إغلاق الجمعيات' } as const;
export type PortalView = keyof typeof VIEWS;
export const exploreHref = (view: PortalView, params: Record<string, string> = {}) => `/abanmi/explore?${new URLSearchParams({ view, ...Object.fromEntries(Object.entries(params).filter(([, v]) => Boolean(v))) })}`;
export const normalizeSearch = (value: string) => value.normalize('NFKC').replace(/[\u064B-\u065F\u0670ـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').trim().toLowerCase();
export const matchesSearch = (query: string, ...values: string[]) => normalizeSearch(values.join(' ')).includes(normalizeSearch(query));
export function safeEvidenceUrl(value: string | null | undefined) { if (!value) return null; try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } }
export function groupActivities(rows: Activity[]) {
  const groups = new Map<string, { key: string; phase: string; name: string; rows: Activity[] }>();
  for (const row of rows) { const key = JSON.stringify([row.phaseOrder, row.phaseName, row.mainActivityOrder, row.mainActivityName]); if (!groups.has(key)) groups.set(key, { key, phase: row.phaseName, name: row.mainActivityName, rows: [] }); groups.get(key)!.rows.push(row); }
  return [...groups.values()].sort((a, b) => a.rows[0].phaseOrder - b.rows[0].phaseOrder || a.rows[0].mainActivityOrder - b.rows[0].mainActivityOrder);
}
export function activityOverview(rows: Activity[]) { return { completed: rows.filter(r => r.status === 'COMPLETED'), current: rows.filter(r => r.status === 'IN_PROGRESS' || r.status === 'LATE'), upcoming: rows.filter(r => r.status === 'NOT_STARTED').sort((a, b) => (a.startDate ?? '9999').localeCompare(b.startDate ?? '9999')), late: rows.filter(r => r.status === 'LATE') }; }
