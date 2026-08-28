'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch, type AssociationSummary, type Paginated } from './api';
import { errorStyle, inputStyle, mutedStyle, secondaryButtonStyle } from './ui';

interface AssociationSelectProps {
  value: string;
  onChange: (associationId: string, association: AssociationSummary | null) => void;
  placeholder?: string;
}

/**
 * NODE-4.1 — بديل خفيف عن جلب `pageSize=200` (فوق سقف الخادم 100 أصلًا،
 * وكان يبتلع أخطاء التحميل صمتًا). يعرض أول 25 جمعية نشطة عند الفتح، ثم
 * يبحث خادميًا (`GET /associations?search=...&status=ACTIVE`) أثناء
 * الكتابة بتأخير بسيط بلا أي مكتبة debounce خارجية. لا يجلب كل الجمعيات
 * إطلاقًا، ولا يُخفي أخطاء التحميل.
 */
export function AssociationSelect({ value, onChange, placeholder }: AssociationSelectProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<AssociationSummary[]>([]);
  const [selected, setSelected] = useState<AssociationSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(term: string) {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<Paginated<AssociationSummary>>(`/associations?pageSize=25&status=ACTIVE${term ? `&search=${encodeURIComponent(term)}` : ''}`);
      setOptions(res.items);
    } catch {
      setError('تعذّر تحميل قائمة الجمعيات — أعد المحاولة');
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
  }, [query, open]);

  function pick(a: AssociationSummary) {
    setSelected(a);
    setOpen(false);
    setQuery('');
    onChange(a.id, a);
  }

  function clear() {
    setSelected(null);
    onChange('', null);
  }

  if (selected || value) {
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={inputStyle}>{selected?.name ?? value}</span>
        <button type="button" style={secondaryButtonStyle} onClick={clear}>
          تغيير
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        style={inputStyle}
        placeholder={placeholder ?? 'ابحث باسم الجمعية...'}
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
          {options.map((a) => (
            <div key={a.id} style={{ padding: 8, cursor: 'pointer', borderBottom: '1px solid var(--line)' }} onClick={() => pick(a)}>
              {a.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
