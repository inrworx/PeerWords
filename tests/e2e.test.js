const { chromium } = require('playwright');
const path = require('path');
const FILE = require('url').pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const OUT = require('fs').mkdtempSync(require('os').tmpdir() + '/peerwords-shots-');
const results = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] });
  console.log('screenshots in', OUT);

  // ---- run 1: normal motion, light theme, desktop
  let ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, colorScheme: 'light' });
  let page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(FILE);
  await page.waitForSelector('.tile');

  const info = await page.evaluate(() => ({ answer: DAILY_ANSWER, day: DAY_NUM, tiles: document.querySelectorAll('.tile').length, keys: document.querySelectorAll('.key').length, nodes: document.querySelectorAll('.node').length, logo: !!document.querySelector('.logo img') && document.querySelector('.logo img').naturalWidth }));
  console.log('page info', JSON.stringify(info));
  ok('board has 30 tiles', info.tiles === 30);
  ok('keyboard has 28 keys', info.keys === 28, String(info.keys));
  ok('6 nodes rendered', info.nodes === 6);
  ok('logo image decodes', info.logo > 0, String(info.logo));

  // too short
  await page.keyboard.type('ab'); await page.keyboard.press('Enter');
  ok('short word rejected', (await page.textContent('#toast')) === 'Not enough letters');
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  ok('backspace clears row', (await page.evaluate(() => S.cur)) === '');

  // invalid
  await page.keyboard.type('zzzzz'); await page.keyboard.press('Enter');
  ok('non-word rejected', /word list/.test(await page.textContent('#toast')));
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');

  // a real guess with the animated path
  const guess = info.answer === 'crane' ? 'about' : 'crane';
  await page.keyboard.type(guess); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.row')[0].querySelectorAll('.tile[data-state]').length === 5, null, { timeout: 8000 });
  const row0 = await page.evaluate(() => [...document.querySelectorAll('.row')[0].querySelectorAll('.tile')].map(t => t.dataset.state).join(''));
  const expected = await page.evaluate(g => scoreGuess(g, DAILY_ANSWER).join(''), guess);
  ok('row 1 tiles match scoring', row0 === expected, `${guess} -> ${row0} (expected ${expected})`);
  const ledger1 = await page.$$eval('#ledger .entry', es => es.map(e => e.innerText.replace(/\n/g, ' | ')));
  console.log('ledger after 1 guess:', ledger1.slice(0, 2));
  ok('ledger logged a signed score job', ledger1.some(t => /score/.test(t) && /sig [0-9a-f]{8}/.test(t) && /3\/3 agree/.test(t)));
  const jobs = await page.$$eval('.node .nmeta span:not(.badge)', es => es.map(e => e.textContent).filter(t => /jobs/.test(t)).map(t => parseInt(t)));
  ok('exactly 3 nodes did a job', jobs.filter(n => n === 1).length === 3 && jobs.reduce((a, b) => a + b, 0) === 3, JSON.stringify(jobs));
  await page.waitForFunction(() => !S.busy, null, { timeout: 8000 });
  const keyStates = await page.$$eval('.key[data-state]', ks => ks.length);
  ok('keyboard colored after guess', keyStates > 0, String(keyStates));
  await page.screenshot({ path: path.join(OUT, 'shot-light-desktop.png'), fullPage: true });

  // hint
  await page.click('#hintBtn');
  await page.waitForSelector('#belly:not([hidden])', { timeout: 8000 });
  const hintTxt = await page.textContent('#belly');
  const hm = hintTxt.match(/slot (\d) is the letter ([A-Z])/);
  const hintOk = hm && (await page.evaluate(([p, l]) => DAILY_ANSWER[p - 1].toUpperCase() === l, [Number(hm[1]), hm[2]]));
  ok('hint is correct for the answer', !!hintOk, hintTxt.replace(/\s+/g, ' ').trim());
  ok('hint button locks after use', await page.isDisabled('#hintBtn'));

  // win
  await page.keyboard.type(info.answer); await page.keyboard.press('Enter');
  await page.waitForSelector('#result:not([hidden])', { timeout: 10000 });
  ok('win shows result card', /Solved in 2 of 6 with a hint/.test(await page.textContent('#resultSub')), await page.textContent('#resultSub'));
  ok('stats updated', (await page.textContent('#stPlayed')) === '1' && (await page.textContent('#stStreak')) === '1');
  ok('countdown shown', /Next puzzle in \d\d:\d\d:\d\d/.test(await page.textContent('#nextIn')));
  const share = await page.evaluate(() => shareText());
  console.log('share text:\n' + share);
  ok('share text has grid + hint flag', /PeerWords #\d+ 2\/6 \(hint\)/.test(share) && share.includes('🟩🟩🟩🟩🟩'));
  await page.keyboard.type('abc'); // input must be ignored after finishing
  ok('typing ignored after win', (await page.evaluate(() => S.cur)) === '');
  await page.screenshot({ path: path.join(OUT, 'shot-light-win.png'), fullPage: true });

  // reload restores the finished daily game
  await page.reload(); await page.waitForSelector('.tile');
  const restored = await page.evaluate(() => ({ g: S.guesses.length, status: S.status, resultShown: !document.getElementById('result').hidden, hint: !!S.hint }));
  ok('reload restores finished game', restored.g === 2 && restored.status === 'won' && restored.resultShown && restored.hint, JSON.stringify(restored));
  const played = await page.textContent('#stPlayed');
  ok('reload does not double count stats', played === '1', played);

  // ---- tamper detection on practice games (reduced motion to go fast)
  await page.click('#modeBtn');
  ok('practice mode starts', /Practice/.test(await page.textContent('#puzzleLabel')));
  await page.click('#corruptBtn');
  const words = await page.evaluate(() => [...VALID].filter(w => w !== S.answer).slice(0, 40));
  let sawMismatch = false, sawQuarantine = false;
  for (let i = 0; i < 12 && !sawQuarantine; i++) {
    if (await page.evaluate(() => S.status !== 'playing')) { await page.click('#modeBtn'); await page.click('#modeBtn'); await page.waitForTimeout(50); }
    const w = words[i * 3 % words.length];
    await page.keyboard.type(w); await page.keyboard.press('Enter');
    await page.waitForFunction(n => S.guesses.length >= n && !S.busy, (await page.evaluate(() => S.guesses.length)) + 1, { timeout: 12000 }).catch(() => {});
    const texts = await page.$$eval('#ledger .entry', es => es.map(e => e.innerText));
    sawMismatch = texts.some(t => /mismatch/.test(t));
    sawQuarantine = (await page.$$('.node[data-status="quarantined"]')).length > 0;
  }
  const ledger2 = await page.$$eval('#ledger .entry', es => es.slice(0, 6).map(e => e.innerText.replace(/\n/g, ' | ')));
  console.log('ledger tail:', ledger2);
  ok('rogue node flagged by quorum', sawMismatch);
  ok('rogue node quarantined after 2 strikes', sawQuarantine);
  const guessesStillScored = await page.evaluate(() => S.patterns.every((p, i) => p === scoreGuess(S.guesses[i], S.answer).join('')));
  ok('every pattern shown is the honest one despite the liar', guessesStillScored);
  await page.click('#resetBtn');
  ok('reset restores 6 healthy nodes', (await page.$$('.node[data-status="quarantined"]')).length === 0);
  await page.screenshot({ path: path.join(OUT, 'shot-light-network.png'), fullPage: true });
  ok('no script errors (desktop light)', errors.length === 0, errors.join(' || '));
  await ctx.close();

  // ---- dark, phone width, overflow check
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', reducedMotion: 'reduce' });
  page = await ctx.newPage();
  const errs2 = []; page.on('pageerror', e => errs2.push(e.message));
  await page.goto(FILE); await page.waitForSelector('.tile');
  await page.keyboard.type('crane'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => S.guesses.length === 1 && !S.busy, null, { timeout: 8000 });
  const sw = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  ok('no horizontal scroll at 390px', sw.scroll <= sw.client, JSON.stringify(sw));
  await page.screenshot({ path: path.join(OUT, 'shot-dark-phone.png'), fullPage: true });
  ok('no script errors (phone dark)', errs2.length === 0, errs2.join(' || '));
  await ctx.close();

  // ---- on-screen keyboard works
  ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
  page = await ctx.newPage(); await page.goto(FILE); await page.waitForSelector('.tile');
  for (const k of 'crane') await page.click(`.key[data-key="${k}"]`);
  ok('on-screen keys type letters', (await page.evaluate(() => S.cur)) === 'crane');
  await page.click('.key[data-key="back"]');
  ok('on-screen delete works', (await page.evaluate(() => S.cur)) === 'cran');
  await ctx.close();
  await browser.close();

  console.log('\n' + results.map(r => `${r[0]}  ${r[1]}${r[2] ? '  [' + r[2] + ']' : ''}`).join('\n'));
  console.log('\n' + results.filter(r => r[0] === 'FAIL').length + ' failing of ' + results.length);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
