import { financialSummary } from '../lib/financial-summary';

export function FinancialSummary({ finance }: { finance: unknown }) {
  const lines = financialSummary(finance);
  if (!lines.length) return null;
  return <aside aria-label="قراءة مالية آلية" style={{ background: '#f8f4f5', borderRadius: 10, padding: 16, marginBlock: 12, overflowWrap: 'anywhere' }}>
    <strong>قراءة مالية آلية</strong>
    {lines.map((line) => <p key={line} style={{ marginBlock: 8 }}>{line}</p>)}
    <small>مؤشرات من الأرقام المدخلة، وليست قرار أهلية أو قبول.</small>
  </aside>;
}
