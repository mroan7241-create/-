'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getMe } from '../lib/api';
import { homeForRole } from '../components/nav-config';

/**
 * موجِّه بحسب الدور فقط — لم يعد غلافًا مؤقتًا (NODE-1 سابقًا). أي شاشة
 * أخرى في التطبيق تُحوِّل هنا عند رفض الدور (`useRoleGuard`)، ومن هنا
 * تنتقل مباشرة للوجهة الصحيحة: /admin أو /association (لوحتا تحكم
 * حقيقيتان) أو /change-password إن كانت كلمة المرور مؤقتة، أو /login
 * إن لم تكن هناك جلسة. راجع PRODUCT_PARITY_MASTER.md §4 "ROOT ROUTE".
 */
export default function DashboardRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    getMe()
      .then((user) => {
        if (user.mustChangePassword) {
          router.replace('/change-password');
          return;
        }
        router.replace(homeForRole(user.role));
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  return null;
}
