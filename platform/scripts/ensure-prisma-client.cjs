const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const schema = path.join(root, 'packages', 'db', 'prisma', 'schema.prisma');
const lockfile = path.join(root, 'package-lock.json');
const output = path.join(root, 'packages', 'db', 'generated', 'client');
const stamp = path.join(output, '.alzad-generation-hash');
const digest = createHash('sha256').update(readFileSync(schema)).update(readFileSync(lockfile)).digest('hex');

if (existsSync(path.join(output, 'index.js')) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === digest) {
  process.stdout.write('Prisma Client matches schema and lockfile; generation skipped.\n');
  process.exit(0);
}

const windows = process.platform === 'win32';
const result = spawnSync(windows ? 'cmd.exe' : 'npm', windows
  ? ['/d', '/s', '/c', 'npm run prisma:generate --workspace packages/db']
  : ['run', 'prisma:generate', '--workspace', 'packages/db'], {
  cwd: root,
  stdio: 'inherit',
  timeout: 120_000,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(output, { recursive: true });
writeFileSync(stamp, `${digest}\n`, { flag: 'w' });
