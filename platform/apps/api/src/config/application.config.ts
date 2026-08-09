/**
 * إعدادات نطاق طلبات انضمام الجمعيات (NODE-2) — حدود/قيود منقولة
 * حرفيًا من Applications.gs/Validation.gs/Config.gs. راجع
 * platform/docs/ASSOCIATION_APPLICATIONS.md لمصدر كل قيمة.
 */
export const applicationConfig = {
  /** Legacy: throttle_('apply:'+hash(email), 5, 3600). */
  rateLimitSubmit: { limit: 5, windowSeconds: 3600 },
  /** Legacy: throttle_('appstatus:'+hash(clientRequestId), 20, 3600). */
  rateLimitStatus: { limit: 20, windowSeconds: 3600 },

  nameMaxLength: 150,
  contactNameMaxLength: 100,
  notesMaxLength: 500,
  licenseNumberMaxLength: 60,
  rejectReasonMaxLength: 300,

  /** Applications.gs: validClientRequestId_ */
  clientRequestIdPattern: /^[A-Za-z0-9_-]{8,64}$/,

  timezone: 'Asia/Riyadh',
} as const;
