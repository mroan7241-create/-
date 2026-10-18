const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
for (const extension of ['.ts','.tsx']) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const {SavedReviewDialog} = require('./saved-review.tsx');
const app={name:'ثمرات',publicCode:'APP-000163',eligibilityStatus:'PASSED',eligibilityNotes:'قرار خاص محفوظ',eligibilityEvidence:{checks:[{label:'النظام',result:'PASS',reason:'نظام موثق'}]},evaluationScore:77,evaluationBreakdown:{raw:{operationalReadiness:3},weighted:{operationalReadiness:18}}};
const render=kind=>renderToStaticMarkup(React.createElement(SavedReviewDialog,{application:app,kind,evidence:{checks:[{label:'مؤشر حالي',result:'FAIL'}]},criteria:[{key:'operationalReadiness',label:'الجاهزية التشغيلية',weight:30}],onClose:()=>{}}));
test('saved review has no form controls or save/send action; stored and current eligibility are separate',()=>{
 for(const kind of ['eligibility','evaluation']){
  const html=render(kind); assert.doesNotMatch(html,/<(?:input|select|textarea|form)\b/);assert.equal((html.match(/<button\b/g)||[]).length,1);assert.match(html,/إغلاق/);
 }
 const html=render('eligibility');assert.match(html,/قرار خاص محفوظ/);assert.match(html,/الأدلة المسجلة وقت القرار/);assert.match(html,/المؤشرات الآلية الحالية/);assert.match(html,/نظام موثق/);
});
test('evaluation shows saved scores and total, without reconstructing missing evidence',()=>{
 const html=render('evaluation');assert.match(html,/3 من 5/);assert.match(html,/18\.00/);assert.match(html,/77\/100/);assert.match(html,/غير مسجل/);
});
