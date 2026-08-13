import { emptyStateStyle } from './shell-styles';
import { errorStyle } from '../lib/ui';

/** حالة تحميل موحَّدة — بلا spinner ثقيل، نص بسيط يطابق نمط الصفحات الحالية. */
export function LoadingState({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return <p style={{ opacity: 0.7, fontSize: 14 }}>{label}</p>;
}

/** حالة خطأ موحَّدة. */
export function ErrorState({ message }: { message: string }) {
  return <p style={errorStyle}>{message}</p>;
}

/** حالة فارغة موحَّدة — تُستخدَم بدل نص مخصَّص في كل صفحة. */
export function EmptyState({ message }: { message: string }) {
  return <div style={emptyStateStyle}>{message}</div>;
}
