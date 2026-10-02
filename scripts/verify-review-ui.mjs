import { chromium } from 'playwright';
import assert from 'node:assert/strict';

import { existsSync } from 'node:fs';
const chrome = process.env.JOY_BROWSER_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({executablePath: chrome && existsSync(chrome) ? chrome : undefined, headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 850}});
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack));
  await page.goto(`http://127.0.0.1:${process.argv[2]}`);
  const forms = page.locator('[data-testid="stForm"]');
  await forms.nth(7).waitFor({timeout: 20000});
  if (process.env.JOY_TEST_ZOOM && process.env.JOY_TEST_ZOOM !== '100') {
    await page.getByRole('button', {name: '🔍 界面缩放'}).click();
    await page.getByText(`${process.env.JOY_TEST_ZOOM}%`, {exact: true}).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  const fullRunBefore = await page.getByText(/^Full app runs: /).innerText();
  const form = forms.nth(4);
  const next = forms.nth(5);
  await next.getByText('C', {exact: true}).click();
  await form.getByText('A', {exact: true}).click();
  await form.evaluate(element => {
    const main = document.querySelector('[data-testid="stMain"]');
    main.scrollTop += element.getBoundingClientRect().top - 300;
  });
  await page.waitForTimeout(300);
  const before = await form.evaluate(element => ({top: element.getBoundingClientRect().top, mainY: document.querySelector('[data-testid="stMain"]').scrollTop, windowY: window.scrollY, formClass: [...element.classList]}));
  await page.evaluate(() => {
    window.__reviewMeasurements = [];
    const start = performance.now();
    const tick = () => {
      const form = document.querySelectorAll('[data-testid="stForm"]')[4];
      window.__reviewMeasurements.push({time: performance.now() - start, top: form?.getBoundingClientRect().top, y: document.querySelector('[data-testid="stMain"]').scrollTop});
      if (performance.now() - start < 2200) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await form.getByRole('button', {name: '保存该项修正', exact: true}).click();
  await form.getByRole('button', {name: '修改并重新保存', exact: true}).waitFor({timeout: 10000});
  await page.waitForTimeout(2300);
  const after = await form.evaluate(element => ({top: element.getBoundingClientRect().top, mainY: document.querySelector('[data-testid="stMain"]').scrollTop, windowY: window.scrollY}));
  const samples = await page.evaluate(() => window.__reviewMeasurements);
  const maxDeviation = Math.max(...samples.map(sample => Math.abs((sample.top ?? before.top) - before.top)));
  const nextChoice = await next.getByRole('radio', {name: 'C', exact: true}).isChecked();
  console.log(JSON.stringify({before, after, maxDeviation, nextUnsavedChoicePreserved: nextChoice, ...(process.env.JOY_REVIEW_TRACE ? {...(process.env.JOY_REVIEW_TRACE ? {samples: samples.filter((_, i) => i % 15 === 0)} : {})} : {})}, null, 2));
  assert.ok(maxDeviation <= 1, 'Saved form moved vertically.');
  assert.ok(nextChoice, 'An unsaved choice in another form was lost.');
  assert.equal(await page.getByText(/^Full app runs: /).innerText(), fullRunBefore, 'Single-question save reran the whole app.');
  const anchor = await page.evaluate(() => window.__joyReviewScroll?.pending);
  assert.ok(anchor?.formClass, 'The active review form was not captured.');
  await page.evaluate(formClass => {
    const main = document.querySelector('[data-testid="stMain"]');
    main.style.overflowAnchor = 'none';
    const spacer = document.createElement('div');
    spacer.id = 'synthetic-layout-change';
    spacer.style.height = '120px';
    const anchor = document.getElementsByClassName(formClass)[0];
    anchor.parentElement.insertBefore(spacer, anchor);
  }, anchor.formClass);
  await page.waitForTimeout(250);
  assert.ok(Math.abs(await form.evaluate(element => element.getBoundingClientRect().top) - before.top) <= 1, 'Scroll anchor did not compensate for a layout change.');
  await page.evaluate(() => document.getElementById('synthetic-layout-change').remove());
  await page.waitForTimeout(250);
  assert.ok(Math.abs(await form.evaluate(element => element.getBoundingClientRect().top) - before.top) <= 1, 'Repeated scroll correction was not stable.');
  if (process.env.JOY_REVIEW_SCREENSHOT) await page.screenshot({path: process.env.JOY_REVIEW_SCREENSHOT});
  await form.getByText('B', {exact: true}).click();
  await form.getByRole('button', {name: '修改并重新保存', exact: true}).click();
  await page.waitForTimeout(1800);
  console.log('Repeated-save selected value preserved:', await form.getByRole('radio', {name: 'B', exact: true}).isChecked());
  assert.ok(await form.getByRole('radio', {name: 'B', exact: true}).isChecked());
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(300);
  const scrolled = await page.evaluate(() => document.querySelector('[data-testid="stMain"]').scrollTop);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid="stMain"]').scrollTop), scrolled, 'Scroll lock overrode intentional user scrolling.');
  assert.equal(await page.evaluate(() => window.__joyReviewScroll?.pending), null, 'Intentional scrolling did not release the lock.');
  for (let index = 0; index < 8; index++) {
    const target = forms.nth(index);
    await target.getByText('A', {exact: true}).click();
    const button = target.getByRole('button', {name: /^(保存该项修正|修改并重新保存)$/});
    if (index === 7) {
      await button.focus();
      await button.press('Enter');
    } else {
      await button.click();
    }
    await target.getByRole('button', {name: '修改并重新保存', exact: true}).waitFor();
    await page.waitForTimeout(150);
  }
  assert.ok(await page.getByRole('button', {name: /^(导出并另存最终成绩|另存 Excel 备份)/}).isEnabled(), 'Export stayed disabled after all questions were saved.');
  assert.equal(await page.getByText(/^Full app runs: /).innerText(), fullRunBefore, 'Review save reran the whole app.');
  assert.deepEqual(pageErrors, [], 'Browser errors occurred.');
  console.log('All eight questions saved; keyboard submit, user scrolling, export state and fragment-only updates verified without browser errors.');
} finally {
  await browser.close();
}
