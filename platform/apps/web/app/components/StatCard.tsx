import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  statCardStyle,
  statCardValueStyle,
  statCardLabelStyle,
  heroKpiCardStyle,
  heroKpiIconWrapStyle,
  heroKpiValueStyle,
  heroKpiLabelStyle,
  secondaryMetricCardStyle,
  secondaryMetricValueStyle,
  secondaryMetricLabelStyle,
} from './shell-styles';

/**
 * بطاقة إحصائية واحدة — دائمًا من بيانات حقيقية عبر props، بلا أرقام
 * وهمية إطلاقًا. تُستخدَم لكل لوحات التحكم (ADMIN/ASSOCIATION). عند
 * توفير href تصبح رابطًا قابلًا للنقر يعمّق الوصول للقائمة المفلترة
 * المطابقة — نفس نمط "كل رقم زر قابل للنقر" في لوحة تحكم النظام القديم.
 *
 * `emphasis` اختياري ('default' الافتراضي — بلا أي تغيير بصري عن السابق،
 * تستمر association/page.tsx على هذا الشكل بلا لمسه). 'hero'/'compact'
 * مُستخدَمة حاليًا في admin/page.tsx فقط — راجع
 * platform/docs/design/01-ui-redesign-blueprint-2026-08-16.md "DASHBOARD_DIRECTION".
 */
export function StatCard({
  label,
  value,
  href,
  tone = 'default',
  icon: Icon,
  emphasis = 'default',
}: {
  label: string;
  value: number | string;
  href?: string;
  tone?: 'default' | 'warn' | 'good';
  icon?: LucideIcon;
  emphasis?: 'default' | 'hero' | 'compact';
}) {
  if (emphasis === 'hero') {
    const heroTone = tone === 'good' ? 'good' : tone === 'warn' ? 'warn' : 'default';
    const content = (
      <>
        {Icon && (
          <span style={heroKpiIconWrapStyle(heroTone)}>
            <Icon size={19} strokeWidth={1.75} aria-hidden="true" />
          </span>
        )}
        <span>
          <span style={{ ...heroKpiValueStyle, display: 'block' }}>{value}</span>
          <span style={heroKpiLabelStyle}>{label}</span>
        </span>
      </>
    );
    const style = heroKpiCardStyle(heroTone);
    if (href) {
      return (
        <Link href={href} className="zad-kpi-card zad-focusable" style={style}>
          {content}
        </Link>
      );
    }
    return (
      <div className="zad-kpi-card" style={style}>
        {content}
      </div>
    );
  }

  if (emphasis === 'compact') {
    const content = (
      <>
        <span style={{ ...secondaryMetricValueStyle, color: tone === 'warn' ? 'var(--gold-700)' : secondaryMetricValueStyle.color }}>{value}</span>
        <span style={secondaryMetricLabelStyle}>{label}</span>
      </>
    );
    if (href) {
      return (
        <Link href={href} className="zad-focusable" style={secondaryMetricCardStyle}>
          {content}
        </Link>
      );
    }
    return <div style={secondaryMetricCardStyle}>{content}</div>;
  }

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
