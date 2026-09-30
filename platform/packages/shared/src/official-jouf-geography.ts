/**
 * Official Al Jouf geography from NCAR's unified coding guide.
 * Source: https://ncar.gov.sa/regions-coding
 * Source endpoint: https://ncar.gov.sa/api/index.php/api/classification/searchArea
 * Retrieval: POST JSON { "name": "الجوف" }, 2026-09-30.
 * Source response SHA-256 (UTF-8): a7c393298fda52279b47c5dd2dd40545b5b04bfb0132e970795077fc30fa1a0b
 * Names preserve official spelling; repeated whitespace is normalized.
 */
import type { OfficialGeographicUnit } from './official-geography-base';

export const JOUF_GEOGRAPHIC_UNITS: readonly OfficialGeographicUnit[] = [
  {"officialCode":"0013","nameAr":"منطقة الجوف","unitType":"REGION","parentOfficialCode":null,"category":null,"projectScopeGroup":"JOUF"},
  {"officialCode":"0247","nameAr":"مدينة سكاكا","unitType":"EMIRATE_SEAT","parentOfficialCode":"0013","category":"مقر الإمارة","projectScopeGroup":"JOUF"},
  {"officialCode":"2510","nameAr":"مركز خوعاء","unitType":"ADMIN_CENTER","parentOfficialCode":"0247","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2511","nameAr":"مركز الفياض","unitType":"ADMIN_CENTER","parentOfficialCode":"0247","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2512","nameAr":"مركز عذفاء","unitType":"ADMIN_CENTER","parentOfficialCode":"0247","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2513","nameAr":"مركز المرير (الارتباط بمركز الفياض)","unitType":"ADMIN_CENTER","parentOfficialCode":"0247","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"2516","nameAr":"مركز أم إذن (الارتباط بمركز خوعاء)","unitType":"ADMIN_CENTER","parentOfficialCode":"0247","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"2521","nameAr":"مركز مغيراء (الارتباط بمركز خوعاء)","unitType":"ADMIN_CENTER","parentOfficialCode":"0247","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"0248","nameAr":"محافظة القريات","unitType":"GOVERNORATE","parentOfficialCode":"0013","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2523","nameAr":"مركز الحديثة","unitType":"ADMIN_CENTER","parentOfficialCode":"0248","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2524","nameAr":"مركز العيساوية","unitType":"ADMIN_CENTER","parentOfficialCode":"0248","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2525","nameAr":"مركز عين الحواس","unitType":"ADMIN_CENTER","parentOfficialCode":"0248","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2526","nameAr":"مركز الناصفة","unitType":"ADMIN_CENTER","parentOfficialCode":"0248","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2527","nameAr":"مركز الحماد","unitType":"ADMIN_CENTER","parentOfficialCode":"0248","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"2528","nameAr":"مركز الوادي","unitType":"ADMIN_CENTER","parentOfficialCode":"0248","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2529","nameAr":"مركز قليب خضر","unitType":"ADMIN_CENTER","parentOfficialCode":"0248","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"2530","nameAr":"مركز رديفة الجماجم","unitType":"ADMIN_CENTER","parentOfficialCode":"0248","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"0249","nameAr":"محافظة دومة الجندل","unitType":"GOVERNORATE","parentOfficialCode":"0013","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2531","nameAr":"مركز أبو عجرم","unitType":"ADMIN_CENTER","parentOfficialCode":"0249","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2532","nameAr":"مركز الأضارع","unitType":"ADMIN_CENTER","parentOfficialCode":"0249","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2533","nameAr":"مركز أصفان","unitType":"ADMIN_CENTER","parentOfficialCode":"0249","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"2534","nameAr":"مركز الشقيق","unitType":"ADMIN_CENTER","parentOfficialCode":"0249","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2535","nameAr":"مركز الرديفة والرافعية","unitType":"ADMIN_CENTER","parentOfficialCode":"0249","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"0250","nameAr":"محافظة طبرجل","unitType":"GOVERNORATE","parentOfficialCode":"0013","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2536","nameAr":"مركز ميقوع","unitType":"ADMIN_CENTER","parentOfficialCode":"0250","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2537","nameAr":"مركز النبك أبو قصر","unitType":"ADMIN_CENTER","parentOfficialCode":"0250","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2538","nameAr":"مركز ثنيه أم نخيله","unitType":"ADMIN_CENTER","parentOfficialCode":"0250","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"2539","nameAr":"مركز بسيطا","unitType":"ADMIN_CENTER","parentOfficialCode":"0250","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2540","nameAr":"مركز الثنيه","unitType":"ADMIN_CENTER","parentOfficialCode":"0250","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"2541","nameAr":"مركز صبيحا","unitType":"ADMIN_CENTER","parentOfficialCode":"0250","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"0252","nameAr":"محافظة صوير","unitType":"GOVERNORATE","parentOfficialCode":"0013","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"2514","nameAr":"مركز طلعة عمار","unitType":"ADMIN_CENTER","parentOfficialCode":"0252","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"2515","nameAr":"مركز زلوم","unitType":"ADMIN_CENTER","parentOfficialCode":"0252","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2517","nameAr":"مركز الشويحيطية","unitType":"ADMIN_CENTER","parentOfficialCode":"0252","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"2518","nameAr":"مركز الرفيعة","unitType":"ADMIN_CENTER","parentOfficialCode":"0252","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2519","nameAr":"مركز هديب","unitType":"ADMIN_CENTER","parentOfficialCode":"0252","category":"أ","projectScopeGroup":"JOUF"},
  {"officialCode":"2520","nameAr":"مركز الحرة","unitType":"ADMIN_CENTER","parentOfficialCode":"0252","category":"ب","projectScopeGroup":"JOUF"},
  {"officialCode":"2522","nameAr":"مركز غدير الخيل","unitType":"ADMIN_CENTER","parentOfficialCode":"0252","category":"ب","projectScopeGroup":"JOUF"},
];

