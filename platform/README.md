# منصة الزاد الحالية

التطبيق الجاري تشغيله مبني على Next.js وNestJS وPrisma وPostgreSQL.
ملفات Google Apps Script في جذر المستودع تاريخية وليست مسار البناء الحالي.

## المتطلبات

- Node.js 24 أو أحدث، npm 11.x.
- PostgreSQL مخصص للتطوير؛ اختبارات E2E التدميرية تحتاج قاعدة **اختبار معزولة**.
- تخزين S3 متوافق (MinIO محليًا) عند اختبار الرفع أو تشغيل النظام كاملًا.

## تثبيت وبناء من clone نظيف

من مجلد `platform/`:

```bash
npm ci
npm ls --all=false
npm run prisma:validate
npm run typecheck
npm run lint
npm test
npm run build
```

`npm ci` يولد Prisma Client ويبني الحزمتين المشتركتين آليًا. `prebuild`
يفحص بصمة schema وlockfile ويعيد التوليد فقط إذا تغيرا. لا تستخدم
`--force` أو `--legacy-peer-deps` لإخفاء خلل التبعيات.

الاختبارات العامة لا ترسل بريدًا. لتشغيل API E2E، راجع
[`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md) لإعداد قاعدة
اختبار وcanary وbucket آمن؛ الحاجز يرفض التشغيل دونها.

إعدادات البريد الإنتاجي إلزامية ومخزنة خارج GitHub. راجع
[`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md) ودليل النسخ والاستعادة
قبل فتح المنصة للمستخدمين.
