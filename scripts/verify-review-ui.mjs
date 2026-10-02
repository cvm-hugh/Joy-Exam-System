import { chromium } from 'playwright';
import assert from 'node:assert/strict';

import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

async function verifyReviewNavigation(page, fullRunBefore) {
  const cardSelector = source => '.st-key-review_card_' + createHash('sha256').update(source).digest('hex');
  const card = source => page.locator(cardSelector(source));
  const earlier = card('未复核 01（考号待确认）.png');
  const completed = card('已完成 02.png');
  const later = card('未复核 03（答题待确认）.png');
  const cardForms = target => target.locator('[class*="st-key-review_anchor_"] [data-testid="stForm"]');
  const expectAtTop = async (target, source) => {
    const selector = cardSelector(source);
    await page.waitForFunction(selector => document.querySelectorAll(selector).length === 1, selector);
    await page.waitForFunction(selector => {
      const element = document.querySelector(selector);
      return element && Math.abs(element.getBoundingClientRect().top - 84) <= 1;
    }, selector, {timeout: 10000});
    await page.waitForTimeout(600);
    assert.ok(Math.abs((await target.boundingBox()).y - 84) <= 1, 'The first unfinished card did not remain at the top of the viewport.');
    assert.ok(await target.evaluate(node => node.contains(document.activeElement)), 'Keyboard focus did not follow the unfinished card.');
    assert.ok(await target.locator('details').first().evaluate(node => node.open), 'The unfinished card remained collapsed.');
    assert.equal(await page.getByText(/^Full app runs: /).innerText(), fullRunBefore, 'Closing a card reran the whole app.');
  };
  await cardForms(earlier).nth(0).getByText('C', {exact: true}).click();
  await cardForms(later).nth(0).getByText('C', {exact: true}).click();
  await completed.getByRole('button', {name: '完成并收起本张', exact: true}).click();
  await completed.waitFor({state: 'detached'});
  await expectAtTop(earlier, '未复核 01（考号待确认）.png');
  assert.ok(await cardForms(earlier).nth(0).getByRole('radio', {name: 'C', exact: true}).isChecked());
  assert.ok(await cardForms(later).nth(0).getByRole('radio', {name: 'C', exact: true}).isChecked());
  assert.ok(await page.getByRole('button', {name: /^(导出并另存最终成绩|另存 Excel 备份)/}).isDisabled());

  await earlier.getByRole('textbox', {name: '正确考号或原始学号', exact: true}).fill('S10086');
  await earlier.getByRole('button', {name: '确认考号', exact: true}).click();
  await earlier.getByText('考号 010086 已匹配 测试S学生，并确认保存。', {exact: true}).waitFor();
  // A navigation request must be consumed once. Later single-question saves
  // still keep the active form in place instead of returning to the card header.
  const form = cardForms(earlier).nth(4);
  await form.getByText('A', {exact: true}).click();
  await form.evaluate(node => {
    const main = document.querySelector('[data-testid="stMain"]');
    main.scrollTop += node.getBoundingClientRect().top - 300;
  });
  await page.waitForTimeout(300);
  const before = await form.evaluate(node => node.getBoundingClientRect().top);
  await form.getByRole('button', {name: '保存该项修正', exact: true}).click();
  await form.getByRole('button', {name: '修改并重新保存', exact: true}).waitFor();
  await page.waitForTimeout(700);
  assert.ok(Math.abs(await form.evaluate(node => node.getBoundingClientRect().top) - before) <= 1,
            'A consumed navigation request repeated on a later question save.');
  for (let index = 0; index < 8; index++) {
    if (index === 4) continue;
    const target = cardForms(earlier).nth(index);
    await target.getByText('A', {exact: true}).click();
    await target.getByRole('button', {name: '保存该项修正', exact: true}).click();
    await target.getByRole('button', {name: '修改并重新保存', exact: true}).waitFor();
  }
  const finish = earlier.getByRole('button', {name: '完成并收起本张', exact: true});
  await finish.focus();
  await finish.press('Enter');
  await earlier.waitFor({state: 'detached'});
  await expectAtTop(later, '未复核 03（答题待确认）.png');
  assert.ok(await cardForms(later).nth(0).getByRole('radio', {name: 'C', exact: true}).isChecked());
  for (let index = 0; index < 8; index++) {
    const target = cardForms(later).nth(index);
    await target.getByText('A', {exact: true}).click();
    await target.getByRole('button', {name: '保存该项修正', exact: true}).click();
    await target.getByRole('button', {name: '修改并重新保存', exact: true}).waitFor();
  }
  await later.getByRole('button', {name: '完成并收起本张', exact: true}).click();
  await later.waitFor({state: 'detached'});
  const exportTarget = page.locator('.st-key-review_export');
  await page.waitForFunction(() => {
    const bounds = document.querySelector('.st-key-review_export')?.getBoundingClientRect();
    return bounds && bounds.top >= 40 && bounds.bottom < window.innerHeight;
  });
  assert.ok(await page.getByRole('button', {name: /^(导出并另存最终成绩|另存 Excel 备份)/}).isEnabled());
  assert.ok(await exportTarget.evaluate(node => node.contains(document.activeElement)));
  await page.mouse.wheel(0, -180);
  await page.waitForTimeout(300);
  const mainY = await page.evaluate(() => document.querySelector('[data-testid="stMain"]').scrollTop);
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => document.querySelector('[data-testid="stMain"]').scrollTop), mainY, 'Navigation overrode intentional scrolling.');
  assert.equal(await page.evaluate(() => window.__joyReviewScroll.navigation), null);
  assert.equal(await page.getByText(/^Full app runs: /).innerText(), fullRunBefore);
  console.log('Closing cards returns to the first unfinished card, skips completed cards, preserves input, supports keyboard completion and reaches export when finished.');
}
async function verifyFoldedNavigation(page, fullRunBefore) {
  const selector = number => '.st-key-review_card_' + createHash('sha256').update(`待复核 ${String(number).padStart(2, '0')}.png`).digest('hex');
  const card = number => page.locator(selector(number));
  const forms = number => card(number).locator('[class*="st-key-review_anchor_"] [data-testid="stForm"]');
  const ensureClosed = async () => {
    for (let number = 1; number <= 3; number++) {
      assert.equal(await card(number).locator('details').first().evaluate(node => node.open), false,
                   `Manually collapsed card ${number} was reopened.`);
    }
  };
  await forms(1).nth(0).getByText('C', {exact: true}).click();
  await forms(5).nth(0).getByText('C', {exact: true}).click();
  for (let number = 1; number <= 3; number++) {
    await card(number).locator('summary').first().click();
    await page.waitForFunction(selector => document.querySelector(selector)?.querySelector('details')?.open === false, selector(number));
    await page.waitForTimeout(200);
  }
  await ensureClosed();
  assert.ok(await forms(1).nth(0).getByRole('radio', {name: 'C', exact: true, includeHidden: true}).isChecked());
  assert.ok(await forms(5).nth(0).getByRole('radio', {name: 'C', exact: true}).isChecked());
  for (let index = 0; index < 8; index++) {
    const target = forms(4).nth(index);
    await target.getByText('A', {exact: true}).click();
    await target.getByRole('button', {name: '保存该项修正', exact: true}).click();
    await target.getByRole('button', {name: '修改并重新保存', exact: true}).waitFor();
    await ensureClosed();
  }
  await card(4).getByRole('button', {name: '完成并收起本张', exact: true}).click();
  await card(4).waitFor({state: 'detached'});
  await page.waitForFunction(selector => Math.abs(document.querySelector(selector)?.getBoundingClientRect().top - 84) <= 1, selector(5));
  await page.waitForTimeout(600);
  await ensureClosed();
  assert.ok(await card(5).locator('details').first().evaluate(node => node.open));
  assert.ok(await card(5).evaluate(node => node.contains(document.activeElement)));
  assert.ok(await forms(5).nth(0).getByRole('radio', {name: 'C', exact: true}).isChecked());
  assert.equal(await page.getByText(/^Full app runs: /).innerText(), fullRunBefore);
  for (let index = 0; index < 8; index++) {
    const target = forms(5).nth(index);
    await target.getByText('A', {exact: true}).click();
    await target.getByRole('button', {name: '保存该项修正', exact: true}).click();
    await target.getByRole('button', {name: '修改并重新保存', exact: true}).waitFor();
  }
  const finish = card(5).getByRole('button', {name: '完成并收起本张', exact: true});
  await finish.focus();
  await finish.press('Enter');
  await card(5).waitFor({state: 'detached'});
  const remainingNotice = page.getByText('还有 3 张待复核考卷已折叠，请手动展开后继续审核。', {exact: true});
  await remainingNotice.waitFor();
  await page.waitForTimeout(600);
  await ensureClosed();
  assert.ok(await page.getByRole('button', {name: /^(导出并另存最终成绩|另存 Excel 备份)/}).isDisabled(), 'Collapsed pending cards were treated as finished.');
  await card(1).locator('summary').first().click();
  await page.waitForFunction(selector => document.querySelector(selector)?.querySelector('details')?.open === true, selector(1));
  await remainingNotice.waitFor({state: 'detached'});
  assert.ok(await forms(1).nth(0).getByRole('radio', {name: 'C', exact: true}).isChecked());
  for (const number of [2, 3]) {
    assert.equal(await card(number).locator('details').first().evaluate(node => node.open), false);
  }
  await card(1).locator('summary').first().click();
  await page.waitForFunction(selector => document.querySelector(selector)?.querySelector('details')?.open === false, selector(1));
  await remainingNotice.waitFor();
  await ensureClosed();
  assert.equal(await page.getByText(/^Full app runs: /).innerText(), fullRunBefore, 'Expander changes reran the whole app.');
  console.log('Three manually collapsed cards stay closed while completing card four; navigation reaches open card five, and collapsed pending cards still block export.');
}

