'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getMe } from './lib/api';
import { homeForRole } from './components/nav-config';

/**
 * الجذر — بلا شاشة health/dev بعد الآن (كانت NODE-0). يوجِّه فورًا حسب
 * حالة الجلسة: بلا جلسة → /login؛ بجلسة صالحة → لوحة الدور الصحيحة.
 * فحص صحة الـAPI التقني ينتمي إلى GET /api/v1/health مباشرة (أداة تشغيل)،
 * لا لواجهة مستخدم عامة — راجع PRODUCT_PARITY_MASTER.md §4 "ROOT ROUTE".
 */
export default function RootPage() {
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
