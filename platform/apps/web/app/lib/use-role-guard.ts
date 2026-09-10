'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import { getMe, type CurrentUser } from './api';

/**
 * بوابة دور على مستوى الواجهة — راحة للمستخدم فقط، وليست ضمانة أمنية:
 * الضمانة الحقيقية هي `@Roles(...)` على الخادم (كل مسار محمي يرفض الدور
 * الخاطئ بـ403 بصرف النظر عن أي شيء هنا). نفس نمط dashboard/page.tsx.
 */
export function useRoleGuard(allowed: CurrentUser['role'][]): { user: CurrentUser | null; loading: boolean } {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (cancelled) return;
        if (me.mustChangePassword) {
          router.replace('/change-password');
          return;
        }
        if (me.role === 'ASSOCIATION' && me.covenantRequired && pathname !== '/association/covenant') {
          router.replace('/association/covenant');
          return;
        }
        if (!allowed.includes(me.role)) {
          router.replace('/dashboard');
          return;
        }
        setUser(me);
      })
      .catch(() => {
        if (!cancelled) router.replace('/login');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, pathname]);

  return { user, loading };
}
