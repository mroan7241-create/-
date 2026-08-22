'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiClientError,
  DELIVERY_FAILURE_REASON_LABELS,
  confirmHandover,
  confirmDelivery,
  failDelivery,
  getDelivery,
  getDeliveryProofUrl,
  listDeliveries,
  logout,
  retryDelivery,
  returnDelivery,
  updateBeneficiaryLocation,
  type DeliveryFailureReason,
  type DeliveryMissionSummary,
} from '../lib/api';
import { useRoleGuard } from '../lib/use-role-guard';
import {
  cardStyle,
  errorStyle,
  inputStyle,
  labelStyle,
  modalOverlayStyle,
  modalStyle,
  mutedStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  successStyle,
} from '../lib/ui';

/**
 * بوابة المندوب الحقيقية — NODE-6. لا شريط جانبي (تجربة منفصلة تمامًا عن
 * AppShell، مطابقةً لتصميم legacy UI-008: shell مستقل بالكامل لدور
 * DELEGATE). قائمة المهام + تأكيد/فشل/إعادة محاولة التسليم + سجل —
 * التبويب الثالث القديم ("مسار اليوم" بترتيب جغرافي Haversine) مؤجَّل
 * عمدًا (تحسين تجربة، لا قدرة عمل جوهرية) — راجع PRODUCT_PARITY_MASTER.md §5.
 */
