const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { readSection } = require('../../support/source.cjs');

function setup() {
  let selected, stripPresent = true, imageCalls = 0;
  const clicks = [];
  const button = (name, duration, video = false) => ({
    name, style: {},
    querySelector: selector => selector === 'video' && video ? {} : null,
    querySelectorAll: () => duration ? [{ textContent: duration }] : [],
    click() { clicks.push(name); selected = this; },
  });
  const buttons = [button('image'), button('first', '0:10'), button('second', '1:02:03'), button('third', null, true)];
  selected = buttons[1];
  const strip = { querySelectorAll: () => buttons, querySelector: () => selected };
  const context = {
    location: { pathname: '/imagine/post/example' }, isGrokHost: () => true,
    document: { querySelector: () => stripPresent ? strip : null },
    overlay: null, ivChatGPTGallery: null,
    viewerHotkeysModalBlocksKeydown: () => false,
    isKeyboardTypingTarget: target => target.typing,
    hideFullscreen: () => { context.overlay = null; },
    navigateToRandomImage: () => { imageCalls++; return true; },
  };
  vm.createContext(context);
  vm.runInContext(readSection('grok/imagine-random-video'), context);
  function press(overrides = {}) {
    const event = { code: 'KeyR', target: {}, preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...overrides };
    context.handleViewerKeydown(event);
    return event;
  }
  return { context, buttons, clicks, press, imageCalls: () => imageCalls,
    removeStrip: () => { stripPresent = false; } };
}

test('Imagine R selects a different video in page, video fullscreen, and image overlay modes', () => {
  for (const mode of ['page', 'video-fullscreen', 'overlay']) {
    const h = setup();
    if (mode === 'video-fullscreen') h.context.document.fullscreenElement = { tagName: 'VIDEO' };
    if (mode === 'overlay') h.context.overlay = {};
    for (let i = 0; i < 30; i++) {
      const previous = h.clicks.at(-1) || 'first';
      const event = h.press();
      assert.equal(event.prevented, true);
      assert.equal(event.stopped, true);
      assert.notEqual(h.clicks.at(-1), 'image');
      assert.notEqual(h.clicks.at(-1), previous);
    }
    assert.equal(h.imageCalls(), 0);
    assert.equal(h.context.overlay, null);
  }
});

test('Imagine consumes R without falling back to images when no other video is available', () => {
  const h = setup();
  h.buttons.splice(2);
  assert.equal(h.press().prevented, true);
  assert.equal(h.clicks.length, 0);
  h.removeStrip();
  for (const pathname of ['/imagine', '/imagine/saved', '/imagine/post/example']) {
    h.context.location.pathname = pathname;
    assert.equal(h.press().prevented, true);
  }
  assert.equal(h.imageCalls(), 0);
});

test('R preserves typing, modifiers, composition, and random images outside Imagine', () => {
  const h = setup();
  for (const overrides of [{ target: { typing: true } }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
    assert.equal(h.press(overrides).prevented, undefined);
  }
  assert.equal(h.clicks.length, 0);
  h.context.location.pathname = '/chat/example';
  h.press();
  assert.equal(h.imageCalls(), 1);
  h.context.location.pathname = '/imagine';
  h.context.isGrokHost = () => false;
  h.press();
  assert.equal(h.imageCalls(), 2);
});
