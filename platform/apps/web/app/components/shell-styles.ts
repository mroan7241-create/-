import type { CSSProperties } from 'react';

/**
 * أنماط هيكل التطبيق المشترك (AppShell/Sidebar/TopBar) — نفس منهجية
 * app/lib/ui.ts (كائنات CSSProperties مصدَّرة، لا مكتبة UI ثقيلة). راجع
 * platform/docs/PRODUCT_PARITY_MASTER.md §4 لسبب بناء هذا الآن.
 */

export const SIDEBAR_WIDTH = 240;
export const TOPBAR_HEIGHT = 60;

export const shellRootStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
};

export const sidebarStyle: CSSProperties = {
  width: SIDEBAR_WIDTH,
  flexShrink: 0,
  background: 'var(--zad-950)',
  color: '#fff',
  display: 'flex',
  flexDirection: 'column',
  position: 'sticky',
  top: 0,
  height: '100vh',
  overflowY: 'auto',
};

export const sidebarBrandStyle: CSSProperties = {
  padding: '20px 18px',
  fontFamily: 'var(--font-display)',
  fontSize: 18,
  fontWeight: 800,
  borderBottom: '1px solid rgba(255,255,255,0.12)',
};

export const sidebarNavStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: '10px 0',
  flex: 1,
};

export function sidebarLinkStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    margin: '2px 10px',
    padding: '10px 12px',
    borderRadius: 'var(--r-sm)',
    fontSize: 14.5,
    color: active ? '#fff' : 'rgba(255,255,255,0.72)',
    background: active ? 'rgba(255,255,255,0.14)' : 'transparent',
    borderInlineStart: active ? '3px solid var(--gold-500)' : '3px solid transparent',
    textDecoration: 'none',
    fontWeight: active ? 700 : 500,
    transition: 'background 0.15s ease, color 0.15s ease',
  };
}

export const mainColumnStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
};

export const topBarStyle: CSSProperties = {
  height: TOPBAR_HEIGHT,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 22px',
  borderBottom: '1px solid var(--line)',
  background: 'var(--paper)',
  position: 'sticky',
  top: 0,
  zIndex: 10,
};

export const topBarUserStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 14,
};

export const contentStyle: CSSProperties = {
  flex: 1,
  padding: '24px 28px',
  maxWidth: 1240,
  width: '100%',
  margin: '0 auto',
};

export const mobileMenuButtonStyle: CSSProperties = {
  display: 'none',
  border: '1px solid var(--line)',
  background: 'var(--paper)',
  borderRadius: 'var(--r-sm)',
  padding: '8px 10px',
  cursor: 'pointer',
  fontSize: 16,
};

export const mobileOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(42,20,32,0.5)',
  zIndex: 40,
};

export const pageHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  marginBottom: 20,
  flexWrap: 'wrap',
};

export const pageTitleStyle: CSSProperties = { fontSize: 22, margin: 0 };
export const pageSubtitleStyle: CSSProperties = { fontSize: 14, opacity: 0.72, marginTop: 4 };

export const statCardGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 14,
  marginBottom: 22,
};

export const statCardStyle: CSSProperties = {
  padding: '16px 18px',
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--line)',
  background: 'var(--paper)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  textAlign: 'right',
  textDecoration: 'none',
  color: 'inherit',
  cursor: 'pointer',
};

export const statCardValueStyle: CSSProperties = { fontSize: 28, fontWeight: 800, color: 'var(--zad-800)' };
export const statCardLabelStyle: CSSProperties = { fontSize: 13.5, opacity: 0.78 };

export const emptyStateStyle: CSSProperties = {
  padding: '40px 20px',
  textAlign: 'center',
  color: 'var(--ink)',
  opacity: 0.7,
  border: '1px dashed var(--line)',
  borderRadius: 'var(--r-md)',
  background: 'var(--paper)',
};

export const alertListStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };

export function alertCardStyle(severity: 'critical' | 'high' | 'medium' | 'low'): CSSProperties {
  const border = { critical: 'var(--zad-600)', high: 'var(--zad-400)', medium: 'var(--gold-500)', low: 'var(--line)' }[severity];
  return {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    padding: '13px 16px',
    borderRadius: 'var(--r-sm)',
    border: `1px solid ${border}`,
    borderInlineStart: `4px solid ${border}`,
    background: 'var(--paper)',
    textDecoration: 'none',
    color: 'inherit',
    fontSize: 14,
  };
}