export default function DelegatePortalPage() {
  const { user, loading } = useRoleGuard(['DELEGATE']);
  const router = useRouter();

  const [missions, setMissions] = useState<DeliveryMissionSummary[] | null>(null);
  const [error, setError] = useState('');
  const [confirmTarget, setConfirmTarget] = useState<DeliveryMissionSummary | null>(null);
  const [failTarget, setFailTarget] = useState<DeliveryMissionSummary | null>(null);
  const [locationTarget, setLocationTarget] = useState<DeliveryMissionSummary | null>(null);
  const [proofError, setProofError] = useState('');
  const [handoverBusyId, setHandoverBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await listDeliveries({ pageSize: 100 });
      setMissions(res.items);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل المهام.');
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.push('/login');
  }

  async function doRetry(mission: DeliveryMissionSummary) {
    try {
      await retryDelivery(mission.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّرت إعادة المحاولة.');
    }
  }

  async function doConfirmHandover(mission: DeliveryMissionSummary) {
    setHandoverBusyId(mission.id);
    setError('');
    try {
      await confirmHandover(mission.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر تأكيد استلام العهدة.');
    } finally {
      setHandoverBusyId(null);
    }
  }

  /** تخلٍّ نهائي — لا تراجع بعده من هنا (يبقى ممكنًا لاحقًا عبر تخصيص تلقائي جديد). */
  async function doReturn(mission: DeliveryMissionSummary) {
    if (!window.confirm(`إرجاع جهاز «${mission.beneficiary.name}» نهائيًا للمستودع؟ لن تعود هذه المهمة تظهر لديك، وسيُعاد تقييم الاحتياج تلقائيًا.`)) return;
    try {
      await returnDelivery(mission.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر إرجاع الجهاز.');
    }
  }

  /** يجلب تفاصيل المهمة (تتضمَّن سجل المحاولات) عند الطلب فقط، ثم رابطًا موقَّتًا لصورة الإثبات — نفس نمط DEL-010: لا رابط دائم، لا تحميل مسبق. */
  async function viewProof(mission: DeliveryMissionSummary) {
    setProofError('');
    try {
      const detail = await getDelivery(mission.id);
      const deliveredAttempt = detail.attempts.find((a) => a.status === 'DELIVERED' && a.hasProof);
      if (!deliveredAttempt) {
        setProofError('لا توجد صورة إثبات لهذا التسليم.');
        return;
      }
      const { url } = await getDeliveryProofUrl(deliveredAttempt.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setProofError(err instanceof ApiClientError ? err.message : 'تعذّر تحميل صورة الإثبات.');
    }
  }

  if (loading || !user) return null;

  const pendingHandover = (missions ?? []).filter((m) => m.status === 'PENDING_DELEGATE_ACKNOWLEDGEMENT');
  const active = (missions ?? []).filter((m) => m.status === 'OUT_WITH_DELEGATE');
  const failedMissions = (missions ?? []).filter((m) => m.status === 'DELIVERY_FAILED');
  const delivered = (missions ?? []).filter((m) => m.status === 'DELIVERED');

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '16px 16px 60px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', marginBottom: 8 }}>
        <div>
          <h1 style={{ fontSize: 19 }}>مرحبًا، {user.name}</h1>
          <p style={mutedStyle}>{active.length + pendingHandover.length} مهمة متبقية اليوم</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => router.push('/delegate/log')} style={secondaryButtonStyle}>سجل حركاتي</button>
          <button type="button" onClick={handleLogout} style={secondaryButtonStyle}>خروج</button>
        </div>
      </header>

      {error && <p role="alert" style={errorStyle}>{error}</p>}

      {pendingHandover.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, margin: '16px 0 8px' }}>عهدة بانتظار تأكيد الاستلام</h2>
          {pendingHandover.map((mission) => (
            <MissionCard
              key={mission.id}
              mission={mission}
              onConfirmHandover={() => doConfirmHandover(mission)}
              handoverBusy={handoverBusyId === mission.id}
            />
          ))}
        </>
      )}

      <h2 style={{ fontSize: 16, margin: '16px 0 8px' }}>المهام الحالية</h2>
      {active.length === 0 && <p style={mutedStyle}>لا توجد مهام حالية.</p>}
      {active.map((m) => (
        <MissionCard key={m.id} mission={m} onConfirm={() => setConfirmTarget(m)} onFail={() => setFailTarget(m)} onUpdateLocation={() => setLocationTarget(m)} />
      ))}

      {failedMissions.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, margin: '20px 0 8px' }}>تعذّر التسليم</h2>
          {failedMissions.map((m) => (
            <MissionCard key={m.id} mission={m} onRetry={() => doRetry(m)} onReturn={() => doReturn(m)} onUpdateLocation={() => setLocationTarget(m)} />
          ))}
        </>
      )}

      {delivered.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, margin: '20px 0 8px' }}>سجل التسليم</h2>
          {proofError && <p role="alert" style={errorStyle}>{proofError}</p>}
          {delivered.map((m) => (
            <MissionCard key={m.id} mission={m} onViewProof={() => viewProof(m)} />
          ))}
        </>
      )}

      {confirmTarget && (
        <ConfirmDeliveryModal
          mission={confirmTarget}
          onClose={() => setConfirmTarget(null)}
          onDone={async () => {
            setConfirmTarget(null);
            await load();
          }}
        />
      )}

      {failTarget && (
        <FailDeliveryModal
          mission={failTarget}
          onClose={() => setFailTarget(null)}
          onDone={async () => {
            setFailTarget(null);
            await load();
          }}
        />
      )}

      {locationTarget && (
        <UpdateLocationModal
          mission={locationTarget}
          onClose={() => setLocationTarget(null)}
          onDone={async () => {
            setLocationTarget(null);
            await load();
          }}
        />
      )}
    </main>
  );
}

