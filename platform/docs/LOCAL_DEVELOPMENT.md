# LOCAL_DEVELOPMENT.md

## المتطلبات

- Node.js 24 LTS (`>=24.0.0` في `package.json` بكل الـworkspaces).
- Docker + Docker Compose (لـPostgreSQL وMinIO محليًا).
- npm (يأتي مع Node) — المشروع يستخدم npm workspaces، لا pnpm/yarn.

> ملاحظة: بيئة تطوير هذه الجلسة نفسها كانت مزوَّدة بـNode 22 فقط (لا
> اتصال بمثبِّت Node 24 في تلك اللحظة) — التحقق الفعلي
> (`typecheck`/`lint`/`test`/`build`) نجح بالكامل عليها رغم ذلك (تحذير
> `EBADENGINE` فقط، لا فشل)، لكن `engines.node` في كل `package.json`
> يبقى `>=24.0.0` كمتطلب رسمي للمشروع — استخدم Node 24 فعليًا في أي
> بيئة تطوير أو CI حقيقية.

## التشغيل الكامل (Docker)

```bash
cd platform
cp .env.example .env   # عدّل القيم محليًا عند الحاجة — لا تدفعه لِGit
docker compose -f infra/docker/docker-compose.yml up --build
```

هذا يشغّل: `postgres` (PostgreSQL 18)، `minio` (تخزين كائنات متوافق مع
S3 للتطوير المحلي)، `api` (NestJS على المنفذ 3001)، `web` (Next.js على
المنفذ 3000).

بعد أن يصبح `postgres` جاهزًا:

```bash
npm run db:migrate:dev --workspace packages/db   # أو: npm run migrate:deploy إن كنت تطبّق migrations موجودة فقط
npm run db:seed
```

افتح `http://localhost:3000` للواجهة، و`http://localhost:3001/api/v1/health`
للتحقق من الـAPI، و`http://localhost:3001/api/v1/docs` لتوثيق Swagger.

## التشغيل بدون Docker (تطوير سريع للـAPI/الواجهة فقط)

يتطلب PostgreSQL محليًا (أو عبر Docker لقاعدة البيانات فقط):

```bash
cd platform
npm install --workspaces --include-workspace-root
cp .env.example .env
docker compose -f infra/docker/docker-compose.yml up -d postgres minio

npm run build --workspace packages/shared
npm run prisma:generate --workspace packages/db
npm run build --workspace packages/db
npm run db:migrate:dev --workspace packages/db
npm run db:seed

npm run dev:api    # طرفية منفصلة
npm run dev:web    # طرفية أخرى
```

## تشغيل اختبارات API E2E التدميرية بأمان

هذه الاختبارات تنفذ `deleteMany`، ولذلك لا تُشغَّل على قاعدة تطوير عادية أو
أي مورد إنتاج. أنشئ قاعدة PostgreSQL **منفصلة مخصصة للاختبارات فقط** باسم
واضح مثل `alzad_platform_test`، وطبّق عليها الـmigrations بعد التحقق من
الاسم والمضيف. لا تستخدم رابط Supabase/Hostinger أو تخزين الإنتاج.

من جذر `platform/` في PowerShell، وبعد تجهيز قاعدة الاختبار المعزولة:

```powershell
$env:NODE_ENV = 'test'
$env:DATABASE_URL = 'postgresql://test_user:test_password@localhost:5432/alzad_platform_test?schema=public'
$env:ALLOW_DESTRUCTIVE_E2E = 'true'
$env:E2E_ALLOWED_DATABASE_NAMES = 'alzad_platform_test'
$env:OBJECT_STORAGE_BUCKET = 'alzad-platform-test'
$env:E2E_ALLOWED_BUCKET_NAMES = 'alzad-platform-test'
$env:E2E_INIT_CANARY = 'true'
npx ts-node --transpile-only apps/api/test/utils/init-test-db-roles.ts
npm run migrate:deploy --workspace packages/db
npx ts-node --transpile-only apps/api/test/utils/create-test-canary.ts
Remove-Item Env:E2E_INIT_CANARY
npm run test:e2e --workspace apps/api -- --runInBand
```

