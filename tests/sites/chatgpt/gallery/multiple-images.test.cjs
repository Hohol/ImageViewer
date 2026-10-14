const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSection } = require('../../../support/source.cjs');

test('two generated images keep distinct identities when messages are grouped and remounted', () => {
  const source = readSection('chatgpt/gallery');
  const mounted = source.slice(source.indexOf('        function mounted('), source.indexOf('        function rememberMountedEnds('));
  const images = source.slice(source.indexOf('        function images('), source.indexOf('        function nearestImage('));
  let nodes = [];
  const turn = { querySelectorAll: () => nodes, getBoundingClientRect: () => ({ top: 0 }) };
  const root = { querySelectorAll: () => [turn], getBoundingClientRect: () => ({ top: 0 }) };
  const owner = ids => ({ getAttribute: name => name === 'data-chatgpt-search-message-ids' ? ids : null,
    querySelectorAll: () => nodes.filter(img => img.owner === owners.get(ids)) });
  const owners = new Map();
  const image = (ids, name) => {
    if (!owners.has(ids)) owners.set(ids, owner(ids));
    return { name, owner: owners.get(ids), closest(selector) {
      return selector.includes('generated-image-preview') ? { getAttribute: () => 'Generated image ' + (name === 'first' ? 1 : 2) } : this.owner;
    }, getBoundingClientRect: () => ({ top: 0, height: 100 }) };
  };
  const context = { timeline: () => root, turnSelector: '[data-turn-key]', turnKey: () => 'turn',
    discardedTurns: new WeakMap(), discardedImages: new WeakMap(), imageKeys: new WeakMap(),
    records: new Map(), turnPositions: new Map(), turnOrder: ['turn'], fromBottom: () => 0,
    mergeTurns() {}, rememberMountedEnds() {}, isExcludedImage: () => false, syncConversation: () => true };
  vm.createContext(context);
  vm.runInContext(mounted + images, context);
  const cache = () => {
    for (const item of context.mounted()) {
      const proxy = { name: item.img.name };
      context.imageKeys.set(proxy, item.key);
      context.records.set(item.key, { ...item, image: proxy, url: 'blob:' + item.img.name });
    }
  };
  // The captured log loads the SECOND image first, then inserts the first before it.
  nodes = [image('message-a message-b', 'second')];
  cache();
  assert.equal(context.imageKeys.get(nodes[0]), JSON.stringify(['turn', 'message-b', 0]));
  nodes = [image('message-a message-b', 'first'), nodes[0]];
  cache();
  assert.equal(context.images().length, 2, 'late first image must not leave a duplicate second image');
  const pair = context.images();
  assert.deepEqual(Array.from(pair, img => img.name), ['first', 'second']);
  const selectedLast = nodes[1];
  const at = pair.findIndex(img => context.imageKeys.get(img) === context.imageKeys.get(selectedLast));
  assert.equal(pair[at - 1].name, 'first', 'one Left from the last picture reaches the first');
  nodes = [image('message-a', 'first'), image('message-b', 'second')];
  cache();
  const originalKeys = nodes.map(img => context.imageKeys.get(img));
  nodes = [image('message-a message-b', 'first'), image('message-a message-b', 'second')];
  cache();
  assert.deepEqual(nodes.map(img => context.imageKeys.get(img)), originalKeys);
  const list = context.images();
  assert.deepEqual(Array.from(list, img => img.name), ['first', 'second']);
  const selected = nodes[0];
  const index = list.findIndex(img => context.imageKeys.get(img) === context.imageKeys.get(selected));
  assert.equal(list[index + 1].name, 'second', 'Right advances to the other picture, not a stale duplicate');
  nodes = [image('message-a', 'first'), image('message-b', 'second')];
  cache();
  assert.equal(context.images().length, 2, 'splitting the group again does not duplicate pictures');
});
