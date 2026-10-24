const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { readSection } = require('../../support/source.cjs');

function fixture() {
  const context = {
    window: { innerWidth: 1000, innerHeight: 800 },
    document: { querySelectorAll: () => context.nodes },
    nodes: [], ivChatGPTGallery: null,
    isExcludedImage: img => !!img.excluded,
  };
  vm.createContext(context);
  vm.runInContext(readSection('shared/viewer/hotkey-image'), context);
  return context;
}
function image(top, left = 400, width = 200, height = 200) {
  return { getBoundingClientRect: () => ({
    top, left, width, height, right: left + width, bottom: top + height,
  }) };
}

test('gallery hotkey chooses nearest offscreen image, not document order', () => {
  const c = fixture();
  const far = image(-3000), above = image(-250), below = image(900);
  c.nodes = [far, below, above];
  assert.equal(c.pickGalleryHotkeyImage(), above);
  c.nodes = [far, image(-1500), below];
  assert.equal(c.pickGalleryHotkeyImage(), below);
  const side = image(300, 1001, 100);
  c.nodes.push(side);
  assert.equal(c.pickGalleryHotkeyImage(), side, 'horizontal distance also counts');
});

test('gallery hotkey ignores excluded and unlaid-out images and handles empty pages', () => {
  const c = fixture();
  const valid = image(1000), excluded = image(810), hidden = image(400, 500, 0, 0);
  excluded.excluded = true;
  c.nodes = [excluded, hidden, valid];
  assert.equal(c.pickGalleryHotkeyImage(), valid);
  c.nodes = [excluded, hidden];
  assert.equal(c.pickGalleryHotkeyImage(), null);
  c.nodes = [];
  assert.equal(c.pickGalleryHotkeyImage(), null);
});

test('visible selection and ChatGPT unloaded-history fallback remain intact', () => {
  const c = fixture();
  const cached = {}, offscreen = image(1000), visible = image(300);
  c.ivChatGPTGallery = { nearestImage: () => cached };
  c.nodes = [offscreen];
  assert.equal(c.pickGalleryHotkeyImage(), cached);
  c.nodes.push(visible);
  assert.equal(c.pickGalleryHotkeyImage(), visible);
  c.nodes = [offscreen];
  c.ivChatGPTGallery.nearestImage = () => null;
  assert.equal(c.pickGalleryHotkeyImage(), offscreen, 'empty cache falls back to mounted geometry');
});
