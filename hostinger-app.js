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
const fs = require('node:fs');
const { execSync } = require('node:child_process');

const PLATFORM_DIR = path.join(__dirname, 'platform');
const WEB_DIR = path.join(PLATFORM_DIR, 'apps', 'web');
const WEB_DIST_DIR = 'next-build';
// نفس بنية المخرجات التي يولّدها Next.js لـ`output: 'standalone'` مع
// outputFileTracingRoot مضبوط على PLATFORM_DIR (جذر workspaces) — انظر
// apps/web/next.config.js. المسار يعكس موضع apps/web نسبةً لهذا الجذر.
const WEB_STANDALONE_DIR = path.join(WEB_DIR, WEB_DIST_DIR, 'standalone', 'apps', 'web');

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
    // Production migration bridge: apply the reviewed additive migration
    // before this build becomes live. Never seeds production data.
    run('npm run migrate:deploy --workspace packages/db');
    run('npm run prisma:generate --workspace packages/db');
    run('npm run build --workspace packages/db');
    run('npm run build --workspace apps/api');
  } else {
    run('npm run build --workspace apps/web');
    copyWebStandaloneAssets();
  }
}

function copyWebStandaloneAssets() {
  // مخرجات `output: 'standalone'` لا تتضمن static assets أو public/ تلقائيًا
  // (توثيق Next.js الرسمي) — يجب نسخها يدويًا بعد البناء ليعمل server.js
  // المولَّد ذاتيًا بلا اعتماد على أي شيء خارج مجلد standalone.
  const staticSrc = path.join(WEB_DIR, WEB_DIST_DIR, 'static');
  const staticDest = path.join(WEB_STANDALONE_DIR, WEB_DIST_DIR, 'static');
  fs.cpSync(staticSrc, staticDest, { recursive: true });

  const publicSrc = path.join(WEB_DIR, 'public');
  if (fs.existsSync(publicSrc)) {
    const publicDest = path.join(WEB_STANDALONE_DIR, 'public');
    fs.cpSync(publicSrc, publicDest, { recursive: true });
  }

  console.log(`[hostinger-app] > نسخ static assets إلى ${WEB_STANDALONE_DIR}`);
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
  // Hostinger's managed Web Apps proxy targets port 3000 and does not always
  // inject a PORT variable. Honour an explicit runtime value when present,
  // otherwise use the platform's documented listening port.
  const raw = process.env.PORT ?? '3000';
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(
      `[hostinger-app] PORT غير صالح: "${raw}". يجب أن يكون رقمًا صحيحًا بين 1 و65535.`,
    );
    process.exit(1);
  }
  return port;
}

function startWebInProcess() {
  // HOSTINGER-TEST-0.4 (custom server عبر next()/createRequire) بقي عند
  // 503 دائم — بلا أي علامة حياة عبر عدة إعادة تشغيل حتى بعد أكثر من
  // دقيقتين انتظار (مقابل نفس نمط "بلا child process" الذي أثبت نجاحه
  // فعليًا مع API)، رغم إثبات محليًا أن نفس الكود يستمع ويرد 200 خلال
  // ثوانٍ. السبب الأرجح: custom server المكتوب يدويًا (next() + prepare()
  // + createRequire عبر حدود npm workspaces) هو الحلقة الأضعف تحديدًا —
  // انظر البند 7 في خطة التشخيص. الحل الرسمي الأبسط لـNext.js على
  // منصات Node.js المُدارة: `output: 'standalone'` (انظر
  // apps/web/next.config.js) يولّد server.js ذاتي الاحتواء يقرأ PORT/
  // HOSTNAME من env مباشرة بلا أي كود تشغيل يدوي — فقط `require` له داخل
  // نفس عملية Hostinger (لا فرق عن نمط API: بلا child/grandchild).
  const port = resolvePort();
  const hostname = '0.0.0.0';

  if (!fs.existsSync(path.join(WEB_STANDALONE_DIR, 'server.js'))) {
    console.error(
      `[hostinger-app] Web: server.js غير موجود في ${WEB_STANDALONE_DIR} — تأكد أن خطوة البناء (node hostinger-app.js build) نُفِّذت بنجاح قبل start.`,
    );
    process.exit(1);
  }

  process.env.PORT = String(port);
  process.env.HOSTNAME = hostname;
  process.chdir(WEB_STANDALONE_DIR);

  console.log(`[hostinger-app] Web: بدء server.js المستقل (dir=${WEB_STANDALONE_DIR}, hostname=${hostname}, port=${port})`);

  const shutdown = (sig) => {
    console.log(`[hostinger-app] Web: استلام ${sig} — إغلاق نظيف...`);
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => shutdown(sig));
  }

  // server.js المولَّد ذاتيًا يستدعي app.prepare() ثم .listen() بنفسه عند
  // التحميل — لا يُصدِّر أي شيء يُستدعى يدويًا.
  require(path.join(WEB_STANDALONE_DIR, 'server.js'));
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