function MissionCard({
  mission,
  onConfirm,
  onConfirmHandover,
  handoverBusy,
  onFail,
  onRetry,
  onReturn,
  onViewProof,
  onUpdateLocation,
}: {
  mission: DeliveryMissionSummary;
  onConfirm?: () => void;
  onConfirmHandover?: () => void;
  handoverBusy?: boolean;
  onFail?: () => void;
  onRetry?: () => void;
  onReturn?: () => void;
  onViewProof?: () => void;
  onUpdateLocation?: () => void;
}) {
  const b = mission.beneficiary;
  const phoneDigits = b.phone.replace(/\D/g, '');
  return (
    <div style={{ ...cardStyle, marginBottom: 10 }}>
      <strong>{b.name}</strong>
      <p style={{ ...mutedStyle, margin: '4px 0' }}>
        {b.region} — {b.city}
        {b.district ? ` — ${b.district}` : ''}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
        <a href={`tel:${phoneDigits}`} style={{ ...secondaryButtonStyle, textDecoration: 'none', display: 'inline-block' }}>
          اتصال
        </a>
        <a href={`https://wa.me/966${phoneDigits.replace(/^0/, '')}`} target="_blank" rel="noopener noreferrer" style={{ ...secondaryButtonStyle, textDecoration: 'none', display: 'inline-block' }}>
          واتساب
        </a>
        {b.latitude && b.longitude && (
          <a href={`https://www.google.com/maps?q=${b.latitude},${b.longitude}`} target="_blank" rel="noopener noreferrer" style={{ ...secondaryButtonStyle, textDecoration: 'none', display: 'inline-block' }}>
            الخريطة
          </a>
        )}
        {onUpdateLocation && (
          <button type="button" style={secondaryButtonStyle} onClick={onUpdateLocation}>📍 تحديث الموقع</button>
        )}
      </div>
      {onConfirmHandover && (
        <button type="button" disabled={handoverBusy} style={primaryButtonStyle} onClick={onConfirmHandover}>
          {handoverBusy ? 'جارٍ تأكيد الاستلام…' : 'تأكيد استلام العهدة'}
        </button>
      )}
      {onConfirm && onFail && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={primaryButtonStyle} onClick={onConfirm}>تأكيد التسليم</button>
          <button type="button" style={secondaryButtonStyle} onClick={onFail}>تعذّر</button>
        </div>
      )}
      {onRetry && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={primaryButtonStyle} onClick={onRetry}>↻ إعادة المحاولة</button>
          {onReturn && (
            <button type="button" style={secondaryButtonStyle} onClick={onReturn}>↩ إرجاع الجهاز للمستودع</button>
          )}
        </div>
      )}
      {onViewProof && (
        <button type="button" style={secondaryButtonStyle} onClick={onViewProof}>🖼 عرض صورة الإثبات</button>
      )}
    </div>
  );
}

