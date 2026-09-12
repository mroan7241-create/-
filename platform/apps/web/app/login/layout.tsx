import type { ReactNode } from 'react';

// Hostinger replaces hashed Next.js assets on each deployment. Keep the login
// HTML out of shared caches so it can never reference assets from an older build.
export const dynamic = 'force-dynamic';

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
