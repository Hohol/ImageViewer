const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSection } = require('../../../support/source.cjs');
const source = readSection('chatgpt/gallery');
const part = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('active drawing controls expose only cached images, including an empty cache', () => {
  const cached = { name: 'cached' }, mounted = { name: 'mounted' };
  const c = vm.createContext({ cacheOnly: () => true, syncConversation: () => true,
    records: new Map([['one', { key: 'one', turn: 'turn', order: 0, url: 'blob:one', image: cached }]]),
    mounted: () => [{ key: 'two', turn: 'turn', order: 1, img: mounted }], turnOrder: ['turn'] });
  vm.runInContext(part('        function images()', '        function nearestImage()'), c);
  assert.deepEqual(Array.from(c.images()), [cached]);
  c.cacheOnly = () => false;
  assert.deepEqual(Array.from(c.images()), [cached, mounted]);
  c.cacheOnly = () => true; c.records.clear();
  assert.deepEqual(Array.from(c.images()), []);
});

test('active controls block scans, uncached navigation, and scroll writes', async () => {
  const c = vm.createContext({ cacheOnly: () => true, showViewerToast() {} });
  vm.runInContext(part('        async function scan()', '        function mountedBoundary(') +
    part('        async function findNext(', '        let observedRoot') +
    part('        function setFromBottom(', '        function scanState('), c);
  await c.scan();
  assert.equal(await c.findNext({}, -1, () => true), null);
  const root = { scrollTop: 17, scrollHeight: 500, clientHeight: 100 };
  c.setFromBottom(root, 200);
  assert.equal(root.scrollTop, 17);
  c.cacheOnly = () => false; c.getComputedStyle = () => ({ flexDirection: 'column' });
  c.setFromBottom(root, 200);
  assert.equal(root.scrollTop, 200);
});

test('gallery clicks preserve automation, while normal message controls still stop it', () => {
  const controls = readSection('chatgpt/retries');
  let handler, stopped = 0;
  const c = vm.createContext({ document: { addEventListener: (type, fn) => { handler = fn; } },
    automaticClick: false, panel: { contains: () => false }, overlay: { contains: target => target.overlay },
    imageFromEventTarget: target => target.image, isPromptSend: () => false, run: {}, turnSelector: '[data-turn-key]',
    finish: () => { stopped++; } });
  const start = controls.indexOf("        document.addEventListener('click', (event)");
  vm.runInContext(controls.slice(start, controls.indexOf("        document.addEventListener('keydown'", start)), c);
  const button = { closest: () => ({}), getAttribute: () => '', matches: () => false };
  handler({ isTrusted: true, button: 0, target: { image: true, closest: () => button } });
  handler({ isTrusted: true, button: 0, target: { overlay: true } });
  assert.equal(stopped, 0);
  handler({ isTrusted: true, button: 0, target: { closest: () => button } });
  assert.equal(stopped, 1);
});