function ConfirmDeliveryModal({ mission, onClose, onDone }: { mission: DeliveryMissionSummary; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [signature, setSignature] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pledged, setPledged] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function handleFile(f: File | null) {
    setError('');
    if (!f) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (f.size > 6 * 1024 * 1024) {
      setError('حجم الصورة يتجاوز 6 ميجابايت.');
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
      setError('صيغة الصورة غير مدعومة — JPG أو PNG أو WEBP فقط.');
      return;
    }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }

  const canSubmit = !!file && !!signature && pledged;

  async function submit() {
    if (!file || !signature) return;
    setBusy(true);
    setError('');
    try {
      await confirmDelivery(mission.id, file, signature);
      onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر تأكيد التسليم.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={modalOverlayStyle} role="dialog" aria-modal="true">
      <div style={{ ...modalStyle, maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18 }}>تأكيد تسليم — {mission.beneficiary.name}</h2>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>إغلاق</button>
        </div>

        <label style={labelStyle}>
          التقاط أو اختيار صورة الإثبات
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} style={inputStyle} />
          <span style={mutedStyle}>JPG أو PNG أو WEBP — بحد أقصى ٦ ميجابايت.</span>
        </label>
        {previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="معاينة صورة الإثبات" style={{ maxWidth: '100%', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)' }} />
        )}

        <label style={labelStyle}>
          صورة توقيع المستلم
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => setSignature(e.target.files?.[0] ?? null)} style={inputStyle} />
          <span style={mutedStyle}>التوقيع إلزامي ويُحفظ كملف خاص.</span>
        </label>

        <label style={{ ...labelStyle, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={pledged} onChange={(e) => setPledged(e.target.checked)} />
          <span>أؤكّد أنني سلّمت الأجهزة المذكورة أعلاه إلى المستفيد، وأن الصورة المرفقة إثبات صحيح للتسليم.</span>
        </label>

        {!canSubmit && (
          <p role="status" aria-live="polite" style={mutedStyle}>
            {!file && !pledged ? 'أرفق صورة الإثبات ووافق على الإقرار للمتابعة.' : !file ? 'أرفق صورة الإثبات للمتابعة.' : 'وافق على الإقرار للمتابعة.'}
          </p>
        )}
        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button type="button" disabled={!canSubmit || busy} style={primaryButtonStyle} onClick={submit}>
          {busy ? 'جارٍ التأكيد…' : 'تم التسليم'}
        </button>
      </div>
    </div>
  );
}

function FailDeliveryModal({ mission, onClose, onDone }: { mission: DeliveryMissionSummary; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState<DeliveryFailureReason | ''>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!reason) return;
    setBusy(true);
    setError('');
    try {
      await failDelivery(mission.id, reason, notes || undefined);
      onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر تسجيل تعذّر التسليم.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={modalOverlayStyle} role="dialog" aria-modal="true">
      <div style={{ ...modalStyle, maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18 }}>تعذّر التسليم — {mission.beneficiary.name}</h2>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>إغلاق</button>
        </div>

        <label style={labelStyle}>
          السبب
          <select required value={reason} onChange={(e) => setReason(e.target.value as DeliveryFailureReason)} style={inputStyle}>
            <option value="">— اختر —</option>
            {Object.entries(DELIVERY_FAILURE_REASON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          ملاحظات (اختياري)
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...inputStyle, minHeight: 80 }} maxLength={1000} />
        </label>

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button type="button" disabled={!reason || busy} style={primaryButtonStyle} onClick={submit}>
          {busy ? 'جارٍ الحفظ…' : 'تسجيل التعذّر'}
        </button>
      </div>
    </div>
  );
}

/** BEN-016/017 — المسار الوحيد المفتوح لِDELEGATE لتصحيح/تأكيد موقع مستفيد مُسنَد له حاليًا. */
function UpdateLocationModal({ mission, onClose, onDone }: { mission: DeliveryMissionSummary; onClose: () => void; onDone: () => void }) {
  const b = mission.beneficiary;
  const [lat, setLat] = useState(b.latitude != null ? String(b.latitude) : '');
  const [lng, setLng] = useState(b.longitude != null ? String(b.longitude) : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [source, setSource] = useState<'MANUAL' | 'CURRENT_LOCATION'>('MANUAL');

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setError('المتصفح لا يدعم تحديد الموقع الحالي.');
      return;
    }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(String(pos.coords.latitude));
        setLng(String(pos.coords.longitude));
        setSource('CURRENT_LOCATION');
        setLocating(false);
      },
      () => {
        setError('تعذّر الوصول لموقعك الحالي — أدخل الإحداثيات يدويًا.');
        setLocating(false);
      },
    );
  }

  const canSubmit = lat.trim() !== '' && lng.trim() !== '' && !busy;

  async function submit() {
    setBusy(true);
    setError('');
    try {
      await updateBeneficiaryLocation(mission.beneficiaryId, {
        lat: Number(lat),
        lng: Number(lng),
        locationSource: source,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'تعذّر حفظ الموقع.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={modalOverlayStyle} role="dialog" aria-modal="true">
      <div style={{ ...modalStyle, maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 18 }}>تحديث موقع — {b.name}</h2>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>إغلاق</button>
        </div>

        <button type="button" disabled={locating} style={primaryButtonStyle} onClick={useCurrentLocation}>
          {locating ? 'جارٍ تحديد الموقع…' : '📍 استخدام موقعي الحالي'}
        </button>

        <label style={labelStyle}>
          خط العرض (lat)
          <input value={lat} onChange={(e) => { setLat(e.target.value); setSource('MANUAL'); }} style={inputStyle} inputMode="decimal" />
        </label>
        <label style={labelStyle}>
          خط الطول (lng)
          <input value={lng} onChange={(e) => { setLng(e.target.value); setSource('MANUAL'); }} style={inputStyle} inputMode="decimal" />
        </label>

        {error && <p role="alert" style={errorStyle}>{error}</p>}

        <button type="button" disabled={!canSubmit} style={primaryButtonStyle} onClick={submit}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ الموقع'}
        </button>
      </div>
    </div>
  );
}
