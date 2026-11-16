const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSection } = require('../../../support/source.cjs');

const source = readSection('chatgpt/gallery');
const cache = source.slice(source.indexOf('        let cacheDatabase;'), source.indexOf('        const pause ='));
const records = new Map();
test('a restored first image stops backward navigation and late reads cannot cross chats', async () => {
  let request;
  const context = vm.createContext({
    maxBytes: 1024, generation: 1, conversation: 'local-chatgpt:one',
    location: { pathname: '/c/saved' }, conversationPath: '/c/saved', bytes: 0, records,
    turnPositions: new Map(), imageKeys: new WeakMap(),
    knownEnds: new Map(), turnOrder: ['turn'], run: null,
    document: { createElement: () => ({}) },
    URL: { createObjectURL: blob => 'blob:restored-' + blob },
    mergeTurns: () => {},
  });
  vm.runInContext(cache, context);
  context.withDiskCache = async (mode, action) => action({
    put() {},
    index: () => ({
      getAll(chat) {
        assert.equal(chat, context.location.pathname.split('/').at(-1));
        return request = {};
      },
    }),
  });
  const entry = { key: 'image', turn: 'turn', order: 0, position: 10, turnPosition: 20,
    pixels: 100, size: 10, blob: 'copy' };
  context.restoreCachedImages();
  Object.assign(request, { result: [entry, { key: 'first-image', imageKey: 'image' }] });
  request.onsuccess();
  assert.equal(records.get('image').image.src, 'blob:restored-copy');
  assert.equal(context.imageKeys.get(records.get('image').image), 'image');
  assert.equal(context.knownEnds.get(-1), 'image');
  Object.assign(context, {
    cacheOnly: () => false, run: null, syncConversation: () => 'saved',
    timeline: () => ({}), mounted: () => [],
    mountedBoundary() { assert.fail('A remembered first image needs no boundary search'); },
  });
  vm.runInContext(source.slice(source.indexOf('        async function findNext('),
    source.indexOf('        let observedRoot')), context);
  assert.equal(await context.findNext(records.get('image').image, -1, () => true), null);

  context.knownEnds.clear();
  context.location.pathname = '/c/other';
  assert.equal(context.savedChatId(), null, 'a pending route change cannot write to the new chat');
  context.conversationPath = '/c/other';
  context.conversation = 'other';
  context.restoreCachedImages();
  context.location.pathname = '/c/third';
  context.conversation = 'third';
  context.generation++;
  Object.assign(request, { result: [{ ...entry, key: 'stale' }] });
  request.onsuccess();
  assert.equal(records.has('stale'), false);
});

test('legacy images survive while observed order replaces stale positions and persists', () => {
  let request, savedOrder;
  const records = new Map();
  const context = vm.createContext({
    maxBytes: 1024, generation: 1, conversation: 'saved', run: null,
    location: { pathname: '/c/saved' }, conversationPath: '/c/saved', bytes: 0, records,
    turnPositions: new Map(), imageKeys: new WeakMap(), knownEnds: new Map(), turnOrder: [],
    document: { createElement: () => ({}) }, URL: { createObjectURL: blob => 'blob:' + blob },
  });
  vm.runInContext(cache + source.slice(source.indexOf('        function mergeTurns('),
    source.indexOf('        function mounted()')), context);
  context.withDiskCache = (mode, action) => action({
    index: () => ({ getAll: () => request = {} }),
    put: entry => { savedOrder = entry; },
  });
  const entries = ['older', 'latest'].map((turn, i) => ({
    key: turn, turn, turnPosition: i * 100, order: 0, pixels: 100, size: 10, blob: turn,
  }));
  context.restoreCachedImages();
  Object.assign(request, { result: entries });
  request.onsuccess();
  assert.deepEqual(Array.from(context.turnOrder), ['latest', 'older']);
  context.observeTurnOrder(['older', 'latest'], true);
  assert.deepEqual(Array.from(savedOrder.turns), ['older', 'latest']);
  assert.equal(records.size, 2);
  records.clear();
  context.turnOrder = [];
  vm.runInContext('diskLoad = null; observedTurns.clear(); savedOrderSignature = "";', context);
  context.restoreCachedImages();
  Object.assign(request, { result: [...entries, savedOrder] });
  request.onsuccess();
  assert.deepEqual(Array.from(context.turnOrder), ['older', 'latest']);
  assert.equal(records.size, 2);
});
