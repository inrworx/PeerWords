const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'index.html'), 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];

// 1) whole script must parse
new Function(script);
console.log('script parses');

// 2) pure core logic
const core = script.split('// <core>')[1].split('// </core>')[0];
const api = new Function(core + '; return {scoreGuess, tally, tamper, computeValue, fnv, ANSWERS, VALID, ORDER};')();
const { scoreGuess, tally, tamper, computeValue, ANSWERS, VALID, ORDER } = api;
let fails = 0;
const eq = (name, got, want) => { if (got !== want) { fails++; console.log('FAIL', name, 'got', got, 'want', want); } };

eq('exact', scoreGuess('apple', 'apple').join(''), 'GGGGG');
eq('none', scoreGuess('about', 'flyer').join(''), 'BBBBB');
eq('dup guess one in answer', scoreGuess('speed', 'abide').join(''), 'BBYBY');
eq('dup answer', scoreGuess('allow', 'lolly').join(''), 'BYGYB');
eq('green beats yellow for dup', scoreGuess('geese', 'eagle').join(''), 'YYBBG');
eq('robot/floor', scoreGuess('robot', 'floor').join(''), 'YYBGB');
eq('canary', computeValue({ type: 'score', guess: 'canoe', answer: 'lemon' }), 'BBYGY');
eq('hint', computeValue({ type: 'hint', answer: 'house', pos: 2 }), '3:U');

// the classic duplicate-letter cases, checked by hand
eq('crane/trace', scoreGuess('crane', 'trace').join(''), 'YGGBG');
eq('speed/erase', scoreGuess('speed', 'erase').join(''), 'YBYYB');
eq('lolly/hello', scoreGuess('lolly', 'hello').join(''), 'BYGGB');

// tamper always differs
for (let i = 0; i < 2000; i++) {
  const v = computeValue({ type: 'score', guess: 'crane', answer: 'trace' });
  if (tamper(v, 'score', Math.random) === v) { fails++; console.log('tamper same'); break; }
  const h = '3:A';
  if (tamper(h, 'hint', Math.random) === h) { fails++; console.log('tamper hint same'); break; }
}

// tally
eq('3 agree', JSON.stringify(tally([{ value: 'a' }, { value: 'a' }, { value: 'a' }])), '{"value":"a","count":3}');
eq('2 of 3', JSON.stringify(tally([{ value: 'a' }, { value: 'b' }, { value: 'a' }])), '{"value":"a","count":2}');
eq('3-way split', tally([{ value: 'a' }, { value: 'b' }, { value: 'c' }]), null);
eq('2-2 tie', tally([{ value: 'a' }, { value: 'b' }, { value: 'a' }, { value: 'b' }]), null);
eq('split then tiebreak', JSON.stringify(tally([{ value: 'a' }, { value: 'b' }, { value: 'c' }, { value: 'b' }])), '{"value":"b","count":2}');

// lists
console.log('answers', ANSWERS.length, 'valid', VALID.size, 'order', ORDER.length);
eq('order is a permutation', new Set(ORDER).size, ANSWERS.length);
const bad = [...VALID].filter(w => !/^[a-z]{5}$/.test(w));
eq('valid all 5 letters', bad.length, 0);
const typos = ['cvcle', 'prefa', 'gipsy'].filter(w => VALID.has(w));
eq('no known typos', typos.length, 0);

// daily answer for today (2026-10-17)
const day = Math.round((Date.UTC(2026, 9, 17) - Date.UTC(2026, 0, 1)) / 864e5);
console.log('today day number', day, 'word index', day % ORDER.length);
console.log(fails ? fails + ' failures' : 'all checks passed');
process.exit(fails ? 1 : 0);
