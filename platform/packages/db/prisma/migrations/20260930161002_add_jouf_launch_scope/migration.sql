-- Add Al Jouf to the approved application scope. No existing data is changed.
-- NCAR official source: https://ncar.gov.sa/regions-coding
-- Retrieved via POST classification/searchArea on 2026-09-30; includes Suwayr.
WITH official_jouf(official_code,name_ar,unit_type,parent_official_code,category) AS (
  VALUES
  ('0013','منطقة الجوف','REGION',NULL,NULL),
  ('0247','مدينة سكاكا','EMIRATE_SEAT','0013','مقر الإمارة'),
  ('2510','مركز خوعاء','ADMIN_CENTER','0247','أ'),
  ('2511','مركز الفياض','ADMIN_CENTER','0247','أ'),
  ('2512','مركز عذفاء','ADMIN_CENTER','0247','أ'),
  ('2513','مركز المرير (الارتباط بمركز الفياض)','ADMIN_CENTER','0247','ب'),
  ('2516','مركز أم إذن (الارتباط بمركز خوعاء)','ADMIN_CENTER','0247','ب'),
  ('2521','مركز مغيراء (الارتباط بمركز خوعاء)','ADMIN_CENTER','0247','ب'),
  ('0248','محافظة القريات','GOVERNORATE','0013','أ'),
  ('2523','مركز الحديثة','ADMIN_CENTER','0248','أ'),
  ('2524','مركز العيساوية','ADMIN_CENTER','0248','أ'),
  ('2525','مركز عين الحواس','ADMIN_CENTER','0248','أ'),
  ('2526','مركز الناصفة','ADMIN_CENTER','0248','أ'),
  ('2527','مركز الحماد','ADMIN_CENTER','0248','ب'),
  ('2528','مركز الوادي','ADMIN_CENTER','0248','أ'),
  ('2529','مركز قليب خضر','ADMIN_CENTER','0248','ب'),
  ('2530','مركز رديفة الجماجم','ADMIN_CENTER','0248','ب'),
  ('0249','محافظة دومة الجندل','GOVERNORATE','0013','أ'),
  ('2531','مركز أبو عجرم','ADMIN_CENTER','0249','أ'),
  ('2532','مركز الأضارع','ADMIN_CENTER','0249','أ'),
  ('2533','مركز أصفان','ADMIN_CENTER','0249','ب'),
  ('2534','مركز الشقيق','ADMIN_CENTER','0249','أ'),
  ('2535','مركز الرديفة والرافعية','ADMIN_CENTER','0249','أ'),
  ('0250','محافظة طبرجل','GOVERNORATE','0013','أ'),
  ('2536','مركز ميقوع','ADMIN_CENTER','0250','أ'),
  ('2537','مركز النبك أبو قصر','ADMIN_CENTER','0250','أ'),
  ('2538','مركز ثنيه أم نخيله','ADMIN_CENTER','0250','ب'),
  ('2539','مركز بسيطا','ADMIN_CENTER','0250','أ'),
  ('2540','مركز الثنيه','ADMIN_CENTER','0250','ب'),
  ('2541','مركز صبيحا','ADMIN_CENTER','0250','ب'),
  ('0252','محافظة صوير','GOVERNORATE','0013','ب'),
  ('2514','مركز طلعة عمار','ADMIN_CENTER','0252','ب'),
  ('2515','مركز زلوم','ADMIN_CENTER','0252','أ'),
  ('2517','مركز الشويحيطية','ADMIN_CENTER','0252','ب'),
  ('2518','مركز الرفيعة','ADMIN_CENTER','0252','أ'),
  ('2519','مركز هديب','ADMIN_CENTER','0252','أ'),
  ('2520','مركز الحرة','ADMIN_CENTER','0252','ب'),
  ('2522','مركز غدير الخيل','ADMIN_CENTER','0252','ب')
)
INSERT INTO public.geographic_units
  (official_code,name_ar,unit_type,parent_official_code,category,source,project_scope_group,active,sort_order)
SELECT official_code,name_ar,unit_type::public."GeographicUnitType",parent_official_code,category,
  'المركز الوطني للوثائق والمحفوظات — الدليل الموحد لترميز المناطق والمحافظات والمراكز الإدارية',
  'JOUF',true,official_code::integer
FROM official_jouf
ON CONFLICT (official_code) DO NOTHING;
