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
  ok('network panel folded by default on desktop', await page.isHidden('#nodes'));
  const centered = await page.evaluate(() => { const g = document.querySelector('.game').getBoundingClientRect(); return Math.abs((g.left + g.right) / 2 - innerWidth / 2) < 30; });
  ok('game centered while the panel is folded', centered);
  const topAligned = await page.evaluate(() => { const l = document.querySelector('.logo img').getBoundingClientRect(), b = document.getElementById('board').getBoundingClientRect(); return Math.abs((l.left + l.right) / 2 - (b.left + b.right) / 2) < 12; });
  ok('logo lined up over the board while folded', topAligned);
  ok('no Hide button while folded', await page.isHidden('#netHide'));
  await page.click('#netToggle');
  ok('desktop header opens the panel', await page.isVisible('#nodes') && await page.isVisible('#netHide'));
  await page.click('#netHide');
  ok('Hide button folds the panel', await page.isHidden('#nodes'));
  await page.click('#netToggle');
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
  ok('network panel folded by default on a phone', (await page.isHidden('#netBody')) && (await page.getAttribute('#netToggle', 'aria-expanded')) === 'false');
  ok('quorum pill still shown when folded', await page.isVisible('#quorum'));
  await page.click('#netToggle');
  ok('tapping the header opens the panel', await page.isVisible('#nodes'));
  await page.reload(); await page.waitForSelector('.tile');
  ok('panel choice remembered', await page.isVisible('#nodes'));
  await page.click('#netToggle');
  await page.screenshot({ path: path.join(OUT, 'shot-dark-phone.png'), fullPage: true });
  ok('no script errors (phone dark)', errs2.length === 0, errs2.join(' || '));
  await ctx.close();

  // ---- Belly's AI clue, against a mocked PeerBelly Game API
  async function clueRun(mode) {
    const c = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
    await c.addInitScript(() => { window.PEERBELLY_API = 'https://api.test'; });
    const seen = { sessions: 0, jobs: [], polls: 0, keys: [], byId: {} };
    await c.route('https://api.test/**', async route => {
      const req = route.request(), url = new URL(req.url());
      const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (mode === 'down') return route.abort('connectionrefused');
      if (url.pathname === '/v1/games/sessions') {
        seen.sessions++;
        return json(201, { sessionId: 'ses_1', token: 'pbgs.test', playerId: 'anon_1', expiresAt: new Date(Date.now() + 9e5).toISOString() });
      }
      if (url.pathname === '/v1/inference') {
        const body = JSON.parse(req.postData());
        seen.jobs.push(body); seen.keys.push(req.headers()['idempotency-key']);
        seen.auth = req.headers()['authorization'];
        if (mode === 'limited') return json(429, { error: { code: 'RATE_LIMITED', message: 'slow down' } });
        const id = `job_${seen.jobs.length}`;
        seen.byId[id] = { body, polls: 0 };
        return json(202, { jobId: id, status: 'queued' });
      }
      const m = url.pathname.match(/^\/v1\/jobs\/(job_\d+)$/);
      if (m && seen.byId[m[1]]) {
        const j = seen.byId[m[1]]; seen.polls++;
        if (++j.polls < 2) return json(200, { jobId: m[1], status: 'running' });
        const outputs = {
          'words.generate_clue': { clue: 'A tall gray bird that wades in marshes.' },
          'words.react_guess': { line: `Guess ${j.body.input.guessNumber}, keep it up!` },
          'words.word_story': { story: 'A short story about the word, with one fun fact.' },
        };
        return json(200, { jobId: m[1], status: 'completed', result: { schema: 'x', output: outputs[j.body.taskType], fallback: false } });
      }
      return json(404, { error: { code: 'JOB_NOT_FOUND', message: 'no' } });
    });
    const pg = await c.newPage();
    const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto(FILE); await pg.waitForSelector('.tile');
    if (mode === 'game') return { c, pg, seen, errs };
    await pg.click('#hintBtn');
    await pg.waitForSelector('#belly:not([hidden])', { timeout: 8000 });
    const letterOk = /slot \d is the letter [A-Z]/.test(await pg.textContent('#belly'));
    await pg.waitForFunction(() => S.hint && !S.hint.clueLoading, null, { timeout: 15000 });
    const out = { seen, errs, letterOk, text: (await pg.textContent('#belly')).replace(/\s+/g, ' ').trim(), hint: await pg.evaluate(() => S.hint), answer: await pg.evaluate(() => DAILY_ANSWER), day: await pg.evaluate(() => DAY_NUM) };
    if (mode === 'ok') {
      await pg.reload(); await pg.waitForSelector('.tile');
      out.restored = (await pg.textContent('#belly')).replace(/\s+/g, ' ').trim();
      await pg.screenshot({ path: path.join(OUT, 'shot-clue.png'), fullPage: true });
    }
    await c.close();
    return out;
  }
  const good = await clueRun('ok');
  const job = good.seen.jobs[0] || {};
  ok('clue job sent once with the round and answer', good.seen.jobs.length === 1 && job.taskType === 'words.generate_clue' && job.gameId === 'peerwords' && job.sessionId === 'ses_1' && job.input.answer === good.answer && job.input.roundId === `daily-${good.day + 1}`, JSON.stringify(job));
  ok('clue job has session token and idempotency key', good.seen.auth === 'Bearer pbgs.test' && !!good.seen.keys[0], String(good.seen.auth));
  ok('clue shown under the letter hint', good.letterOk && good.text.includes('A tall gray bird that wades in marshes.'), good.text);
  ok('clue survives reload', (good.restored || '').includes('A tall gray bird'), good.restored);
  ok('no script errors (clue)', good.errs.length === 0, good.errs.join(' || '));
  for (const mode of ['limited', 'down']) {
    const r = await clueRun(mode);
    ok(`API ${mode}: letter hint still shown, no clue`, r.letterOk && !r.hint.clue && !/thinking/.test(r.text), r.text);
    ok(`API ${mode}: no script errors`, r.errs.length === 0, r.errs.join(' || '));
  }

  // ---- Belly reacts to guesses and tells the word's story at the end (mocked API)
  {
    const { c, pg, seen, errs } = await clueRun('game');
    const ans = await pg.evaluate(() => DAILY_ANSWER);
    const wrong = await pg.evaluate(a => [...VALID].filter(w => w !== a && !w.split('').some(ch => a.includes(ch))).slice(0, 2), ans);
    for (const [i, w] of wrong.entries()) {
      await pg.keyboard.type(w); await pg.keyboard.press('Enter');
      await pg.waitForFunction(n => S.guesses.length === n && !S.busy, i + 1, { timeout: 8000 });
      await pg.waitForFunction(n => !document.getElementById('bubble').hidden && document.getElementById('bubbleText').textContent.includes(`Guess ${n}`), i + 1, { timeout: 8000 });
    }
    const reacts = seen.jobs.filter(j => j.taskType === 'words.react_guess');
    ok('a reaction is asked for after each guess', reacts.length === 2 && reacts[1].input.guessNumber === 2 && /^[GYB]{5}$/.test(reacts[0].input.pattern), JSON.stringify(reacts.map(r => r.input)));
    ok('reactions never send the answer', reacts.every(r => !('answer' in r.input) && !JSON.stringify(r).includes(ans)));
    ok('reaction shown in a bubble over the board', (await pg.textContent('#bubbleText')) === 'Guess 2, keep it up!' && (await pg.textContent('#bubbleLabel')) === 'Belly' && await pg.isVisible('#bubble'));
    const pos = await pg.evaluate(() => { const b = document.getElementById('bubble').getBoundingClientRect(), r = document.querySelectorAll('.row')[1].getBoundingClientRect(), bd = document.getElementById('board').getBoundingClientRect(); return { top: b.top, rowBottom: r.bottom, inBoard: b.top < bd.bottom }; });
    ok('reaction bubble sits just under the row it is about', pos.top > pos.rowBottom && pos.inBoard, JSON.stringify(pos));
    await pg.screenshot({ path: path.join(OUT, 'shot-reaction.png') });
    await pg.click('#bubbleClose');
    ok('bubble closes', await pg.isHidden('#bubble'));
    await pg.keyboard.type(ans); await pg.keyboard.press('Enter');
    await pg.waitForSelector('#result:not([hidden])', { timeout: 10000 });
    await pg.waitForFunction(() => !document.getElementById('bubble').hidden && document.getElementById('bubble').classList.contains('story') && document.getElementById('bubbleText').textContent.includes('fun fact'), null, { timeout: 10000 });
    const story = seen.jobs.find(j => j.taskType === 'words.word_story');
    ok('story asked for once the round ends', !!story && story.input.answer === ans && story.input.solved === true && story.input.guesses === 3, JSON.stringify(story && story.input));
    ok('no reaction for the winning guess', seen.jobs.filter(j => j.taskType === 'words.react_guess').length === 2);
    ok('story shown in the bubble once the round ends', (await pg.textContent('#bubbleText')).includes('fun fact'));
    ok('story bubble is headed Belly Fun Fact:', (await pg.textContent('#bubbleLabel')) === 'Belly Fun Fact:');
    await pg.screenshot({ path: path.join(OUT, 'shot-story.png'), fullPage: true });
    const before = seen.jobs.length;
    await pg.reload(); await pg.waitForSelector('.tile');
    ok('story survives reload without asking again', (await pg.textContent('#bubbleText')).includes('fun fact') && await pg.isVisible('#bubble') && seen.jobs.length === before);
    ok('no script errors (story and reactions)', errs.length === 0, errs.join(' || '));
    await c.close();
  }

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
