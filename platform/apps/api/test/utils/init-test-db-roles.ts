import { prisma } from '@alzad/db';
import { assertE2eNotTargetingProduction } from './production-target.guard';

// Supabase-compatible NOLOGIN roles needed by historical migrations in an
// isolated stock PostgreSQL test cluster. Never run against a live database.
async function main(): Promise<void> {
  assertE2eNotTargetingProduction();
  if (process.env.E2E_INIT_CANARY !== 'true') {
    throw new Error('SAFETY STOP: E2E_INIT_CANARY=true is required for test database provisioning.');
  }
  for (const name of ['anon', 'authenticated', 'postgres'] as const) {
    const rows = await prisma.$queryRaw<{ present: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${name}) AS present
    `;
    if (rows[0]?.present) continue;
    // Names are a fixed internal tuple, never interpolated from an environment variable.
    await prisma.$executeRawUnsafe(`CREATE ROLE ${name} NOLOGIN`);
  }
  process.stdout.write('Isolated test database has the required NOLOGIN compatibility roles.\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Test role provisioning failed.'}\n`);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
