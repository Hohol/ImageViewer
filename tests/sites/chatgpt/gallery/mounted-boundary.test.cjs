const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readSection } = require('../../../support/source.cjs');
const source = readSection('chatgpt/gallery');
const start = source.indexOf('        function mountedBoundary(');
const end = source.indexOf('        async function findNext(', start);
assert.ok(start >= 0 && end > start);
const boundary = new Function('turnSelector', 'turnKey', source.slice(start, end) + '\nreturn mountedBoundary;')('[data-turn-key]', () => 'test-turn');

function fixture() {
  const transcript = { matches: () => true, children: [] };
  const extent = { parentElement: transcript, style: { height: '900px' },
    getBoundingClientRect: () => ({ top: 0, bottom: 900, height: 900 }) };
  const block = { parentElement: extent, style: { marginTop: '0px' }, children: [],
    getBoundingClientRect: () => ({ top: 0, bottom: 900, height: 900 }),
    querySelectorAll: () => turns };
  const turns = [0, 1, 2].map(() => ({ complete: true, pending: false,
    querySelector(selector) { return selector.includes('complete') ? this.complete : this.pending; }
  }));
  block.children = turns.map(turn => (turn.parentElement = { parentElement: block }));
  transcript.children = [extent];
  const root = { contains: node => node === transcript };
  const item = { key: 'image', turn: 'middle', order: 0, img: { closest: () => turns[1] } };
  return { root, transcript, extent, block, turns, item,
    check: (direction, items = [item]) => boundary(root, 'image', direction, items) };
}

test('complete mounted edges avoid searching even with text before/after the image', () => {
  const f = fixture();
  assert.equal(f.check(-1), true);
  assert.equal(f.check(1), true);
});
test('virtual gaps and older-history pagination are not boundaries', () => {
  const f = fixture();
  f.block.getBoundingClientRect = () => ({ top: 300, bottom: 600, height: 300 });
  assert.equal(f.check(-1), false);
  assert.equal(f.check(1), false);
  f.block.getBoundingClientRect = f.extent.getBoundingClientRect;
  f.transcript.children.unshift({ hidden: false, getBoundingClientRect: () => ({ height: 40 }) });
  assert.equal(f.check(-1), false);
  assert.equal(f.check(1), true);
});
test('incomplete turns, placeholders and additional images keep navigation available', () => {
  const f = fixture();
  f.turns[2].complete = false;
  assert.equal(f.check(1), false);
  assert.equal(f.check(-1), true);
  f.turns[2].complete = true;
  f.turns[1].pending = true;
  assert.equal(f.check(1), false);
  f.turns[1].pending = false;
  assert.equal(f.check(1, [f.item, { ...f.item, key: 'new', order: 1 }]), false);
  assert.equal(f.check(-1, [f.item, { ...f.item, key: 'old', order: -1 }]), false);
  assert.equal(f.check(1, [f.item, { key: 'later', turn: 'last', img: { closest: () => f.turns[2] } }]), false);
});
test('unmounted selection and unfamiliar markup retain the existing search', () => {
  const f = fixture();
  assert.equal(f.check(1, []), false);
  f.extent.style.height = '';
  assert.equal(f.check(1), false);
});

test('remembered bottom survives older chunks and remounts, but new content invalidates it', () => {
  const extract = (first, last) => source.slice(source.indexOf(first), source.indexOf(last, source.indexOf(first)));
  const make = new Function(`
    const knownEnds = new Map(), records = new Map(), turnPositions = new Map();
    let turnOrder = ['last'];
    let visibleEnd = true;
    const mountedBoundary = (root, key, direction) => visibleEnd && direction === 1;
    ${extract('        function mergeTurns(', '        function mounted(')}
    ${extract('        function rememberMountedEnds(', '        function rememberEditedTurn(')}
    return { knownEnds, records, mergeTurns, rememberMountedEnds,
      unmount() { visibleEnd = false; } };
  `);
  const f = make();
  const key = JSON.stringify(['last', 'message', 0]);
  const item = { key, turn: 'last', order: 0, img: { complete: true, naturalWidth: 100 } };
  f.rememberMountedEnds({}, [item]);
  f.records.set(key, item);
  assert.equal(f.knownEnds.get(1), key, 'passive capture records bottom before navigation');
  f.unmount();
  f.mergeTurns(['older', 'last']);
  f.rememberMountedEnds({}, []);
  assert.equal(f.knownEnds.get(1), key, 'older chunks and unmount preserve bottom');
  f.rememberMountedEnds({}, [item]);
  assert.equal(f.knownEnds.get(1), key, 'remount preserves bottom');
  f.rememberMountedEnds({}, [item, { ...item, key: 'extra', order: 1 }]);
  assert.equal(f.knownEnds.has(1), false, 'additional image in same turn invalidates bottom');
  f.knownEnds.set(1, key);
  f.mergeTurns(['last', 'new']);
  assert.equal(f.knownEnds.has(1), false, 'newer turn invalidates bottom');
});

test('full scan skips only the extra wait at a settled, confirmed start', async () => {
  const scan = source.slice(source.indexOf('        async function scan()'), source.indexOf('        function cancel('));
  const loopStart = scan.indexOf('                setFromBottom(root, 0);');
  const loopEnd = scan.indexOf('            } catch (e)', loopStart);
  assert.ok(loopStart >= 0 && loopEnd > loopStart);
  const run = new Function('root', 'settle', 'mountedTurnBoundary', `
    return (async () => {
      const session = {}, turnSelector = '[data-turn-key]';
      let completed = false, stopReason = 'inactive';
      const setFromBottom = () => {}, scanTime = () => 0, active = () => true;
      const fromBottom = () => root.scrollHeight - root.clientHeight;
      const signature = () => 'unchanged';
      ${scan.slice(loopStart, loopEnd)}
      return { completed, stopReason };
    })();
  `);
  const structural = new Function('turnSelector', 'turnKey', source.slice(start, end) + '\nreturn mountedTurnBoundary;')(
    '[data-turn-key]', () => 'test-turn');
  for (const scenario of ['confirmed', 'pagination', 'unfinished', 'timeout', 'unknown-layout']) {
    const f = fixture();
    f.root.scrollHeight = 900;
    f.root.clientHeight = 300;
    f.root.querySelectorAll = () => f.turns;
    if (scenario === 'pagination') f.transcript.children.unshift({ getBoundingClientRect: () => ({ height: 30 }) });
    if (scenario === 'unfinished') f.turns[0].complete = false;
    if (scenario === 'unknown-layout') f.extent.style.height = '';
    const waits = [];
    const result = await run(f.root, async (session, wait) => {
      waits.push(wait ?? 'normal');
      return scenario !== 'timeout';
    }, structural);
    assert.equal(result.completed, true);
    assert.deepEqual(waits, scenario === 'confirmed' ? ['normal'] : ['normal', 4000], scenario);
    assert.equal(result.stopReason, scenario === 'confirmed' ? 'mounted-top' : 'confirmed-top');
  }
});
