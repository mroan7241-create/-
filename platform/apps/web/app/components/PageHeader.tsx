import { pageHeaderStyle, pageTitleStyle, pageSubtitleStyle } from './shell-styles';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div style={pageHeaderStyle}>
      <div>
        <h1 style={pageTitleStyle}>{title}</h1>
        {subtitle && <p style={pageSubtitleStyle}>{subtitle}</p>}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}
