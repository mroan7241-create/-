import type { CSSProperties } from 'react';

/**
 * أنماط مشتركة مستخرَجة من نمط شاشات NODE-0/NODE-1 القائمة (login/dashboard)
 * حتى تبقى الشاشات الجديدة على نفس هوية الزاد بلا اختراع نمط بصري جديد،
 * وبلا تكرار نفس الكائنات في كل ملف. القيم كلها من design tokens في
 * app/globals.css (--zad-*, --gold-*, --line, --paper, --r-*).
 */

export const pageStyle: CSSProperties = { maxWidth: 1080, margin: '40px auto', padding: '0 20px' };
export const narrowPageStyle: CSSProperties = { maxWidth: 720, margin: '48px auto', padding: '0 20px' };

export const cardStyle: CSSProperties = {
  padding: 20,
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--line)',
  background: 'var(--paper)',
};

export const labelStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 };

export const inputStyle: CSSProperties = {
  padding: '10px 12px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--line)',
  fontSize: 15,
  fontFamily: 'inherit',
  background: 'var(--paper)',
  color: 'var(--ink)',
  width: '100%',
};

export const primaryButtonStyle: CSSProperties = {
  padding: '12px 16px',
  borderRadius: 'var(--r-sm)',
  border: 'none',
  background: 'var(--zad-800)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 15,
  cursor: 'pointer',
};

export const secondaryButtonStyle: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 'var(--r-sm)',
  border: '1px solid var(--line)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  cursor: 'pointer',
  fontSize: 14,
  fontFamily: 'inherit',
};

export const dangerButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  borderColor: 'var(--zad-600)',
  color: 'var(--zad-800)',
  fontWeight: 700,
};

export const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
  background: 'var(--paper)',
};

export const thStyle: CSSProperties = {
  textAlign: 'right',
  padding: '10px 12px',
  borderBottom: '1px solid var(--line)',
  color: 'var(--zad-800)',
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

export const tdStyle: CSSProperties = { padding: '10px 12px', borderBottom: '1px solid var(--line)' };

export const errorStyle: CSSProperties = { color: 'var(--zad-700)', fontSize: 14, margin: 0, fontWeight: 700 };
export const successStyle: CSSProperties = { color: '#1e6b4a', fontSize: 14, margin: 0, fontWeight: 700 };
export const mutedStyle: CSSProperties = { fontSize: 13, opacity: 0.75 };
export const ltrStyle: CSSProperties = { direction: 'ltr', textAlign: 'left', unicodeBidi: 'isolate' };

/** حقل الفخ (honeypot) — مخفي بصريًا وعن قارئات الشاشة، لكنه يبقى قابلًا للملء آليًا. */
export const honeypotWrapperStyle: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

export function statusBadgeStyle(tone: 'neutral' | 'good' | 'bad'): CSSProperties {
  const palette = {
    neutral: { bg: 'var(--gold-100)', fg: 'var(--gold-700)', border: 'var(--gold-400)' },
    good: { bg: '#e7f4ee', fg: '#1e6b4a', border: '#9dcfb8' },
    bad: { bg: 'var(--zad-100)', fg: 'var(--zad-800)', border: 'var(--zad-300)' },
  }[tone];
  return {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 700,
    background: palette.bg,
    color: palette.fg,
    border: `1px solid ${palette.border}`,
    whiteSpace: 'nowrap',
  };
}

export const modalOverlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(42, 20, 32, 0.55)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: 20,
  overflowY: 'auto',
  zIndex: 50,
};

export const modalStyle: CSSProperties = {
  ...cardStyle,
  maxWidth: 760,
  width: '100%',
  margin: '32px 0',
};