/** لون أيقونة كل مستوى خطورة — نفس ألوان alertCardStyle الحدّية، مُعاد استخدامها بدل تكرارها. */
export function alertSeverityColor(severity: 'critical' | 'high' | 'medium' | 'low'): string {
  return { critical: 'var(--zad-600)', high: 'var(--zad-400)', medium: 'var(--gold-700)', low: 'var(--ink)' }[severity];
}

export const alertTextGroupStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 };
export const alertIconWrapStyle: CSSProperties = { display: 'flex', flexShrink: 0 };

/* ---------- Dashboard hierarchy — راجع
   platform/docs/design/01-ui-redesign-blueprint-2026-08-16.md
   "DASHBOARD_DIRECTION". تُستخدَم حاليًا في admin/page.tsx فقط؛ association
   dashboard تبقى على statCardStyle الحالي بلا تغيير بصري. ---------- */

export const dashboardDateStyle: CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--ink)',
  opacity: 0.6,
};

export const sectionTitleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  margin: '28px 0 12px',
};

export const sectionTitleStyle: CSSProperties = {
  fontSize: 'var(--text-xl)',
  fontWeight: 700,
  margin: 0,
  color: 'var(--zad-900)',
};

export const sectionCountBadgeStyle: CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 700,
  padding: '2px 10px',
  borderRadius: 'var(--r-pill)',
  background: 'var(--zad-100)',
  color: 'var(--zad-800)',
};

export const heroKpiGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 16,
  marginBottom: 6,
};

export function heroKpiCardStyle(tone: 'default' | 'warn' | 'good'): CSSProperties {
  const accent = { default: 'var(--zad-800)', warn: 'var(--gold-700)', good: 'var(--status-good)' }[tone];
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    padding: '20px 20px',
    borderRadius: 'var(--r-md)',
    border: '1px solid var(--line)',
    borderTop: `3px solid ${accent}`,
    background: 'var(--paper-raised)',
    boxShadow: 'var(--shadow-sm)',
    textDecoration: 'none',
    color: 'inherit',
    cursor: 'pointer',
    transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
  };
}

export function heroKpiIconWrapStyle(tone: 'default' | 'warn' | 'good'): CSSProperties {
  const { fg, bg } = {
    default: { fg: 'var(--zad-800)', bg: 'var(--zad-100)' },
    warn: { fg: 'var(--gold-700)', bg: 'var(--gold-100)' },
    good: { fg: 'var(--status-good)', bg: 'var(--status-good-bg)' },
  }[tone];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 38,
    height: 38,
    borderRadius: 'var(--r-sm)',
    color: fg,
    background: bg,
  };
}

export const heroKpiValueStyle: CSSProperties = { fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--zad-900)', lineHeight: 1.1 };
export const heroKpiLabelStyle: CSSProperties = { fontSize: 'var(--text-md)', color: 'var(--ink)', opacity: 0.78 };

export const secondaryMetricsStripStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 10,
};

export const secondaryMetricCardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '12px 14px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--line)',
  background: 'var(--paper)',
  textDecoration: 'none',
  color: 'inherit',
  cursor: 'pointer',
};

export const secondaryMetricValueStyle: CSSProperties = { fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--ink)' };
export const secondaryMetricLabelStyle: CSSProperties = { fontSize: 'var(--text-sm)', opacity: 0.68 };

export const activityListCardStyle: CSSProperties = {
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-md)',
  background: 'var(--paper)',
  overflow: 'hidden',
};

export function activityRowStyle(isFirst: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '11px 16px',
    borderTop: isFirst ? 'none' : '1px solid var(--line)',
    fontSize: 'var(--text-sm)',
  };
}

export const activityIconWrapStyle: CSSProperties = {
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  borderRadius: 'var(--r-sm)',
  background: 'var(--canvas)',
  color: 'var(--zad-800)',
};

export const activityMainColStyle: CSSProperties = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 };
export const activityActorStyle: CSSProperties = { fontSize: 'var(--text-sm)', opacity: 0.72 };
export const activityTimeStyle: CSSProperties = { fontSize: 'var(--text-xs)', opacity: 0.6, flexShrink: 0, whiteSpace: 'nowrap' };