const chrome = process.env.JOY_BROWSER_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);
const browser = await chromium.launch({executablePath: chrome && existsSync(chrome) ? chrome : undefined, headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1280, height: 850}});
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.stack));
  const scenario = process.env.JOY_IDENTITY_SCENARIO || 'marks';
  await page.goto(`http://127.0.0.1:${process.argv[2]}?scenario=${scenario}`);
  const forms = page.locator('[class*="st-key-review_anchor_"] [data-testid="stForm"]');
  await page.getByRole('heading', {name: '基础信息', exact: true}).first().waitFor({timeout: 20000});
  if (scenario !== 'id-only') await forms.nth(scenario === 'folded-navigation' ? 39 : scenario === 'navigation' ? 15 : 7).waitFor({timeout: 20000});
  if (process.env.JOY_TEST_ZOOM && process.env.JOY_TEST_ZOOM !== '100') {
    await page.getByRole('button', {name: '🔍 界面缩放'}).click();
    await page.getByText(`${process.env.JOY_TEST_ZOOM}%`, {exact: true}).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  const fullRunBefore = await page.getByText(/^Full app runs: /).innerText();
  if (scenario === 'folded-navigation') {
    await verifyFoldedNavigation(page, fullRunBefore);
    assert.deepEqual(pageErrors, [], 'Browser errors occurred.');
  } else if (scenario === 'navigation') {
    await verifyReviewNavigation(page, fullRunBefore);
    assert.deepEqual(pageErrors, [], 'Browser errors occurred.');
  } else {
  const checkOverview = async () => {
    assert.equal(await page.getByRole('heading', {name: '基础信息', exact: true}).count(), 1, 'Base information was duplicated.');
    assert.equal(await page.getByRole('button', {name: /修改图片并重新识别/}).count(), 1, 'Image editing entry was duplicated.');
    assert.equal(await page.getByText('修改已完成记录', {exact: true}).count(), 0, 'Unsupported completed-record editor remains.');
    const identityHeading = page.getByRole('heading', {name: '考号核对', exact: true});
    const answerHeading = page.getByRole('heading', {name: '答题内容核对', exact: true});
    assert.equal(await identityHeading.evaluate(node => node.tagName), await answerHeading.evaluate(node => node.tagName), 'Identity and content review have different heading levels.');
    const images = page.locator('[class*="st-key-review_images_"] [data-testid="stImage"]');
    await images.nth(1).waitFor();
    assert.equal(await images.count(), 2, 'The shared image group must have exactly two images.');
    const left = await images.nth(0).boundingBox();
    const right = await images.nth(1).boundingBox();
    assert.ok(Math.abs(left.y - right.y) < 2 && left.x + left.width <= right.x, 'Exam ID crop and full card were not placed side by side.');
  };
  await checkOverview();
  if (scenario !== 'marks') {
    const identityInput = page.getByRole('textbox', {name: '正确考号或原始学号', exact: true});
    const expectedId = scenario === 'missing' ? '019999' : '010086';
    await identityInput.fill(scenario === 'known-numeric' ? '010086' : scenario === 'missing' ? 'S19999' : 'S10086');
    await page.getByRole('button', {name: '确认考号', exact: true}).click();
    if (scenario === 'missing') {
      await page.getByText(/019999.*不在当前学生名单/).waitFor();
      const supplement = page.locator('[data-testid="stForm"]').filter({has: page.getByRole('button', {name: '确认为后补学生', exact: true})});
      await supplement.getByRole('button', {name: '确认为后补学生', exact: true}).click();
      await page.getByText('请补齐姓名、分校、班级和笔试时间；年级未知可留空。', {exact: true}).waitFor();
      assert.equal(await identityInput.count(), 1, 'Incomplete supplement incorrectly confirmed identity.');
      for (const [label, value] of [['中文名', '测试后补学生'], ['年级', '六年级'], ['分校', '测试分校'], ['班级', '测试班级'], ['笔试时间', '测试场次']]) {
        await supplement.getByRole('textbox', {name: label, exact: true}).fill(value);
      }
      await supplement.getByRole('button', {name: '确认为后补学生', exact: true}).click();
      await page.getByText(`考号 ${expectedId} 的后补学生信息已确认并保存。`, {exact: true}).waitFor();
    } else {
      await page.getByText(`考号 ${expectedId} 已匹配 测试S学生，并确认保存。`, {exact: true}).waitFor();
    }
    assert.equal(await identityInput.count(), 0, 'Identity confirmation left the pending form visible.');
    await checkOverview();
    assert.equal(await page.getByText(/^Full app runs: /).innerText(), fullRunBefore, 'Identity confirmation reran the whole app.');
    if (process.env.JOY_IDENTITY_SCREENSHOT) {
      await page.getByRole('heading', {name: '基础信息', exact: true}).scrollIntoViewIfNeeded();
      await page.screenshot({path: process.env.JOY_IDENTITY_SCREENSHOT});
    }
    console.log(`Identity ${scenario}: confirmation, one shared overview, image columns and peer review headings verified.`);
  }
  if (scenario === 'id-only') {
    assert.ok(await page.getByRole('button', {name: /^(导出并另存最终成绩|另存 Excel 备份)/}).isEnabled(), 'Identity-only review kept export disabled.');
    await page.getByRole('button', {name: '完成并收起本张', exact: true}).click();
    await page.getByText('本批次没有需要人工检查的项目。', {exact: true}).waitFor();
    assert.deepEqual(pageErrors, [], 'Browser errors occurred.');
    console.log('Identity-only card remained visible after confirmation and closed explicitly.');
  } else {
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
      const form = document.querySelectorAll('[class*="st-key-review_anchor_"] [data-testid="stForm"]')[4];
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
  console.log(JSON.stringify({before, after, maxDeviation, nextUnsavedChoicePreserved: nextChoice, ...(process.env.JOY_REVIEW_TRACE ? {samples: samples.filter((_, i) => i % 15 === 0)} : {})}, null, 2));
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
  await checkOverview();
  }
  }
} finally {
  await browser.close();
}
