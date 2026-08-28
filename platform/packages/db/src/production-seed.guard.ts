/**
 * Hard gate: development/test seed data must never be written to Production.
 * There is intentionally NO Production bypass.
 */
const PROD_SUPABASE_REF = 'ojaqtsjpcjjhnmavjuue';
const PROD_STORAGE_BUCKET = 'alzad-platform-prod';
const PROD_HOSTS = [
  'greenyellow-hawk-333467.hostingersite.com',
  'floralwhite-tapir-393693.hostingersite.com',
];

export function assertSeedNotTargetingProduction(): void {
  const values = [
    process.env.DATABASE_URL,
    process.env.DIRECT_URL,
    process.env.OBJECT_STORAGE_ENDPOINT,
    process.env.OBJECT_STORAGE_BUCKET,
    process.env.API_BASE_URL,
    process.env.NEXT_PUBLIC_API_BASE_URL,
  ].filter((value): value is string => Boolean(value));

  const hits: string[] = [];
  if ((process.env.NODE_ENV ?? '').toLowerCase() === 'production') hits.push('NODE_ENV=production');
  for (const raw of values) {
    const value = raw.toLowerCase();
    if (value.includes(PROD_SUPABASE_REF)) hits.push('Supabase Production project');
    if (value.includes(PROD_STORAGE_BUCKET)) hits.push('Production Storage bucket');
    if (PROD_HOSTS.some((host) => value.includes(host))) hits.push('Hostinger Production host');
  }

  if (hits.length > 0) {
    throw new Error(
      `SAFETY STOP: prisma seed is targeting Production (${[...new Set(hits)].join(', ')}). ` +
      'Seed is development/test-only and cannot run against Production.',
    );
  }
}