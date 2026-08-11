#!/usr/bin/env node
'use strict';

/**
 * HOSTINGER-TEST-0 — Minimal deterministic dispatcher for Hostinger's
 * managed Node.js Web Apps.
 *
 * Hostinger requires a root-level package.json and (typically) a single
 * "Application startup file" it runs with `node <file>` after it performs
 * its own `npm install` at the repository root. The ACTUAL application
 * lives entirely under /platform (its own npm workspaces root, unchanged)
 * — this file never duplicates or moves it, it only shells out into it.
 *
 * Two separate Hostinger apps are created from the SAME branch/commit,
 * each with its own HOSTINGER_APP environment variable:
 *   HOSTINGER_APP=api   -> NestJS API
 *   HOSTINGER_APP=web   -> Next.js Web
 *
 * Usage:
 *   node hostinger-app.js install-platform   # npm install inside /platform
 *   node hostinger-app.js build               # build only what HOSTINGER_APP needs
 *   node hostinger-app.js start                # start only the selected app (default if no arg)
 *
 * Never runs `prisma migrate deploy` or `prisma db seed` — see
 * platform/docs/HOSTINGER_TEST_DEPLOYMENT.md for the explicit manual
 * migration command for TEST.
 */

const path = require('node:path');
const { execSync, spawn } = require('node:child_process');

const PLATFORM_DIR = path.join(__dirname, 'platform');

function readApp() {
  const app = process.env.HOSTINGER_APP;
  if (app !== 'api' && app !== 'web') {
    console.error(
      'HOSTINGER_APP must be set to exactly "api" or "web" (one Hostinger app instance per value). ' +
        'See platform/docs/HOSTINGER_TEST_DEPLOYMENT.md.',
    );
    process.exit(1);
  }
  return app;
}

function run(cmd) {
  console.log(`[hostinger-app] > ${cmd}`);
  execSync(cmd, { cwd: PLATFORM_DIR, stdio: 'inherit' });
}

function installPlatform() {
  // npm ci --include=dev: تثبيت حتمي بالكامل من platform/package-lock.json
  // الموجود فعلاً (يحذف/يعيد بناء node_modules من الصفر، لا يكتب على القفل).
  // --include=dev إلزامي هنا لأن NODE_ENV=production على Hostinger يجعل npm
  // يتجاهل devDependencies افتراضيًا (مثل typescript اللازم لخطوة البناء
  // التالية) ما لم يُطلَب صراحةً. لا بناء هنا إطلاقًا.
  run('npm ci --include=dev');
}

function build() {
  const app = readApp();
  run('npm run build --workspace packages/shared');
  if (app === 'api') {
    // توليد Prisma Client فقط — لا migrate deploy ولا seed هنا إطلاقًا.
    run('npm run prisma:generate --workspace packages/db');
    run('npm run build --workspace packages/db');
    run('npm run build --workspace apps/api');
  } else {
    run('npm run build --workspace apps/web');
  }
}

function startApiInProcess() {
  // Hostinger's managed Node.js runtime owns and monitors the process it
  // launches (the one that binds PORT). Spawning the API as a CHILD process
  // left that managed process idle while the child held the port — a
  // Hostinger "Restart" only restarts the managed parent, not the orphaned
  // child, so the port stayed occupied across restarts (EADDRINUSE). Loading
  // the compiled entry directly makes THIS process the one that binds PORT,
  // so Hostinger's own process lifecycle (start/stop/restart) controls it
  // correctly — no detached/background process.
  process.chdir(PLATFORM_DIR);
  require(path.join(PLATFORM_DIR, 'apps', 'api', 'dist', 'main.js'));
}

function start() {
  const app = readApp();
  if (app === 'api') {
    startApiInProcess();
    return;
  }

  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'start', '--workspace', 'apps/web'], {
    cwd: PLATFORM_DIR,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => child.kill(sig));
  }
}

const mode = process.argv[2] ?? 'start';
switch (mode) {
  case 'install-platform':
    installPlatform();
    break;
  case 'build':
    build();
    break;
  case 'start':
    start();
    break;
  default:
    console.error(`Unknown mode "${mode}". Usage: node hostinger-app.js <install-platform|build|start>`);
    process.exit(1);
}
