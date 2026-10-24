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
  const image = (ids, name, picker = false) => {
    if (!owners.has(ids)) owners.set(ids, owner(ids));
    return { name, owner: owners.get(ids), closest(selector) {
      if (selector.includes('generated-image-preview')) {
        if (picker && !selector.includes('Show generated image')) return null;
        return { getAttribute: () => (picker ? 'Show generated image ' : 'Generated image ') + (name === 'first' ? 1 : 2) };
      }
      return this.owner;
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
  // A selected large preview followed by the complete right-hand picker.
  for (const selected of ['first', 'second']) {
    nodes = [image('message-a message-b', selected),
      image('message-a message-b', 'first', true), image('message-a message-b', 'second', true)];
    const mounted = context.mounted();
    assert.deepEqual(Array.from(mounted, item => item.img.name), ['first', 'second'],
      'mounted navigation and boundaries follow image order');
    assert.equal(mounted.length, 2, 'capture each image once, including the unselected picker image');
    assert.equal(context.imageKeys.get(nodes[0]),
      context.imageKeys.get(nodes[selected === 'first' ? 1 : 2]), 'clicks share the preview identity');
    cache();
    assert.deepEqual(Array.from(context.images(), img => img.name), ['first', 'second'],
      'changing the large preview preserves gallery order without duplicates');
  }
  nodes = [image('message-a message-b', 'second', true)];
  assert.equal(context.mounted()[0].key, JSON.stringify(['turn', 'message-b', 0]),
    'a picker image loading first retains its numbered identity');

});
