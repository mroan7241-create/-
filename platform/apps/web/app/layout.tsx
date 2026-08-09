import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'منصة جمعية الزاد — تجريبي (NODE-0)',
  description: 'أساس Next.js App Router الجديد — RTL، لا يزال قيد الهجرة التدريجية من Google Apps Script.',
};

/**
 * application shell — RTL foundation فقط لهذه المرحلة (NODE-0). هوية
 * الزاد الكاملة (typography، المكوّنات، الشاشات) تُنقل تدريجيًا في
 * المراحل NODE-3 وما بعدها — راجع platform/docs/MIGRATION_ROADMAP.md.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
