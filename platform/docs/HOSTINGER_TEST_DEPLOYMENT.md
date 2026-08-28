# نشر TEST على Hostinger — HOSTINGER-TEST-0

> **هذا الملف يخص بيئة TEST فقط. لا يُخوِّل هذا الملف أو أي جزء منه نشر
> Production بأي شكل. لم يُنفَّذ أي نشر فعلي من هذه الجلسة إطلاقًا —
> هذا توثيق تحضيري لمشغِّل بشري ينفّذ الإعداد يدويًا عبر لوحة Hostinger.**

## الآلية المعتمدة (باختصار)

- Hostinger يتطلّب `package.json` عند جذر المستودع. المستودع الفعلي
  للتطبيق يبقى بالكامل تحت `/platform` (npm workspaces قائم بذاته) —
  لم يُنقَل ولم يُكرَّر شيء.
- أُضيف عند جذر المستودع ملفان فقط:
  - `package.json` — واجهة/غلاف بلا أي dependency تطبيقي، سكربتاته
    تُفوِّض بالكامل إلى `/platform`.
  - `hostinger-app.js` — مُوزِّع (dispatcher) صغير حتمي، بلا أي
    dependency جديدة (Node.js core فقط: `child_process` لخطوتَي
    التثبيت والبناء، `http`/`node:module` لتشغيل Web)، يقرأ متغيّر
    البيئة `HOSTINGER_APP` (`api` أو `web`) ويبني/يشغّل التطبيق
    المطابق فقط.
- **نفس الفرع، نفس الـcommit، تطبيقان منفصلان على Hostinger**، كل
  تطبيق بمتغيّر `HOSTINGER_APP` مختلف:
  - `HOSTINGER_APP=api` → NestJS API (`platform/apps/api`)
  - `HOSTINGER_APP=web` → Next.js Web (`platform/apps/web`)
- ملف بدء التشغيل (Application Startup File) في كلا تطبيقَي Hostinger:
  **`hostinger-app.js`** (بلا وسيط — الوضع الافتراضي `start`).
- عند "NPM Install" في لوحة Hostinger: `postinstall` في `package.json`
  الجذري **يُثبِّت فقط** — `npm ci` حتميًا من `platform/package-lock.json`
  الموجود فعلاً (تم التحقق من توافقه مع الـworkspace الحالي، تُثبَّت به
  كل تبعيات كل الـworkspaces دفعة واحدة). **لا بناء إطلاقًا داخل
  `postinstall`** — البناء خطوة منفصلة تمامًا (انظر أدناه) لتفادي أي
  ازدواج في البناء خلال نفس عملية النشر، وكذلك **بلا** `prisma migrate
  deploy` و**بلا** `prisma db seed` إطلاقًا في أي مسار من هذا المُوزِّع.
- **خطوة البناء منفصلة عن التثبيت**: `package.json` الجذري يعرّف سكربت
  `build` (`npm run build` ← `node hostinger-app.js build`) الذي يبني
  حصرًا ما يحتاجه `HOSTINGER_APP` (API أو Web). تُضبَط لوحة Hostinger
  على حقل "Build Command" منفصل بقيمة `npm run build`، يُنفَّذ مرة
  واحدة بعد "NPM Install" وقبل بدء التشغيل — انظر "إعدادات Hostinger
  المتوقَّعة" أدناه للقيم الدقيقة لكل تطبيق. لا يُنفَّذ البناء تلقائيًا
  أكثر من مرة واحدة في أي حال (لا ازدواج بين `postinstall` والبناء).
