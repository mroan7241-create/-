'use client';

import { useState } from 'react';
import { dangerButtonStyle, modalOverlayStyle, modalStyle, primaryButtonStyle, secondaryButtonStyle } from '../lib/ui';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, tone = 'primary', onConfirm, onCancel }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <div style={modalOverlayStyle} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      <section style={{ ...modalStyle, maxWidth: 480 }}>
        <h2 id="confirm-dialog-title" style={{ fontSize: 19, marginBottom: 12 }}>{title}</h2>
        <p>{message}</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 20 }}>
          <button type="button" style={tone === 'danger' ? dangerButtonStyle : primaryButtonStyle} disabled={busy} onClick={async () => {
            setBusy(true);
            try { await onConfirm(); } finally { setBusy(false); }
          }}>{busy ? 'جارٍ التنفيذ…' : confirmLabel}</button>
          <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onCancel}>إلغاء</button>
        </div>
      </section>
    </div>
  );
}
