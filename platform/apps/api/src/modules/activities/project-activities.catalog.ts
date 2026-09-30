/** أنشطة مشروع الأجهزة الكهربائية، من الجدول المعتمد المقدم لجمعية الزاد (صفحتان، 13 صفًا). */
export const PROJECT_ACTIVITY_PHASE = 'أنشطة مشروع الأجهزة الكهربائية';

export interface ProjectActivityCatalogItem {
  order: number;
  name: string;
  startDate: string;
  endDate: string;
  workDays: number;
  outcome: string;
  steps: readonly [string, string, string, string];
}

export const PROJECT_ACTIVITY_CATALOG: readonly ProjectActivityCatalogItem[] = [
  {
    order: 1, name: 'إعداد واعتماد بطاقة المشروع', startDate: '2026-07-30', endDate: '2026-08-04', workDays: 4,
    outcome: 'بطاقة المشروع معتمدة.',
    steps: ['تحديد نطاق المشروع.', 'تحديد الأدوار.', 'تحديد الأنشطة الرئيسية.', 'اعتماد البطاقة.'],
  },
  {
    order: 2, name: 'إعداد واعتماد وثيقة المشروع والخطة التنفيذية', startDate: '2026-08-05', endDate: '2026-08-10', workDays: 4,
    outcome: 'وثيقة المشروع معتمدة.',
    steps: ['إعداد مسودة الوثيقة.', 'مراجعة الوثيقة.', 'اعتماد الوثيقة.', 'تعميم الوثيقة المعتمدة.'],
  },
  {
    order: 3, name: 'إعداد واعتماد سياسة مشاركة واختيار الجمعيات', startDate: '2026-08-11', endDate: '2026-08-13', workDays: 3,
    outcome: 'سياسة اختيار الجمعيات معتمدة من الجمعية والمؤسسة.',
    steps: ['إعداد مسودة السياسة.', 'مراجعة السياسة.', 'اعتماد السياسة.', 'تعميم السياسة المعتمدة.'],
  },
  {
    order: 4, name: 'إعداد دليل التنفيذ للجمعيات واتفاقية المشاركة', startDate: '2026-08-16', endDate: '2026-08-27', workDays: 10,
    outcome: 'دليل التنفيذ واتفاقية المشاركة معتمدان.',
    steps: ['إعداد مسودة دليل التنفيذ.', 'تصميم النماذج الإلكترونية.', 'مراجعة اتفاقية المشاركة.', 'اعتماد الدليل والاتفاقية.'],
  },
  {
    order: 5, name: 'إطلاق فرصة المشاركة واستقبال طلبات الجمعيات', startDate: '2026-08-30', endDate: '2026-09-07', workDays: 7,
    outcome: 'قائمة بالجمعيات التي تقدمت بطلبات مكتملة.',
    steps: ['الإعلان عن فرصة المشاركة.', 'استقبال طلبات الجمعيات وملفات المستفيدين والاحتياجات.', 'مراجعة اكتمال الطلبات والمرفقات.', 'إغلاق باب التقديم.'],
  },
  {
    order: 6, name: 'تقييم طلبات الجمعيات واعتماد القائمة الأساسية والاحتياطية', startDate: '2026-09-08', endDate: '2026-09-14', workDays: 5,
    outcome: 'قائمة الجمعيات الأساسية والاحتياطية، متضمنة أعداد المستفيدين وفئاتهم واحتياجاتهم، معتمدة من المؤسسة.',
    steps: ['فرز الطلبات والتحقق من استيفائها.', 'تقييم الجمعيات وقوائم المستفيدين والاحتياجات.', 'إعداد القائمة الأساسية والاحتياطية وقوائم المستفيدين والاحتياجات المقبولة.', 'اعتماد النتائج من الجمعية والمؤسسة.'],
  },
  {
    order: 7, name: 'توقيع اتفاقيات المشاركة وتهيئة الجمعيات', startDate: '2026-09-15', endDate: '2026-09-24', workDays: 7,
    outcome: 'اتفاقيات موقعة بين جمعية الزاد والجمعيات المنفذة.',
    steps: ['إرسال الاتفاقيات.', 'استلام الاتفاقيات موقعة.', 'شرح آلية التنفيذ.', 'إرسال النظام الإلكتروني.'],
  },
  {
    order: 8, name: 'عروض أسعار للأجهزة الكهربائية، مع إجراء مقارنة بينها، وترشيح المورد الأنسب للمؤسسة للاعتماد النهائي', startDate: '2026-09-27', endDate: '2026-10-05', workDays: 7,
    outcome: 'عروض أسعار، وجدول مقارنة فني ومالي، وتوصية بالمورد المرشح.',
    steps: ['إعداد طلب عروض الأسعار.', 'استقبال العروض.', 'إجراء المقارنة الفنية والمالية.', 'ترشيح المورد الأنسب للمؤسسة للاعتماد النهائي.'],
  },
  {
    order: 9, name: 'اعتماد تخصيص الأجهزة وإصدار أوامر الشراء', startDate: '2026-10-06', endDate: '2026-10-12', workDays: 5,
    outcome: 'أوامر شراء معتمدة وجاهزة للتنفيذ.',
    steps: ['تحديد الكميات النهائية لكل جمعية.', 'إصدار أوامر الشراء.', 'توثيق تخصيص الأجهزة.', 'اعتماد أوامر الشراء.'],
  },
  {
    order: 10, name: 'توريد الأجهزة للجمعيات وفق المسارات المعتمدة', startDate: '2026-10-13', endDate: '2026-10-26', workDays: 10,
    outcome: 'سندات توريد، وفواتير، وإشعارات تسليم للجمعيات.',
    steps: ['تنسيق مواعيد ومسارات التوريد.', 'توريد الأجهزة للجمعيات.', 'توثيق الاستلام.', 'التحقق من الكميات ومعالجة النقص أو التلف.'],
  },
  {
    order: 11, name: 'توزيع الأجهزة على الأسر المستفيدة', startDate: '2026-10-27', endDate: '2026-11-23', workDays: 20,
    outcome: 'ملف مشترك لتوثيق تسليم الأجهزة للأسر، وصور التوثيق، وكشوف التوزيع، ونحوها.',
    steps: ['تسليم الأجهزة للأسر.', 'توثيق الاستلام لكل أسرة.', 'معالجة التعثر أو النقص أو التلف.', 'تأكيد تسليم كامل الأجهزة.'],
  },
  {
    order: 12, name: 'استلام تقارير إغلاق الجمعيات', startDate: '2026-11-24', endDate: '2026-12-14', workDays: 15,
    outcome: 'ملف مشترك لرفع التقارير الختامية لكل منطقة/جمعية.',
    steps: ['استلام التقارير.', 'مراجعتها للتأكد من اكتمال التنفيذ.', 'توثيق الملاحظات.', 'اعتماد التقارير النهائية.'],
  },
  {
    order: 13, name: 'إعداد التقرير الختامي وإغلاق المشروع', startDate: '2026-12-15', endDate: '2027-01-04', workDays: 15,
    outcome: 'استبانات رضا، وتقرير ختامي، ودروس مستفادة.',
    steps: ['إعداد التقرير الختامي.', 'مراجعة التقرير.', 'اعتماد التقرير.', 'اعتماد الإغلاق من الجهة الداعمة.'],
  },
];