- **التشغيل الفعلي لكلا التطبيقين يتم داخل نفس عملية Node.js التي
  تُطلقها Hostinger مباشرةً — بلا أي `child_process.spawn` إطلاقًا
  لأي منهما:**
  - **API**: `process.chdir` إلى `/platform` ثم `require` للمسار
    المطلق `apps/api/dist/src/main.js` (البناء الإنتاجي الحقيقي، لا
    `nest start`).
  - **Web**: `output: 'standalone'` (`apps/web/next.config.js`، مع
    `experimental.outputFileTracingRoot` مضبوط على `/platform` ليشمل
    التتبّع تبعيات npm workspaces المُرقّاة). خطوة البناء تُنتج
    `apps/web/.next/standalone/apps/web/server.js` ذاتي الاحتواء (ينسخ
    `hostinger-app.js` بعدها static assets و`public/` إليه — Next.js لا
    يضمّها تلقائيًا في مخرجات standalone)، ثم `start` يكتفي بـ
    `require()` لهذا الملف مباشرة بعد ضبط `PORT`/`HOSTNAME` في env — هو
    نفسه يستدعي `app.prepare()` وaَ`.listen()` داخليًا. **لا** `npm run
    start`، **لا** `next start` كعملية منفصلة، **ولا** أي `next()`
    مُستدعى يدويًا. (HOSTINGER-TEST-0.4 استخدم custom server يدوي عبر
    `next()`/`createRequire` — أثبت هذا محليًا نجاحه، لكنه بقي عند 503
    دائم على Hostinger فعليًا عبر عدة إعادة تشغيل؛ `output: 'standalone'`
    هو مسار Next.js الرسمي الأبسط لهذا النوع من الاستضافة، فاستُبدِل به.)
  - السبب واحد لكليهما: عملية Hostinger المُدارة (التي تراقبها لوحة
    Restart/Stop، وإليها يُوجَّه الحركة) يجب أن تكون هي ذاتها التي
    تربط `PORT`. أي عملية ابن (child) أو حفيد (grandchild) — مثل
    `hostinger-app.js → npm → next` سابقًا لـWeb — تُبقي `PORT`
    مربوطًا في عملية لا تملكها/تراقبها Hostinger فعليًا، فإما يبقى
    `EADDRINUSE` عالقًا بعد Restart (كما ثبت مع API)، أو لا تصل
    الحركة أبدًا للعملية الابن فيظهر `503 Service Unavailable` (كما
    ثبت مع أول نشر لـWeb) — بصرف النظر عن نجاح البناء تمامًا.
  - كلا المسارين يُسجّلان بدء التشغيل والإغلاق النظيف (`SIGINT`/
    `SIGTERM`) في السجلّ، وتُمسَك أي أخطاء غير متوقعة
    (`uncaughtException`/`unhandledRejection`) بتسجيل واضح بلا أسرار
    بدل انهيار صامت.
- **منفذ الاستماع لكلا التطبيقين يأتي من `PORT` التي توفّرها بيئة
  Hostinger المُدارة تلقائيًا — لا يُضبَط أي منفذ يدويًا في لوحة
  Hostinger.** ترتيب الأولوية في API: `PORT` → `API_PORT` (احتياطي
  محلي/CI/يدوي فقط) → `3001` (احتياطي أخير محلي). **Web لا يملك أي
  احتياطي محلي عمدًا** — إن غابت `PORT` أو كانت غير صالحة يرفض
  `hostinger-app.js` الإقلاع فورًا برسالة واضحة (هذا المسار مخصص
  للتشغيل المُدار فقط؛ للتطوير المحلي استخدم `npm run dev --workspace
  apps/web`، الذي يبقى `next dev -p 3000` بلا أي تعديل).

## متغيّرات البيئة — تُضبَط حصرًا عبر لوحة Hostinger (Environment
## Variables)، أبدًا عبر ملف `.env` مُلتزَم به

### مشتركة لكلا التطبيقين

| المتغيّر | القيمة |
|---|---|
| `HOSTINGER_APP` | `api` لتطبيق الـAPI، `web` لتطبيق الواجهة (إلزامي، لا قيمة افتراضية) |

### تطبيق API فقط (`HOSTINGER_APP=api`)

