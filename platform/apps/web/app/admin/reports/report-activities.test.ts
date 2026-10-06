import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute the real JSX rows expression: no second implementation of the mapper.
const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions: ts.Expression[] = [];
function visit(node: ts.Node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'ReportTable') {
    const attributes = node.attributes.properties;
    const title = attributes.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'title');
    if (title && ts.isJsxAttribute(title) && title.initializer && ts.isStringLiteral(title.initializer) && title.initializer.text === 'تقدم أنشطة المشروع') {
      const rows = attributes.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'rows');
      if (rows && ts.isJsxAttribute(rows) && rows.initializer && ts.isJsxExpression(rows.initializer) && rows.initializer.expression) expressions.push(rows.initializer.expression);
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.equal(expressions.length, 1, 'the print and screen activity table have one source of truth');
const mapper = ts.transpileModule(`JSON.stringify(${expressions[0].getText(ast)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
type Row = { phaseName: string; mainActivityName: string; subActivityName: string | null; status: string; completionPercent: number };
const main: Row = Object.freeze({ phaseName: 'المشروع', mainActivityName: 'التقديم', subActivityName: null, status: 'IN_PROGRESS', completionPercent: 50 });
function rows(activities: readonly Row[]): Array<Array<string | number>> {
  return JSON.parse(runInNewContext(mapper, { report: { activities }, reportValueLabel: (value: string) => value }));
}

test('main activity name, status and percentage stay unchanged', () => {
  assert.deepEqual(rows([main]), [['المشروع', 'التقديم', 'IN_PROGRESS', '50%']]);
});

test('every child retains its main context and its own name in the real report mapper', () => {
  const activities = Object.freeze([main,
    Object.freeze({ ...main, subActivityName: 'نشر الإعلان' }),
    Object.freeze({ ...main, subActivityName: 'إغلاق التقديم' }),
  ]);
  const result = rows(activities);
  assert.deepEqual(result.map(row => row[1]), ['التقديم', 'التقديم — نشر الإعلان', 'التقديم — إغلاق التقديم']);
  assert.equal(result.length, activities.length);
  assert.equal(activities[1].subActivityName, 'نشر الإعلان');
});

test('empty activities remain empty and browser printing uses this same rendered table', () => {
  assert.deepEqual(rows([]), []);
  assert.match(source, /window\.print\(\)/);
  assert.match(source, /className="abanmi-report-print"/);
});
