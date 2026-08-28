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
    gap: 10,
    padding: '11px 18px',
    fontSize: 14.5,
    color: active ? '#fff' : 'rgba(255,255,255,0.72)',
    background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
    borderInlineStart: active ? '3px solid var(--gold-500)' : '3px solid transparent',
    textDecoration: 'none',
    fontWeight: active ? 700 : 500,
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
    padding: '12px 14px',
    borderRadius: 'var(--r-sm)',
    border: `1px solid ${border}`,
    borderInlineStart: `4px solid ${border}`,
    background: 'var(--paper)',
    textDecoration: 'none',
    color: 'inherit',
    fontSize: 14,
  };
}
