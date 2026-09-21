import { prisma } from '@alzad/db';
import { assertE2eNotTargetingProduction, E2E_SAFETY_CANARY } from './production-target.guard';

// Test-only provisioning. Never imported by the application or migrations.
async function main(): Promise<void> {
  assertE2eNotTargetingProduction();
  if (process.env.E2E_INIT_CANARY !== 'true') {
    throw new Error('SAFETY STOP: E2E_INIT_CANARY=true is required to provision a test canary.');
  }
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS public.e2e_safety_canary (
      database_name text PRIMARY KEY,
      marker text NOT NULL
    )
  `;
  await prisma.$executeRaw`
    INSERT INTO public.e2e_safety_canary (database_name, marker)
    VALUES (current_database(), ${E2E_SAFETY_CANARY})
    ON CONFLICT (database_name) DO UPDATE SET marker = EXCLUDED.marker
  `;
  process.stdout.write('E2E safety canary verified in the explicitly allowed test database.\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'E2E canary provisioning failed.'}\n`);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
