'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch, type BeneficiarySummary, type Paginated } from './api';
import { errorStyle, inputStyle, mutedStyle, secondaryButtonStyle } from './ui';

interface BeneficiarySelectProps {
  value: string;
  onChange: (beneficiaryId: string, beneficiary: BeneficiarySummary | null) => void;
  /** يُقيَّد اختياريًا على جمعية واحدة (لوحة ADMIN عند اختيار جمعية أولًا) — بلا قيمة يبحث عبر الكل (الجمعية المرتبطة بالجلسة تلقائيًا لدور ASSOCIATION). */
  associationId?: string;
}

/** نفس نمط AssociationSelect بالضبط — بحث خادمي مؤجَّل بلا مكتبة debounce خارجية، أول 25 نتيجة معتمَدة فقط (المرشَّحون الوحيدون للإسناد). */
export function BeneficiarySelect({ value, onChange, associationId }: BeneficiarySelectProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<BeneficiarySummary[]>([]);
  const [selected, setSelected] = useState<BeneficiarySummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(term: string) {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({ pageSize: '25', reviewStatus: 'APPROVED' });
      if (associationId) q.set('associationId', associationId);
      if (term) q.set('search', term);
      const res = await apiFetch<Paginated<BeneficiarySummary>>(`/beneficiaries?${q.toString()}`);
      setOptions(res.items);
    } catch {
      setError('تعذّر تحميل قائمة المستفيدين — أعد المحاولة');
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

  function pick(b: BeneficiarySummary) {
    setSelected(b);
    setOpen(false);
    setQuery('');
    onChange(b.id, b);
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
        placeholder="ابحث باسم المستفيد المعتمَد..."
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
          {!loading && !error && options.length === 0 && <div style={{ ...mutedStyle, padding: 8 }}>لا نتائج</div>}
          {options.map((b) => (
            <div key={b.id} style={{ padding: 8, cursor: 'pointer', borderBottom: '1px solid var(--line)' }} onClick={() => pick(b)}>
              {b.name} — {b.region}/{b.city}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
