import Link from 'next/link';
import { statCardStyle, statCardValueStyle, statCardLabelStyle } from './shell-styles';

/**
 * بطاقة إحصائية واحدة — دائمًا من بيانات حقيقية عبر props، بلا أرقام
 * وهمية إطلاقًا. تُستخدَم لكل لوحات التحكم (ADMIN/ASSOCIATION). عند
 * توفير href تصبح رابطًا قابلًا للنقر يعمّق الوصول للقائمة المفلترة
 * المطابقة — نفس نمط "كل رقم زر قابل للنقر" في لوحة تحكم النظام القديم.
 */
export function StatCard({ label, value, href, tone }: { label: string; value: number | string; href?: string; tone?: 'default' | 'warn' }) {
  const content = (
    <>
      <span style={{ ...statCardValueStyle, color: tone === 'warn' ? 'var(--zad-700)' : statCardValueStyle.color }}>{value}</span>
      <span style={statCardLabelStyle}>{label}</span>
    </>
  );
  if (href) {
    return (
      <Link href={href} style={statCardStyle}>
        {content}
      </Link>
    );
  }
  return <div style={statCardStyle}>{content}</div>;
}
