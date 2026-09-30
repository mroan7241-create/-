'use client';

import { useState, type InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & { label: string };

export function PasswordField({ label, style, ...inputProps }: Props) {
  const [visible, setVisible] = useState(false);
  return <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
    {label}
    <span style={{ display: 'flex', alignItems: 'stretch', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)', background: '#fff' }}>
      <input {...inputProps} type={visible ? 'text' : 'password'} style={{ ...style, flex: 1, minWidth: 0, border: 0, background: 'transparent' }} />
      <button type="button" aria-label={visible ? `إخفاء ${label}` : `إظهار ${label}`} aria-pressed={visible} onClick={() => setVisible((value) => !value)} style={{ border: 0, background: 'transparent', color: 'var(--zad-800)', padding: '0 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
        {visible ? 'إخفاء' : 'إظهار'}
      </button>
    </span>
  </label>;
}
