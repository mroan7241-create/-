'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { CurrentUser } from '../lib/api';
import { logout } from '../lib/api';
import { navForRole, ROLE_LABELS } from './nav-config';
import {
  shellRootStyle,
  sidebarStyle,
  sidebarBrandStyle,
  sidebarNavStyle,
  sidebarLinkStyle,
  mainColumnStyle,
  topBarStyle,
  topBarUserStyle,
  contentStyle,
  mobileMenuButtonStyle,
  mobileOverlayStyle,
} from './shell-styles';

/**
 * الهيكل الموحَّد لكل شاشات ADMIN/ASSOCIATION بعد تسجيل الدخول — شريط
 * جانبي بالتنقّل الخاص بالدور + شريط علوي بمعلومات المستخدم/الخروج +
 * منطقة محتوى. راجع platform/docs/PRODUCT_PARITY_MASTER.md §4 (الخطوة
 * الأولى في خطة التنفيذ) — هذا يستبدل التكرار السابق لكل صفحة لعنصر
 * <main style={pageStyle}> بلا أي تنقّل مشترك بينها.
 *
 * DELEGATE له تجربة منفصلة تمامًا (لا شريط جانبي — راجع legacy UI-008)
 * وليست جزءًا من هذا المكوّن؛ لا يُستخدَم AppShell لأي شاشة مندوب.
 */
export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const items = navForRole(user.role);

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.push('/login');
  }

  return (
    <div style={shellRootStyle}>
      <div className="zad-sidebar" data-open={mobileOpen} style={sidebarStyle}>
        <div style={sidebarBrandStyle}>جمعية الزاد</div>
        <ul style={sidebarNavStyle}>
          {items.map((item) => {
            const active = pathname === item.href || (item.href !== '/admin' && item.href !== '/association' && pathname.startsWith(item.href));
            return (
              <li key={item.href}>
                <Link href={item.href} style={sidebarLinkStyle(active)} onClick={() => setMobileOpen(false)}>
                  <span aria-hidden="true">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      {mobileOpen && <div style={mobileOverlayStyle} onClick={() => setMobileOpen(false)} />}

      <div style={mainColumnStyle}>
        <header style={topBarStyle}>
          <button
            type="button"
            className="zad-mobile-toggle"
            style={mobileMenuButtonStyle}
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="فتح القائمة"
          >
            ☰
          </button>
          <span />
          <div style={topBarUserStyle}>
            <span style={{ fontWeight: 700 }}>{user.name}</span>
            <span style={{ opacity: 0.65 }}>({ROLE_LABELS[user.role]})</span>
            <button
              type="button"
              onClick={handleLogout}
              style={{ padding: '7px 12px', borderRadius: 'var(--r-sm)', border: '1px solid var(--line)', background: 'var(--paper)', cursor: 'pointer', fontSize: 13.5 }}
            >
              تسجيل الخروج
            </button>
          </div>
        </header>
        <main style={contentStyle}>{children}</main>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .zad-sidebar { display: none; }
          .zad-sidebar[data-open="true"] { display: flex; position: fixed; inset: 0 0 0 auto; width: 78vw; max-width: 300px; z-index: 50; }
          .zad-mobile-toggle { display: inline-flex !important; }
        }
      `}</style>
    </div>
  );
}
