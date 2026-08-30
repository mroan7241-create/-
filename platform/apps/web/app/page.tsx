import { RootRedirect } from './components/RootRedirect';

// Hostinger's CDN retains statically prerendered HTML across deployments.
// The root imports a build-specific client chunk, so it must be rendered by
// the current runtime instead of surviving with stale asset references.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * الجذر — بلا شاشة health/dev بعد الآن (كانت NODE-0). يوجِّه فورًا حسب
 * حالة الجلسة: بلا جلسة → /login؛ بجلسة صالحة → لوحة الدور الصحيحة.
 * فحص صحة الـAPI التقني ينتمي إلى GET /api/v1/health مباشرة (أداة تشغيل)،
 * لا لواجهة مستخدم عامة — راجع PRODUCT_PARITY_MASTER.md §4 "ROOT ROUTE".
 */
export default function RootPage() {
  return <RootRedirect />;
}