القيم أعلاه أمثلة اختبارية فقط وليست بيانات اعتماد حقيقية. سكربت إنشاء
الـcanary لا يعمل إلا عند تحقق شروط البيئة والـallowlist، وينشئ جدول
`e2e_safety_canary` داخل قاعدة الاختبار فقط. يفحص Jest وجود العلامة من
قاعدة البيانات المتصلة **قبل تحميل أي ملف اختبار**؛ غيابها أو تعذّر
الاتصال يوقف الاختبارات قبل أي seed أو cleanup. في CI تُنشأ قاعدة
`alzad_platform_ci` وbucket اختبار محلي، ثم تُنشأ العلامة وتُفحَص قبل
البذر. لا توجد migration إنتاجية لهذا الجدول.

إذا استُخدم MinIO خارجي للاختبارات، اضبط
`OBJECT_STORAGE_EXTERNAL=true` و`OBJECT_STORAGE_ENDPOINT` على عنوان
محلي (`localhost` أو `127.0.0.1`) فقط. لا تستخدم endpoint إنتاجيًا.

## أوامر شائعة (من جذر `platform/`)

| الأمر | الوصف |
|---|---|
| `npm run typecheck` | فحص أنواع TypeScript لكل الـworkspaces (strict mode) |
| `npm run lint` | ESLint لـapps/api وapps/web |
| `npm run test` | اختبارات apps/api (وapps/web إن وُجدت) |
| `npm run build` | بناء كل الـworkspaces بالترتيب الصحيح للاعتماديات |
| `npm run prisma:validate` | التحقق من صحة `schema.prisma` (لا يحتاج اتصال قاعدة بيانات حي) |
| `npm run prisma:generate` | توليد Prisma Client في `packages/db/generated/client` |
| `npm run db:migrate:dev` | تطبيق/إنشاء migrations تطويرية (يحتاج `DATABASE_URL` صالحًا) |
| `npm run db:seed` | بذر بيانات تطوير اصطناعية (لا بيانات حقيقية) |

## بيانات البذر (Development فقط)

`packages/db/src/seed.ts` ينشئ: حساب ADMIN واحد، جمعيتَين تجريبيتَين
بحسابَي ASSOCIATION ومندوب لكل منهما، ومستفيدًا واحدًا باحتياج واحد لكل
جمعية — **لا بيانات شخصية حقيقية إطلاقًا**. آمن لإعادة التشغيل (upsert
بكل مكان).

## بنية المستودع (`platform/`)

```
platform/
  apps/
    api/     ← NestJS REST API (يُبنى بـ`nest build`)
    web/     ← Next.js App Router (RTL)
  packages/
    db/      ← Prisma schema + migrations + client مشترك
    shared/  ← enums وخرائط عربية مشتركة بين api وweb
  infra/
    docker/  ← docker-compose.yml + Dockerfiles
  docs/      ← هذا المستند وبقية وثائق التصميم
```

## مشاكل شائعة

- **"Environment variable not found: DATABASE_URL"** عند تشغيل أي أمر
  Prisma: تأكد من وجود `platform/.env` (انسخه من `.env.example`) وأن
  الأداة التي تُشغِّلها تقرأه (الأوامر أعلاه عبر `npm run` من
  `packages/db` تعتمد على متغيرات البيئة المصدَّرة في الطرفية أو ملف
  `.env` محمَّل تلقائيًا بواسطة Prisma CLI نفسه عند وجوده في نفس
  المجلد).
- **`EBADENGINE` تحذير عند `npm install`**: يعني أن Node المحلي أقدم من
  24 — تحذير فقط، لا يمنع العمل، لكن يُفضَّل الترقية لمطابقة CI.
