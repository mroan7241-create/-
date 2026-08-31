'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import type { CurrentUser } from '../lib/api';
import { logout } from '../lib/api';
import { navGroupsForRole, ROLE_LABELS } from './nav-config';
import { mobileMenuButtonStyle, mobileOverlayStyle } from './shell-styles';

/**
 * الهيكل الموحَّد لكل شاشات ADMIN/ASSOCIATION بعد تسجيل الدخول — منقول حرفيًا (بنية/تسلسل/تدرّج
 * الشريط الجانبي) من platform/docs/design/admin-r2-2026-08-16.html بدل الشريط المسطَّح القديم
 * الذي رفضه المدير بصريًا. راجع platform/docs/design/02-distinctive-design-concepts-2026-08-16.md.
 *
 * DELEGATE له تجربة منفصلة تمامًا (لا شريط جانبي — راجع legacy UI-008)
 * وليست جزءًا من هذا المكوّن؛ لا يُستخدَم AppShell لأي شاشة مندوب.
 */
export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const groups = navGroupsForRole(user.role);
  const homeHref = user.role === 'ADMIN' ? '/admin' : user.role === 'ASSOCIATION' ? '/association' : '/abanmi';

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.push('/login');
  }

  return (
    <div className="zad-shell2">
      <aside className="zad-sidebar2 zad-sidebar" data-open={mobileOpen}>
        <div className="zad-sidebar2-brand">
          <Image src="/brand/zadLogo.png" alt="جمعية الزاد" width={44} height={44} priority />
          <div>
            <div className="zad-sb2-name">جمعية الزاد</div>
            <div className="zad-sb2-role">لوحة العمليات، {ROLE_LABELS[user.role]}</div>
          </div>
        </div>
        <nav className="zad-nav-scroll2" aria-label="التنقّل الرئيسي">
          {groups.map(({ group, items }) => (
            <div className="zad-nav-group2" key={group}>
              <div className="zad-nav-group-label2">{group}</div>
              <ul className="zad-nav-list2">
                {items.map((item) => {
                  const active = pathname === item.href || (item.href !== homeHref && pathname.startsWith(item.href));
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="zad-nav-item2 zad-focusable"
                        data-active={active}
                        onClick={() => setMobileOpen(false)}
                      >
                        <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="zad-sidebar2-foot">
          <div className="zad-partner-lockup2">
            <span className="zad-partner-label2">بالشراكة مع</span>
            <Image src="/brand/partnerLogo.png" alt="مؤسسة سليمان أبانمي الأهلية" width={156} height={52} className="zad-partner-logo2" />
          </div>
          <div className="zad-foot-copy2">جمعية الزاد © ٢٠٢٦</div>
        </div>
      </aside>

      {mobileOpen && <div style={mobileOverlayStyle} onClick={() => setMobileOpen(false)} />}

      <div className="zad-main2">
        <div className="zad-sidebar2-toprow zad-topbar">
          <button
            type="button"
            className="zad-mobile-toggle zad-focusable"
            style={mobileMenuButtonStyle}
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={18} strokeWidth={1.75} aria-hidden="true" /> : <Menu size={18} strokeWidth={1.75} aria-hidden="true" />}
          </button>
          <span />
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
            <span style={{ fontWeight: 700 }}>{user.name}</span>
            <span style={{ opacity: 0.65 }}>({ROLE_LABELS[user.role]})</span>
            <button type="button" className="zad-logout-btn2 zad-focusable" onClick={handleLogout}>
              تسجيل الخروج
            </button>
          </div>
        </div>
        <main className="zad-content2">{children}</main>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .zad-sidebar { display: none; }
          .zad-sidebar[data-open="true"] { display: flex; position: fixed; inset: 0 0 0 auto; width: 78vw; max-width: 300px; z-index: 50; height: 100vh; }
          .zad-mobile-toggle { display: inline-flex !important; }
        }
      `}</style>
    </div>
  );
}
