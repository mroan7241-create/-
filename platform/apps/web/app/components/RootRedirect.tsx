'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getMe } from '../lib/api';
import { homeForUser } from './nav-config';

export function RootRedirect() {
  const router = useRouter();

  useEffect(() => {
    getMe()
      .then((user) => {
        if (user.mustChangePassword) {
          router.replace('/change-password');
          return;
        }
        if (user.role === 'ASSOCIATION' && user.covenantRequired) {
          router.replace('/association/covenant');
          return;
        }
        router.replace(homeForUser(user));
      })
      .catch(() => router.replace('/login'));
  }, [router]);

  return null;
}
