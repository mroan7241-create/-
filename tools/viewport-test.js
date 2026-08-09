#!/usr/bin/env node
/**
 * اختبار سلوك (لا شكل) صدفة شاشة الدخول الثابتة: يثبت غياب التمرير في
 * 13 مقاسًا مطلوبًا، غياب أي containing block يكسر position:fixed، سلامة
 * السلوك داخل iframe متداخل (محاكاة استضافة Apps Script المعزولة) بما في
 * ذلك تغيّر حجم الإطار ديناميكيًا وDPR مختلفة، وأن القفل يُضاف حصرًا مع
 * شاشة الدخول ويُزال ديناميكيًا بعد دخول حقيقي (لا محاكاة DOM يدوية) مع
 * بقاء تمرير لوحات النظام الداخلية سليمًا.
 *   تشغيل:  node tools/viewport-test.js
 */
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
execSync('node ' + path.join(__dirname, 'preview.js'), { cwd: ROOT, stdio: 'ignore' });
const PREVIEW = 'file://' + path.join(ROOT, 'tools', '.preview', 'preview.html');

const SIZES = [
  [1920,1080],[1600,900],[1536,864],[1440,900],[1366,768],[1280,720],[1024,768],
  [430,932],[414,896],[393,852],[390,844],[375,812],[360,800],[390,664]
];

