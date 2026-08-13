'use client';

import { useEffect, useState } from 'react';
import {
  ApiClientError,
  REFERENCE_VALUE_PARENT_TYPE,
  REFERENCE_VALUE_TYPE_LABELS,
  addReferenceValue,
  getReferenceData,
  type ReferenceData,
  type ReferenceValueType,
} from '../../lib/api';
import { useRoleGuard } from '../../lib/use-role-guard';
import { AppShell } from '../../components/AppShell';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState, ErrorState } from '../../components/States';
import { cardStyle, errorStyle, inputStyle, labelStyle, mutedStyle, primaryButtonStyle, successStyle } from '../../lib/ui';

const REFERENCE_TYPES = Object.keys(REFERENCE_VALUE_TYPE_LABELS) as ReferenceValueType[];

/** REF-008 — ADMIN يضيف قيمة مرجعية جديدة لنوع موجود مسبقًا (لا يخترع نوعًا جديدًا)، تظهر فورًا في كل نماذج المنصة. يوازي addReferenceValue_ القديمة. */
export default function AdminReferenceDataPage() {
  const { user, loading: guardLoading } = useRoleGuard(['ADMIN']);
  const [data, setData] = useState<ReferenceData | null>(null);
  const [loadError, setLoadError] = useState('');
  const [type, setType] = useState<ReferenceValueType>('REGION');
  const [value, setValue] = useState('');
  const [parentValue, setParentValue] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoadError('');
    try {
      setData(await getReferenceData());
    } catch (err) {
      setLoadError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل البيانات المرجعية.');
    }
  }

  useEffect(() => {
    if (user) void load();
  }, [user]);

  const parentType = REFERENCE_VALUE_PARENT_TYPE[type];
  const parentOptions = !parentType ? [] : parentType === 'REGION' ? (data?.regions ?? []) : (data?.deviceTypes ?? []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await addReferenceValue({ type, value: value.trim(), parentValue: parentType ? parentValue : undefined });
      setNotice('تمت الإضافة بنجاح.');
      setValue('');
      setParentValue('');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر الحفظ. حاول مرة أخرى.');
    } finally {
      setBusy(false);
    }
  }

  if (guardLoading || !user) return null;

  return (
    <AppShell user={user}>
      <PageHeader title="البيانات المرجعية" subtitle="إضافة قيمة جديدة (منطقة/مدينة/نوع جهاز/مواصفة...) — تظهر فورًا في كل نماذج المنصة." />

      {loadError && <ErrorState message={loadError} />}
      {!data && !loadError && <LoadingState />}

      {data && (
        <>
          <form onSubmit={submit} style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 480, marginBottom: 24 }}>
            <label style={labelStyle}>
              النوع
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as ReferenceValueType);
                  setParentValue('');
                }}
                style={inputStyle}
              >
                {REFERENCE_TYPES.map((t) => (
                  <option key={t} value={t}>{REFERENCE_VALUE_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>

            {parentType && (
              <label style={labelStyle}>
                {REFERENCE_VALUE_TYPE_LABELS[parentType]} الأب
                <select required value={parentValue} onChange={(e) => setParentValue(e.target.value)} style={inputStyle}>
                  <option value="">— اختر —</option>
                  {parentOptions.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                {parentOptions.length === 0 && (
                  <span style={mutedStyle}>لا توجد قيم {REFERENCE_VALUE_TYPE_LABELS[parentType]} بعد — أضف واحدة أولًا.</span>
                )}
              </label>
            )}

            <label style={labelStyle}>
              القيمة الجديدة
              <input required maxLength={150} value={value} onChange={(e) => setValue(e.target.value)} style={inputStyle} />
            </label>

            {error && <p role="alert" style={errorStyle}>{error}</p>}
            {notice && <p style={successStyle}>{notice}</p>}

            <div>
              <button type="submit" disabled={busy} style={primaryButtonStyle}>{busy ? 'جارٍ الحفظ…' : 'إضافة'}</button>
            </div>
          </form>

          <h2 style={{ fontSize: 16, marginBottom: 10 }}>القيم الحالية</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            <ReferenceGroup title="مناطق" values={data.regions} />
            {data.regions.map((r) => (
              <ReferenceGroup key={r} title={`مدن — ${r}`} values={data.citiesByRegion[r] ?? []} />
            ))}
            <ReferenceGroup title="تصنيفات جمعيات" values={data.associationCategories} />
            <ReferenceGroup title="قطاعات جمعيات" values={data.associationSectors} />
            <ReferenceGroup title="حالات اجتماعية" values={data.socialStatuses} />
            <ReferenceGroup title="أنواع أجهزة" values={data.deviceTypes} />
            {data.deviceTypes.map((t) => (
              <ReferenceGroup key={t} title={`مواصفات — ${t}`} values={data.deviceSpecsByType[t] ?? []} />
            ))}
            <ReferenceGroup title="موردون" values={data.suppliers} />
            <ReferenceGroup title="أسباب فروق" values={data.differenceReasons} />
            <ReferenceGroup title="صفات المستلم" values={data.receiverTitles} />
          </div>
        </>
      )}
    </AppShell>
  );
}

function ReferenceGroup({ title, values }: { title: string; values: string[] }) {
  return (
    <div style={cardStyle}>
      <strong style={{ display: 'block', marginBottom: 8 }}>{title}</strong>
      {values.length === 0 ? (
        <p style={mutedStyle}>لا توجد قيم بعد.</p>
      ) : (
        <ul style={{ margin: 0, paddingInlineStart: 18, fontSize: 14 }}>
          {values.map((v) => (
            <li key={v}>{v}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
