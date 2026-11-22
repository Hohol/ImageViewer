const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSection } = require('../../../support/source.cjs');
const source = readSection('chatgpt/gallery');
const block = source.slice(source.indexOf('        let reconciliationSample;'),
  source.indexOf('        function openCacheDatabase('));

function fixture() {
  let now = 0, atStart = false, incomplete = false;
  const deleted = [], revoked = [];
  const transcript = { matches: () => true };
  const container = { parentElement: { parentElement: { parentElement: transcript } }, children: [] };
  const turns = ['a', 'b'].map(id => ({
    id, querySelector: selector => selector.includes('complete') ? {} : incomplete ? {} : null,
    parentElement: {},
  }));
  for (const turn of turns) turn.parentElement.parentElement = container;
  container.children = turns.map(turn => turn.parentElement);
  const records = new Map(['before', 'a', 'missing', 'b', 'after'].map(key =>
    [key, { key, turn: key, url: 'blob:' + key, size: 10 }]));
  const context = vm.createContext({
    Date: { now: () => now }, generation: 0, diskLoad: { pending: false },
    timeline: () => ({ querySelectorAll: () => turns, contains: node => node === transcript }),
    turnSelector: 'turn', turnKey: turn => turn.id,
    turnOrder: ['before', 'a', 'missing', 'b', 'after'], records,
    mountedTurnBoundary: () => atStart, bytes: 50, knownEnds: new Map(),
    URL: { revokeObjectURL: url => revoked.push(url) }, overlay: null, imgs: [], currentIndex: -1,
    imageKeys: new WeakMap(), savedChatId: () => 'chat',
    withDiskCache: (mode, action) => action({ delete: key => deleted.push(Array.from(key)) }),
    traceCache() {}, galleryCacheTraceKey: 'cache',
    setTimeout() {}, scheduleCapture() {},
  });
  vm.runInContext(block + source.slice(source.indexOf('        function transcriptAncestor('),
    source.indexOf('        async function findNext(')), context);
  const items = () => ['a', 'b'].map(key => ({ key, img: { complete: true, naturalWidth: 100 } }));
  return { context, records, deleted, revoked,
    step(ms = 600) { now += ms; context.reconcileMountedImages(items()); },
    incomplete(value) { incomplete = value; },
    start() { atStart = true; },
  };
}

test('settled contiguous history removes absent cached turns from memory and disk, preserving unseen history', () => {
  const f = fixture();
  f.step();
  assert.equal(f.deleted.length, 0);
  f.step();
  assert.deepEqual([...f.records.keys()], ['before', 'a', 'b', 'after']);
  assert.deepEqual(f.deleted, [['chat', 'missing']]);
  assert.deepEqual(f.revoked, ['blob:missing']);
  f.start();
  f.step();
  assert.equal(f.records.has('before'), false, 'confirmed chat start covers stale earlier entries');
  assert.equal(f.records.has('after'), true);
});

test('incomplete content and delayed disk restoration cannot cause removal', () => {
  const f = fixture();
  f.incomplete(true);
  f.step();
  f.step();
  assert.equal(f.deleted.length, 0);
  f.incomplete(false);
  f.context.diskLoad.pending = true;
  f.step();
  f.step();
  assert.equal(f.deleted.length, 0);
  f.context.diskLoad.pending = false;
  f.step();
  assert.equal(f.deleted.length, 0, 'settle period starts after disk restoration');
  f.step();
  assert.deepEqual(f.deleted, [['chat', 'missing']]);
});
