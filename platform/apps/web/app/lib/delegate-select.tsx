'use client';

import { useEffect, useRef, useState } from 'react';
import { listDelegates, type DelegateSummary } from './api';
import { errorStyle, inputStyle, mutedStyle, secondaryButtonStyle } from './ui';

interface DelegateSelectProps {
  value: string;
  onChange: (delegateId: string, delegate: DelegateSummary | null) => void;
  associationId?: string;
}

/** نفس نمط AssociationSelect/BeneficiarySelect — نشط فقط (المندوب المعطَّل لا يظهر كخيار إسناد). */
export function DelegateSelect({ value, onChange, associationId }: DelegateSelectProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<DelegateSummary[]>([]);
  const [selected, setSelected] = useState<DelegateSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(term: string) {
    setLoading(true);
    setError('');
    try {
      const res = await listDelegates({ pageSize: 25, status: 'ACTIVE', associationId, search: term || undefined });
      setOptions(res.items);
    } catch {
      setError('تعذّر تحميل قائمة المناديب — أعد المحاولة');
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open, associationId]);

  function pick(d: DelegateSummary) {
    setSelected(d);
    setOpen(false);
    setQuery('');
    onChange(d.id, d);
  }

  function clear() {
    setSelected(null);
    onChange('', null);
  }

  if (selected || value) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={inputStyle}>{selected?.name ?? value}</span>
        <button type="button" style={secondaryButtonStyle} onClick={clear}>تغيير</button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        style={inputStyle}
        placeholder="ابحث باسم المندوب..."
        value={query}
        onFocus={() => {
          setOpen(true);
          if (options.length === 0) search('');
        }}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <div style={{ position: 'absolute', zIndex: 10, background: 'var(--paper)', border: '1px solid var(--line)', borderRadius: 8, width: '100%', maxHeight: 240, overflowY: 'auto' }}>
          {loading && <div style={{ ...mutedStyle, padding: 8 }}>...جارٍ البحث</div>}
          {error && <div style={{ ...errorStyle, padding: 8 }}>{error}</div>}
          {!loading && !error && options.length === 0 && <div style={{ ...mutedStyle, padding: 8 }}>لا مناديب نشطون</div>}
          {options.map((d) => (
            <div key={d.id} style={{ padding: 8, cursor: 'pointer', borderBottom: '1px solid var(--line)' }} onClick={() => pick(d)}>
              {d.name} — {d.phone ?? '—'}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
