const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { readSection } = require('../../support/source.cjs');

test('navigation diagnostics track virtualization and redact image URLs', async () => {
  // Synthetic inventories preserve the old snapshot shapes without recording
  // conversation UUIDs, image URLs, or private chat content.
  const fixtures = [[5, [0, 2]], [4, [0, 1, 3]], [6, [0, 2, 4]]].map(([count, imageTurns], window) => ({
    turns: Array.from({ length: count }, (_, i) => ({ key: `window-${window}-turn-${i}`, images: imageTurns.includes(i) ? 1 : 0 })),
    images: imageTurns.map(i => ({ src: `blob:fixture-${window}-${i}`, turn: `window-${window}-turn-${i}`, message: `message-${window}-${i}` })),
  }));
  let turns = [], images = [], mutationCallback, timerCallback;
  const listeners = new Map();
  const logs = [];
  const timeline = {
    scrollTop: -120, scrollHeight: 40000, clientHeight: 900,
    querySelectorAll: selector => selector === 'img' ? images : turns,
  };
  const document = {
    body: {},
    querySelector: () => timeline,
    addEventListener: (type, cb) => listeners.set(type, cb),
    removeEventListener: type => listeners.delete(type),
  };
  const context = {
    IV_CHATGPT_NAVIGATION_DEBUG: true, isChatGPTHost: () => true,
    window: {}, document, location: { origin: 'https://chatgpt.com', pathname: '/c/test' },
    imageNavigationSearch: null, ivChatGPTGallery: null, overlay: null, overlayImage: null, imgs: [], currentIndex: -1,
    innerWidth: 1200, innerHeight: 900,
    isExcludedImage: img => !!img.skip,
    getComputedStyle: () => ({ flexDirection: 'column-reverse' }),
    console: { log: msg => logs.push(msg), info: () => {} },
    setTimeout: cb => { timerCallback = cb; return 1; }, clearTimeout: () => { timerCallback = null; },
    MutationObserver: class {
      constructor(cb) { mutationCallback = cb; }
      observe() { this.observing = true; }
      disconnect() { this.observing = false; }
    },
  };
  function mount(fixture) {
    images.forEach(img => { img.isConnected = false; });
    turns = fixture.turns.map(turn => ({
      getAttribute: key => key === 'data-turn-key' ? turn.key : null,
      querySelector: () => ({ getAttribute: () => 'complete' }),
      querySelectorAll: () => Array(turn.images).fill({}),
    }));
    images = fixture.images.map(img => ({
      tagName: 'IMG', nodeType: 1, src: img.src, currentSrc: img.src,
      isConnected: true, complete: true, naturalWidth: 1024, naturalHeight: 1536,
      closest: selector => selector.includes('data-turn-key')
        ? turns.find(turn => turn.getAttribute('data-turn-key') === img.turn)
        : { getAttribute: key => key === 'data-chatgpt-search-message-ids' ? img.message : null },
      getBoundingClientRect: () => ({ width: 400, height: 600, top: 10, bottom: 610, left: 0, right: 400 }),
      matches: () => true, querySelector: () => null,
    }));
  }
  vm.createContext(context);
  vm.runInContext(readSection('chatgpt/navigation-debug'), context);
  mount(fixtures[0]);
  const api = context.createChatGPTNavigationDebug();
  let report = JSON.parse(api.export());
  assert.equal(report.events[0].turns.length, 5);
  assert.equal(report.events[0].images.length, 2);
  assert.equal(report.events[0].timeline.direction, 'column-reverse');
  context.imgs = images.slice(); context.currentIndex = 1;
  mount(fixtures[1]);
  let entry = api.snapshot();
  assert.equal(entry.turns.length, 4);
  assert.equal(entry.images.length, 3);
  assert.equal(entry.changes.turnsRemoved.length, 5);
  assert.equal(entry.changes.turnsAdded.length, 4);
  assert.equal(entry.changes.imagesRemoved.length, 2);
  assert.equal(entry.gallery.detached.length, 2);
  assert.equal(entry.gallery.selected.connected, false);
  mount(fixtures[2]);
  entry = api.snapshot();
  assert.equal(entry.turns.length, 6);
  assert.equal(entry.changes.turnsRemoved.length, 4);
  images[0].src = 'https://example.test/image?token=secret';
  entry = api.snapshot();
  assert.equal(entry.changes.sourcesChanged.length, 1);
  assert(!api.export().includes('secret'));
  assert(!api.export().includes('https://'));
  context.location.pathname = '/c/other';
  entry = api.snapshot();
  assert.equal(entry.changes.routeChanged, true);
  assert.equal(entry.changes.turnsRemoved.length, 0);
  listeners.get('error')({ type: 'error', target: images[0] });
  assert.equal(JSON.parse(api.export()).events.at(-1).event, 'image-error');
  const count = logs.length;
  mutationCallback([{ type: 'childList', target: {}, addedNodes: [images[0]], removedNodes: [] }]);
  mutationCallback([{ type: 'attributes', target: images[0] }]);
  assert.equal(logs.length, count);
  timerCallback();
  assert.equal(logs.length, count + 1);
  assert.equal(JSON.parse(api.export()).events.at(-1).event, 'timeline-update');
  // Exercise the actual navigation boundary, with disconnected gallery entries.
  context.ivChatGPTNavigationDebug = api;
  context.saveOverlayNativeScrollForCurrent = () => {};
  context.displayImageInOverlay = () => {};
  context.currentIndex = context.imgs.length - 1;
  vm.runInContext(readSection('shared/viewer/navigation'), context);
  context.navigate(1);
  entry = JSON.parse(api.export()).events.at(-1);
  assert.equal(entry.event, 'navigate');
  assert.equal(entry.blocked, true);
  assert.equal(entry.gallery.detached.length, 2);
  for (let i = 0; i < 310; i++) api.snapshot();
  report = JSON.parse(api.export());
  assert.equal(report.events.length, 300);
  assert(report.totalEvents > 300);
  api.stop();
  assert.equal(listeners.size, 0);
  const stopped = logs.length;
  api.record('ignored');
  assert.equal(logs.length, stopped);
  api.clear();
  assert.equal(JSON.parse(api.export()).events.length, 0);
  api.start();
  assert.equal(listeners.size, 3);
  assert.equal(JSON.parse(api.export()).events.length, 1);
  api.stop();
  context.isChatGPTHost = () => false;
  assert.equal(context.createChatGPTNavigationDebug(), null);
  context.isChatGPTHost = () => true;
  context.IV_CHATGPT_NAVIGATION_DEBUG = false;
  assert.equal(context.createChatGPTNavigationDebug(), null);
});
