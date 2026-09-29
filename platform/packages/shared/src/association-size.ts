/** Financial size selected by the applicant; ranges are display guidance, not an automated eligibility decision. */
export const ASSOCIATION_SIZE_OPTIONS = [
  { value: 'متناهية الصغر', range: 'أقل من 500 ألف ريال' },
  { value: 'صغيرة', range: '501 ألف إلى 2 مليون ريال' },
  { value: 'متوسطة', range: '2 مليون إلى 8 ملايين ريال' },
  { value: 'كبيرة', range: '8 ملايين إلى 30 مليون ريال' },
  { value: 'متناهية الكبر', range: 'أكثر من 30 مليون ريال' },
] as const;
