// -------------------- ترقيم الصفحات، البحث، والترتيب --------------------
//
// طبقة عامة يستخدمها كل list*() في الملفات الأخرى (Beneficiaries.gs،
// DevicesAssociations.gs، Delegates.gs، Applications.gs، Normalize.gs).
// ملاحظة صادقة: Google Sheets لا يوفّر "اجلب الصف 4001 حتى 4025" حقيقيًا
// دون فهرس خارجي — القراءة تبقى قراءة الورقة كاملة عبر readTable_ (مرة
// واحدة فقط لكل طلب بفضل _TABLE_CACHE_ الموجودة أصلًا)، والترقيم هنا
// يُقلّص حجم الاستجابة المُرسَلة فعليًا للعميل وحجم DOM المطلوب رسمه، لا
// عدد قراءات Sheets API نفسها. هذا الفرق موثَّق صراحة في RELEASE.md.

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 25;

/** يُقصّ مصفوفة عناصر مُفلترة/مُرتَّبة مسبقًا إلى صفحة واحدة + بيانات الترقيم. */
function paginate_(items, options) {
  options = options || {};
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(options.pageSize) || DEFAULT_PAGE_SIZE)));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(options.page) || 1)));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total: total, page: page, pageSize: pageSize, totalPages: totalPages
  };
}

/** بحث نصي بسيط عبر عدة حقول — غير حسّاس لحالة الأحرف، يتجاهل استعلامًا فارغًا. */
function applySearch_(items, query, fields) {
  query = String(query || '').trim().toLowerCase();
  if (!query) return items;
  return items.filter(item => fields.some(field => String(item[field] || '').toLowerCase().indexOf(query) >= 0));
}

/** ترتيب بحقل واحد اختياري؛ يتجاهل الطلب إن كان الحقل غير موجود أصلًا. */
function applySort_(items, sortBy, sortDir) {
  if (!sortBy || !items.length || !(sortBy in items[0])) return items;
  const dir = sortDir === 'desc' ? -1 : 1;
  return items.slice().sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av || '').localeCompare(String(bv || ''), 'ar') * dir;
  });
}
