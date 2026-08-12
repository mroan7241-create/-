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
const { execSync } = require('node:child_process');

const PLATFORM_DIR = path.join(__dirname, 'platform');

// تشخيص واضح بلا أسرار لأي عطل غير متوقع قبل أو بعد ربط المنفذ — بدون هذا،
// عطل غير مُمسك يُنهي العملية بصمت من منظور لوحة Hostinger (لا سطر واحد يوضح السبب).
process.on('uncaughtException', (err) => {
  console.error('[hostinger-app] uncaughtException:', err && err.stack ? err.stack : err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[hostinger-app] unhandledRejection:', reason);
  process.exit(1);
});

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

function resolvePort() {
  const raw = process.env.PORT;
  const port = Number(raw);
  if (!raw || !Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(
      `[hostinger-app] PORT غير صالح: "${raw ?? ''}". يجب أن توفّره Hostinger كرقم صحيح بين 1 و65535 — لا يوجد احتياطي محلي لـWeb (هذا المسار مخصص للتشغيل المُدار فقط).`,
    );
    process.exit(1);
  }
  return port;
}

function startWebInProcess() {
  // نفس السبب الذي أوجب تشغيل API داخل عملية Hostinger نفسها (بلا
  // child/grandchild process): Hostinger يراقب ويوجّه الحركة إلى العملية
  // التي أطلقها هو تحديدًا. `spawn('npm', ['run', 'start', ...])` كان
  // ينتج grandchild فعليًا (hostinger-app.js -> npm -> next) لا تملكه
  // Hostinger، بالإضافة لاعتماد وقت التشغيل على توفر `npm` في PATH وقت
  // التشغيل (بيئة مختلفة محتملة عن بيئة البناء) بلا أي معالج لحدث
  // 'error' على العملية — أي فشل spawn كان يُسقط العملية الأم بصمت.
  // الحل: تحميل Next.js Custom Server داخل هذه العملية ذاتها.
  const WEB_DIR = path.join(PLATFORM_DIR, 'apps', 'web');
  const port = resolvePort();
  const hostname = '0.0.0.0';

  // يحل `next` من workspace apps/web تحديدًا (بدلًا من require عادي من هذا
  // الملف عند جذر المستودع، حيث لا توجد أي dependency تطبيقية) — يطابق
  // تفكيك npm workspaces الفعلي لموقع الحزمة.
  const { createRequire } = require('node:module');
  const webRequire = createRequire(path.join(WEB_DIR, 'package.json'));
  const next = webRequire('next');
  const http = require('node:http');

  process.chdir(WEB_DIR);

  console.log(`[hostinger-app] Web: بدء التحضير (dir=${WEB_DIR}, hostname=${hostname}, port=${port})`);

  const app = next({ dev: false, dir: WEB_DIR, hostname, port });
  const handle = app.getRequestHandler();

  app
    .prepare()
    .then(() => {
      const server = http.createServer((req, res) => {
        handle(req, res);
      });

      server.on('error', (err) => {
        console.error('[hostinger-app] Web: خطأ في سيرفر HTTP:', err && err.stack ? err.stack : err);
        process.exit(1);
      });

      server.listen(port, hostname, () => {
        console.log(`[hostinger-app] Web listening on ${hostname}:${port}`);
      });

      const shutdown = (sig) => {
        console.log(`[hostinger-app] Web: استلام ${sig} — إغلاق نظيف...`);
        server.close(() => process.exit(0));
      };
      for (const sig of ['SIGINT', 'SIGTERM']) {
        process.on(sig, () => shutdown(sig));
      }
    })
    .catch((err) => {
      console.error('[hostinger-app] Web: فشل app.prepare():', err && err.stack ? err.stack : err);
      process.exit(1);
    });
}

function start() {
  const app = readApp();
  if (app === 'api') {
    startApiInProcess();
    return;
  }
  startWebInProcess();
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