/** لا تفترض تحقق أي خطوة: القالب يورد الخطة فقط، والشواهد والحالة يعدلهما الأدمن يدويًا. */
export function projectActivityRows() {
  return PROJECT_ACTIVITY_CATALOG.flatMap((activity) => [
    {
      phaseOrder: 1, phaseName: PROJECT_ACTIVITY_PHASE,
      mainActivityOrder: activity.order, mainActivityName: activity.name,
      subActivityName: null as string | null,
      startDate: new Date(`${activity.startDate}T00:00:00.000Z`),
      endDate: new Date(`${activity.endDate}T00:00:00.000Z`),
      status: 'NOT_STARTED', completionPercent: 0,
      notes: `المدة المخططة: ${activity.workDays} أيام عمل. المخرج: ${activity.outcome}`,
      evidenceUrl: null as string | null,
    },
    ...activity.steps.map((step) => ({
      phaseOrder: 1, phaseName: PROJECT_ACTIVITY_PHASE,
      mainActivityOrder: activity.order, mainActivityName: activity.name,
      subActivityName: step,
      startDate: new Date(`${activity.startDate}T00:00:00.000Z`),
      endDate: new Date(`${activity.endDate}T00:00:00.000Z`),
      status: 'NOT_STARTED', completionPercent: 0,
      notes: null as string | null,
      evidenceUrl: null as string | null,
    })),
  ]);
}