| المتغيّر | الغرض | ملاحظة |
|---|---|---|
| `API_PORT` | منفذ الاستماع (احتياطي فقط) | **لا يُضبَط على Hostinger** — منفذ Hostinger المُدار يأتي عبر `PORT` تلقائيًا وله الأولوية دائمًا. `API_PORT` للاستخدام المحلي/CI/اليدوي فقط، الافتراضي يبقى `3001` بلا مساس |
| `API_BASE_PATH` | بادئة المسار العامة | اختياري، الافتراضي `/api/v1` |
| `CORS_ORIGIN` | أصل الواجهة المسموح | يجب أن يكون رابط تطبيق Web على Hostinger (TEST) |
| `NODE_ENV` | بيئة التشغيل | `production` يُفعِّل `assertProductionSecretsConfigured()` (رفض إقلاع صريح إن بقيت أي مفاتيح HMAC حسّاسة بقيمتها الافتراضية للتطوير) — **موصى به حتى في TEST** لعدم إضعاف الفحص |
| `DATABASE_URL` | اتصال Postgres | **Supabase Session Pooler، منفذ 5432 حصرًا** — راجع الصيغة أدناه، لا قيمة حقيقية هنا |
| `AUTH_RATE_LIMIT_HMAC_KEY` | سرّ HMAC لتحديد المعدَّل | يجب قيمة عشوائية طويلة حقيقية، لا الافتراضي التطويري |
| `AUTH_CREDENTIAL_LOOKUP_HMAC_KEY` | سرّ HMAC لبحث بيانات الاعتماد | نفس الشرط أعلاه |
| `AUTH_RESET_TOKEN_HMAC_KEY` | سرّ HMAC لرمز إعادة تعيين كلمة المرور | نفس الشرط أعلاه |
| `AUTH_SESSION_IDLE_SECONDS` | صلاحية الجلسة (خمول) | اختياري، افتراضي 21600 |
| `AUTH_SESSION_ABSOLUTE_SECONDS` | صلاحية الجلسة (مطلقة) | اختياري، افتراضي 43200 |
| `AUTH_PASSWORD_RESET_TTL_SECONDS` | صلاحية رمز الاستعادة | اختياري، افتراضي 900 |
| `AUTH_PASSWORD_RESET_MAX_ATTEMPTS` | محاولات الاستعادة القصوى | اختياري، افتراضي 6 |
| `OBJECT_STORAGE_ENDPOINT` | نقطة تخزين S3-compatible | راجع "التخزين" أدناه |
| `OBJECT_STORAGE_REGION` | إقليم التخزين | راجع "التخزين" أدناه |
| `OBJECT_STORAGE_ACCESS_KEY` | مفتاح وصول التخزين | سرّ — لا قيمة حقيقية هنا |
| `OBJECT_STORAGE_SECRET_KEY` | سرّ وصول التخزين | سرّ — لا قيمة حقيقية هنا |
| `OBJECT_STORAGE_BUCKET` | اسم الـbucket | راجع "التخزين" أدناه |
| `OBJECT_STORAGE_FORCE_PATH_STYLE` | نمط مسار S3 | `'true'` عادة لمزوّدات S3-compatible غير AWS |
| `OBJECT_STORAGE_LICENSE_SIGNED_URL_SECONDS` | عمر الروابط الموقَّعة | اختياري، افتراضي 300 |

### تطبيق Web فقط (`HOSTINGER_APP=web`)

| المتغيّر | الغرض | ملاحظة |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | رابط الـAPI الكامل الذي تستدعيه الواجهة | **لا يُضبَط داخل الكود إطلاقًا** — يجب أن يشير لرابط تطبيق API على Hostinger (TEST)، مثال شكلي: `https://<hostinger-test-api-app>.example/api/v1` — لا يوجد أي hostname حقيقي مضمَّن في هذا المستند |

> Web أيضًا يستخدم `PORT` التي توفّرها Hostinger تلقائيًا — يقرؤها
> `hostinger-app.js` مباشرةً ويمرّرها لـNext.js Custom Server
> (`listen(port, '0.0.0.0')`) — **لا يُضبَط أي منفذ يدويًا، ولا قيمة
> احتياطية محلية لهذا المسار.**

## قاعدة البيانات — Supabase PostgreSQL (Session Pooler، منفذ 5432)

`DATABASE_URL` **مثال شكلي فقط، ليست بيانات اعتماد حقيقية**:

```
postgresql://<db-user>:<db-password>@<project-ref>.pooler.supabase.com:5432/postgres?schema=public&sslmode=require
```

- المنفذ **5432 حصرًا** (Session Pooler) — لا Transaction Pooler (6543) لأن Prisma يحتاج جلسات ثابتة لبعض العمليات (transactions/advisory locks) المستخدَمة فعليًا في هذه المنصة.
- Prisma/PostgreSQL يبقى تكامل قاعدة البيانات الوحيد — **لا** إضافة Supabase JS SDK ما لم تظهر حاجة فعلية لاحقًا (لم تظهر هنا).

### الترحيل اليدوي الصريح لـTEST (لا يُشغَّل تلقائيًا أبدًا)

بعد ضبط `DATABASE_URL` (Supabase Session Pooler) في بيئة تنفيذ يدوية
(جهاز مطوِّر محلي أو طرفية Hostinger إن وُجدت)، من داخل `/platform`:

```bash
DATABASE_URL="<supabase-session-pooler-url>" npm run migrate:deploy --workspace packages/db
```

