import { pageHeaderStyle, pageSubtitleStyle } from './shell-styles';

/** رأس صفحات الإدارة/الجمعية الداخلية — نمط "framed-title" منقول من admin-r2/association-r2
 * (شريط ذهبي رفيع + عمود تدرّج) بدل العنوان المسطَّح القديم، ليتّسق شكل كل الصفحات الداخلية
 * مع لوحتي التحكم بعد نقل التصميم المعتمد. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={pageHeaderStyle}>
      <div className="zad-framed-title2" style={{ paddingInlineStart: 16 }}>
        <div className="zad-rule2" />
        <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--zad-900)', fontFamily: 'var(--font-display)', margin: 0 }}>{title}</h1>
        {subtitle && <p style={pageSubtitleStyle}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}
