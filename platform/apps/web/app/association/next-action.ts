export interface AssociationCounts {
  beneficiariesTotal: number; beneficiariesPendingReview: number; beneficiariesApproved: number; beneficiariesRejected: number;
  receiptsAwaitingConfirmation: number; devicesAllocated: number; delegates: number; devicesWithDelegate: number;
  devicesDelivered: number; deliveriesPendingApproval: number; deliveriesPendingReturnApproval: number; deliveriesDeferred: number;
}
export function associationNextAction(c: AssociationCounts, stage?: string | null, associationName?: string | null, covenantCompleted = false) {
  const action = (title: string, detail: string, label: string, href: string, owner = associationName?.trim() || 'لم يتحدد المسؤول بعد') => ({ title, detail, label, href, owner, completed: covenantCompleted ? 'توقيع الميثاق من الطرفين' : 'لا يوجد إجراء مكتمل مؤكّد حتى الآن' });
  if (stage && ['READY_TO_CLOSE', 'CLOSURE_SUBMITTED', 'CLOSED', 'WITHDRAWN'].includes(stage)) return action('متابعة حالة المشاركة', 'المشاركة في مرحلة الإغلاق أو متوقفة؛ راجع الحالة قبل أي إجراء جديد.', 'عرض حالة المشاركة', '/association/participation');
  if (c.deliveriesPendingReturnApproval) return action('تأكيد استلام الأجهزة العائدة', 'أكد الاستلام الفعلي للأجهزة العائدة من المناديب.', 'مراجعة الأجهزة العائدة', '/association/deliveries?status=PENDING_RETURN_APPROVAL');
  if (c.receiptsAwaitingConfirmation) return action('تأكيد استلام الأجهزة', 'لديكم محاضر استلام تنتظر مراجعتكم وتأكيد الكميات الفعلية.', 'مراجعة محاضر الاستلام', '/association/receipts?status=AWAITING_ASSOCIATION_CONFIRMATION');
  if (c.deliveriesPendingApproval) return action('مراجعة إثباتات التسليم', 'توجد تسليمات تنتظر مراجعة الجمعية.', 'مراجعة التسليمات', '/association/deliveries?status=PENDING_DELIVERY_APPROVAL');
  if (!c.beneficiariesTotal) return action('إضافة المستفيدين واحتياجاتهم', 'أضيفوا المستفيدين بملف Excel أو بالإدخال اليدوي.', 'إضافة المستفيدين', '/association/beneficiaries');
  if (!c.beneficiariesApproved && c.beneficiariesPendingReview) return action('بانتظار مراجعة المستفيدين', 'بيانات المستفيدين قيد مراجعة جمعية الزاد؛ يمكنكم متابعة القائمة وإكمالها.', 'متابعة المستفيدين', '/association/beneficiaries?reviewStatus=UNDER_REVIEW', 'جمعية الزاد');
  if (!c.beneficiariesApproved && c.beneficiariesRejected) return action('مراجعة نتائج المستفيدين', 'اطلعوا على أسباب الرفض، وتواصلوا مع إدارة المشروع عند الحاجة.', 'عرض النتائج', '/association/beneficiaries?reviewStatus=REJECTED');
  if (c.devicesAllocated && !c.delegates) return action('إضافة مندوب للتسليم', 'توجد أجهزة مخصصة. أضيفوا المندوب ثم أسندوا له التسليم.', 'إضافة مندوب', '/association/delegates');
  if (c.devicesAllocated) return action('إسناد التسليم للمندوب', 'اختروا المستفيد والمندوب بعد اكتمال تخصيص احتياجات المستفيد.', 'فتح التسليمات', '/association/deliveries');
  if (c.deliveriesDeferred) return action('متابعة التسليمات المؤجلة', 'راجعوا أسباب التأجيل ومواعيد المتابعة.', 'عرض المؤجلة', '/association/deliveries?status=DEFERRED');
  if (c.devicesWithDelegate) return action('التسليم جارٍ مع المناديب', 'تابعوا المهام حتى تقديم إثبات التسليم واعتماده.', 'متابعة التسليمات', '/association/deliveries', 'المناديب');
  if (c.devicesDelivered) return action('متابعة إنجاز المشاركة', 'راجعوا الأجهزة المسلمة والمتطلبات المتبقية؛ التسليم وحده لا يعني اكتمال المشاركة.', 'عرض حالة المشاركة', '/association/participation');
  return action('بانتظار تجهيز الأجهزة', 'تابعوا مراجعة المستفيدين ومحاضر الأجهزة الواردة. لا يلزم تكرار رفع نفس القائمة.', 'متابعة المستفيدين', '/association/beneficiaries', 'جمعية الزاد');
}