لا يُشغِّل أي مسار في `hostinger-app.js`/`package.json` الجذري هذا الأمر تلقائيًا أبدًا — لا عند التثبيت، ولا عند البناء، ولا عند بدء التشغيل. البذر (`npm run db:seed`) كذلك يدوي حصرًا ولا يُشغَّل من هذا المُوزِّع إطلاقًا.

## التخزين (S3-compatible)

يبقى العقد الحالي (`StorageService`) كما هو بلا أي تعديل. `OBJECT_STORAGE_*`
أعلاه placeholders فقط — قد تُستخدَم لاحقًا Supabase Storage عبر توافقها
مع S3 (نفس المتغيّرات، نقطة نهاية مختلفة فقط) بلا أي تغيير كود.

## إعدادات Hostinger المتوقَّعة — API

- Application root: جذر المستودع (حيث `package.json` الجديد).
- Node.js version: ≥ 24 (مطابق لـ`engines.node` في `package.json` الجذري و`platform/package.json`).
- Environment variable: `HOSTINGER_APP=api` (إلزامي).
- **Install command**: تلقائي عبر "NPM Install" في اللوحة → يُشغِّل `postinstall` → `npm ci` فقط (بلا بناء).
- **Build command**: `npm run build` (ينفّذ `node hostinger-app.js build`، يبني API فقط بسبب `HOSTINGER_APP=api`).
- **Start command / entry (Application Startup File)**: `hostinger-app.js` (بلا وسيط — الوضع الافتراضي `start`؛ أو `npm start` إن كانت اللوحة تتطلب سكربت start بدل ملف بدء تشغيل مباشر — كلاهما ينفّذ نفس المسار).
- منفذ الاستماع: **`PORT` يوفّرها Hostinger تلقائيًا ولها الأولوية دائمًا** (ترتيب: `PORT` → `API_PORT` → `3001`) — لا تُضبَط `API_PORT` على Hostinger، ولا يُضبَط أي منفذ يدويًا.

## إعدادات Hostinger المتوقَّعة — Web

- Application root: جذر المستودع (نفس الفرع/الـcommit، تطبيق Hostinger منفصل).
- Node.js version: ≥ 24.
- Environment variable: `HOSTINGER_APP=web` (إلزامي).
- **Install command**: تلقائي عبر "NPM Install" في اللوحة → `postinstall` → `npm ci` فقط (بلا بناء).
- **Build command**: `npm run build` (ينفّذ `node hostinger-app.js build`، يبني Web فقط بسبب `HOSTINGER_APP=web`).
- **Start command / entry (Application Startup File)**: `hostinger-app.js` (أو `npm start` إن كانت اللوحة تتطلب سكربت start بدل ملف بدء تشغيل مباشر — نفس المسار).
- **Output Directory**: اتركه فارغًا (كما هو). طُبِّق preset "Other" مع
  Output Directory فارغ محليًا وأثبت أن `platform/apps/web/.next`
  موجود فعليًا عند وقت التشغيل بعد `npm run build` (تحقّق محلي مباشر
  — انظر قسم "التحقق المحلي" في تقرير HOSTINGER-TEST-0.4). ضبط Output
  Directory على قيمة مثل `.next` أو `platform/apps/web/.next` قد
  يجعل Hostinger يقصر runtime على تلك المجلد فقط، فيختفي
  `hostinger-app.js` نفسه (الموجود عند جذر المستودع) من بيئة التشغيل
  — **لا تُغيَّر هذه القيمة**.
- منفذ الاستماع: **`PORT` يوفّرها Hostinger تلقائيًا وإلزامية** —
  يقرؤها `hostinger-app.js` مباشرةً ويمرّرها لـNext.js Custom Server.
  لا يُضبَط أي منفذ يدويًا، ولا يوجد احتياطي محلي لهذا المسار (غياب
  `PORT` أو قيمة غير صالحة يوقف الإقلاع فورًا برسالة واضحة). للتطوير
  المحلي استخدم `npm run dev --workspace apps/web` (يبقى `next dev -p
  3000`، بلا أي تعديل).

## تأكيد صريح

- **لم يُنفَّذ أي نشر Production ولن يُنفَّذ من هذه الجلسة.**
- **هذا لبيئة TEST حصرًا.**
- لا سرّ حقيقي، لا رابط Supabase حقيقي، لا مفتاح وصول تخزين حقيقي، لا اسم مضيف حقيقي مذكور في هذا الملف أو أي ملف آخر في هذا الـcommit.