let failures = 0;
const assert = (name, cond, detail) => {
  if (cond) console.log('  ✓ ' + name);
  else { failures++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};

async function main() {
  const browser = await chromium.launch();

  console.log('\n1) 13 مقاسًا مطلوبًا — بلا تمرير قابل للتحقيق داخل مستند التطبيق مباشرة');
  for (const [w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(PREVIEW + '#login');
    await page.waitForSelector('#loginForm');
    await page.waitForTimeout(120);
    const before = await page.evaluate(() => ({
      scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth
    }));
    await page.mouse.wheel(0, 3000);
    await page.keyboard.press('PageDown'); await page.keyboard.press('End'); await page.keyboard.press('ArrowDown');
    await page.mouse.move(w / 2, h - 50); await page.mouse.down();
    await page.mouse.move(w / 2, 50, { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(120);
    const after = await page.evaluate(() => window.scrollY);
    assert(w + 'x' + h + ': scrollHeight===clientHeight وscrollWidth===clientWidth وscrollY=0 بعد محاولات تمرير حقيقية',
      before.scrollHeight === before.clientHeight && before.scrollWidth === before.clientWidth
      && before.scrollY === 0 && after === 0,
      JSON.stringify({ before, after }));
    await page.close();
  }

  console.log('\n2) تدقيق containing block: لا عنصر بين html وlogin-solo يكسر position:fixed');
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(PREVIEW + '#login');
    await page.waitForSelector('#loginForm');
    const ok = await page.evaluate(() => {
      var chain = [document.documentElement, document.body, document.getElementById('root')];
      return chain.every(function (el) {
        var cs = getComputedStyle(el);
        return cs.transform === 'none' && cs.filter === 'none' && cs.perspective === 'none'
          && (cs.contain === 'none' || cs.contain === '') && cs.willChange !== 'transform';
      });
    });
    assert('html وbody و#root بلا transform/filter/perspective/contain/will-change:transform', ok);
    await page.close();
  }

  console.log('\n3) داخل iframe متداخل (محاكاة استضافة Apps Script المعزولة)');
  {
    const fs = require('fs');
    const hostPath = path.join(ROOT, 'tools', '.preview', 'iframe-host.html');
    fs.writeFileSync(hostPath,
      '<!doctype html><html><head><style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}'
      + 'iframe{position:fixed;inset:0;width:100vw;height:100vh;border:0}</style></head>'
      + '<body><iframe id="app" src="' + PREVIEW + '#login" sandbox="allow-scripts allow-same-origin allow-forms"></iframe></body></html>');
    const hostUrl = 'file://' + hostPath;
    for (const [w, h] of [[1920, 1080], [1366, 768], [390, 844], [390, 664]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.goto(hostUrl);
      const frame = page.frames().find(f => f !== page.mainFrame());
      await frame.waitForSelector('#loginForm');
      await frame.waitForTimeout(120);
      const r = await frame.evaluate(() => ({
        scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight, scrollY: window.scrollY
      }));
      assert('iframe متداخل ' + w + 'x' + h + ': scrollHeight===clientHeight وscrollY=0', r.scrollHeight === r.clientHeight && r.scrollY === 0, JSON.stringify(r));
      await page.close();
    }
    // تغيّر حجم الـiframe ديناميكيًا بعد التحميل (محاكاة إعادة تخطيط المضيف)
    {
      const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
      await page.goto(hostUrl);
      const frame = page.frames().find(f => f !== page.mainFrame());
      await frame.waitForSelector('#loginForm');
      await page.evaluate(() => { document.getElementById('app').style.height = '620px'; });
      await page.waitForTimeout(200);
      const r = await frame.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight, scrollY: window.scrollY }));
      assert('تغيّر ديناميكي في ارتفاع iframe المضيف ينعكس فورًا بلا تمرير زائد', r.scrollHeight === r.clientHeight && r.scrollY === 0, JSON.stringify(r));
      await page.close();
    }
    fs.unlinkSync(hostPath);
  }

  console.log('\n4) DPR مختلفة (1 / 1.25 / 2)');
  for (const dpr of [1, 1.25, 2]) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: dpr });
    await page.goto(PREVIEW + '#login');
    await page.waitForSelector('#loginForm');
    await page.waitForTimeout(120);
    const r = await page.evaluate(() => ({ scrollHeight: document.documentElement.scrollHeight, clientHeight: document.documentElement.clientHeight, scrollY: window.scrollY }));
    assert('DPR=' + dpr + ': scrollHeight===clientHeight وscrollY=0', r.scrollHeight === r.clientHeight && r.scrollY === 0, JSON.stringify(r));
    await page.close();
  }

  console.log('\n5) صنف login-viewport-lock عبر الشاشات الأربع + انتقال حقيقي بعد الدخول');
  {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.goto(PREVIEW + '#login');
    await page.waitForSelector('#loginForm');
    const loginState = await page.evaluate(() => ({ html: document.documentElement.classList.contains('login-viewport-lock'), body: document.body.classList.contains('login-viewport-lock') }));
    assert('شاشة الدخول: القفل مفعَّل على html وbody', loginState.html && loginState.body);
    await page.close();

    for (const [role, label] of [['admin', 'لوحة الإدارة'], ['association', 'لوحة الجمعية'], ['delegate', 'بوابة المندوب']]) {
      const p = await browser.newPage({ viewport: { width: 1366, height: 768 } });
      await p.goto(PREVIEW + '#' + role);
      await p.waitForTimeout(200);
      const st = await p.evaluate(() => ({ html: document.documentElement.classList.contains('login-viewport-lock'), body: document.body.classList.contains('login-viewport-lock') }));
      assert(label + ': القفل غائب تمامًا', !st.html && !st.body);
      await p.close();
    }

    const p2 = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await p2.goto(PREVIEW + '#login');
    await p2.waitForSelector('#loginForm');
    await p2.evaluate(() => { window.__FIXTURE = window.__PREVIEW_DATA.admin; });
    const before = await p2.evaluate(() => document.documentElement.classList.contains('login-viewport-lock'));
    await p2.fill('#loginEmail', 'admin@example.org');
    await p2.fill('#loginPassword', 'whatever12345');
    await p2.click('#loginForm button[type=submit]');
    await p2.waitForFunction(() => window.state && window.state.page === 'dashboard' && !!document.querySelector('.shell'), { timeout: 3000 });
    const after = await p2.evaluate(() => ({
      html: document.documentElement.classList.contains('login-viewport-lock'),
      body: document.body.classList.contains('login-viewport-lock'),
      hasLoginShell: !!document.querySelector('.login-solo'),
      hasDashboard: !!document.querySelector('.shell')
    }));
    assert('دخول حقيقي (تعبئة + submit فعلي): القفل قبل=مفعَّل، بعد=مُزال ديناميكيًا مع ظهور اللوحة',
      before === true && after.html === false && after.body === false && after.hasLoginShell === false && after.hasDashboard === true,
      JSON.stringify({ before, after }));

    // التمرير الداخلي في لوحة الإدارة يبقى سليمًا (لم يتأثر بقفل الدخول)
    const contentOverflow = await p2.evaluate(() => getComputedStyle(document.querySelector('.content')).overflowY);
    assert('تمرير المحتوى الداخلي بعد الدخول لم يتأثر (overflow-y ليس hidden قسرًا)', contentOverflow !== 'hidden', contentOverflow);
    await p2.close();
  }

  console.log('\n6) وضع لوحة المفاتيح (login-keyboard-compact) على شاشة قصيرة جدًا');
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(PREVIEW + '#login');
    await page.waitForSelector('#loginForm');
    await page.waitForTimeout(150);
    // محاكاة انخفاض واضح في الارتفاع المرئي (لوحة مفاتيح افتراضية تفتح)
    await page.evaluate(() => { window.dispatchEvent(new Event('resize')); });
    await page.setViewportSize({ width: 390, height: 400 });
    await page.waitForTimeout(200);
    const r = await page.evaluate(() => ({
      compact: document.documentElement.classList.contains('login-keyboard-compact'),
      loginSoloOverflowY: getComputedStyle(document.querySelector('.login-solo')).overflowY,
      bodyScrollY: window.scrollY
    }));
    assert('انخفاض الارتفاع >120px يُفعِّل login-keyboard-compact ويفتح تمريرًا داخل .login-solo فقط', r.compact && r.loginSoloOverflowY === 'auto', JSON.stringify(r));
    assert('body/html نفسهما ما زالا بلا تمرير (window.scrollY=0) حتى في وضع لوحة المفاتيح', r.bodyScrollY === 0);
    await page.close();
  }

  console.log(failures === 0 ? '\n=== ALL PASS ===' : '\n=== ' + failures + ' FAILURE(S) ===');
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
