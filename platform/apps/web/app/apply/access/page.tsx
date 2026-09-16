'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError, exchangeApplicationAccess } from '../../lib/api';
import styles from '../application-v2.module.css';

const DRAFT_KEY = 'alzad.apply.v2.draft';

export default function ApplicationAccessPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setToken(new URLSearchParams(window.location.search).get('token')?.trim() ?? ''); }, []);

  async function openRequest() {
    if (!token) return setError('رابط الوصول غير مكتمل. اطلب رابطًا جديدًا.');
    setLoading(true); setError('');
    try {
      const result = await exchangeApplicationAccess(token);
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ draftCode: result.draftCode, viaSession: true }));
      router.replace(result.destination);
    } catch (reason) {
      setError(reason instanceof ApiClientError || reason instanceof Error ? reason.message : 'تعذّر فتح الطلب. اطلب رابطًا جديدًا.');
    } finally { setLoading(false); }
  }

  return <main className={styles.page}><div className={styles.wrap} style={{ maxWidth: 680 }}>
    <header className={styles.hero}><h1>الوصول الآمن إلى الطلب</h1><p>الرابط صالح لفترة قصيرة ويُستخدم مرة واحدة فقط.</p></header>
    <section className={styles.panel}>
      <p>لن يُفتح الطلب بمجرد زيارة هذه الصفحة. اضغط الزر للمتابعة وإنشاء جلسة آمنة على هذا الجهاز.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <button className={styles.button} disabled={loading || !token} onClick={() => void openRequest()}>{loading ? 'جارٍ التحقق…' : 'فتح الطلب بأمان'}</button>
    </section>
  </div></main>;
}
