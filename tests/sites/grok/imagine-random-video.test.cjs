const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { readSection } = require('../../support/source.cjs');

function setup() {
  let selected, stripPresent = true, imageCalls = 0;
  const clicks = [];
  const toasts = [];
  const listeners = {};
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
    showViewerToast: (message, duration) => { toasts.push({ message, duration }); },
    imaginePostIdFromFilmstripButton: btn => btn.name,
    window: { addEventListener: (name, fn) => { listeners[name] = fn; } },
    history: {
      pushState: (_state, _title, path) => { context.location.pathname = path; },
      replaceState: (_state, _title, path) => { context.location.pathname = path; },
    },
    navigateToRandomImage: () => { imageCalls++; return true; },
  };
  vm.createContext(context);
  vm.runInContext(readSection('grok/imagine-random-video'), context);
  context.bindImagineVisitedPageLifecycle();
  function press(overrides = {}) {
    const event = { code: 'KeyR', target: {}, preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...overrides };
    context.handleViewerKeydown(event);
    return event;
  }
  return { context, buttons, clicks, toasts, listeners, press, imageCalls: () => imageCalls,
    visited: () => vm.runInContext('Array.from(imagineVisitedVideos).sort().join(",")', context),
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

test('uppercase R includes the starting video, avoids repeats, and reports exhaustion', () => {
  const h = setup();
  h.press({ key: 'R' });
  assert.ok(h.visited().includes('first'));
  assert.equal(h.visited().split(',').length, 2);
  const firstPick = h.clicks[0];
  // A remounted thumbnail with the same media ID must still count as visited.
  h.buttons[1] = { ...h.buttons[1] };
  h.press({ key: 'R' });
  assert.notEqual(h.clicks[1], firstPick);
  assert.equal(h.visited(), 'first,second,third');
  h.press({ key: 'R' });
  assert.equal(h.clicks.length, 2);
  assert.deepEqual(h.toasts.at(-1), { message: 'No more unvisited videos', duration: 1000 });
});

test('Caps Lock selects unvisited videos even when the reported key is lowercase or localized', () => {
  for (const key of ['r', 'R', 'К']) {
    const h = setup();
    const event = { key, getModifierState: modifier => modifier === 'CapsLock' };
    h.press(event);
    h.press(event);
    h.press(event);
    assert.equal(h.visited(), 'first,second,third');
    assert.equal(h.clicks.length, 2);
    assert.equal(h.toasts.at(-1).message, 'No more unvisited videos');
  }
  const h = setup();
  h.press({ key: 'r', getModifierState: () => false });
  assert.equal(h.visited(), '');
  h.press({ key: 'r', shiftKey: true, getModifierState: modifier => modifier === 'CapsLock' });
  assert.equal(h.visited(), '', 'Caps Lock plus Shift produces lowercase');
  h.press({ key: 'R', shiftKey: true, getModifierState: () => false });
  assert.notEqual(h.visited(), '', 'Shift+R also selects unvisited videos');
});

test('only uppercase R records visits; lowercase r still navigates after exhaustion', () => {
  const h = setup();
  for (const event of [{ code: 'KeyD' }, { code: 'KeyA' }, { key: 'r' }]) h.press(event);
  assert.equal(h.visited(), '');
  h.press({ key: 'R' });
  const visited = h.visited();
  h.press({ code: 'KeyD' });
  h.press({ code: 'KeyA' });
  h.press({ key: 'r' });
  assert.equal(h.visited(), visited);
  h.press({ key: 'R' });
  h.press({ key: 'R' });
  const count = h.clicks.length;
  h.press({ key: 'r' });
  assert.equal(h.clicks.length, count + 1);
});

test('visited videos reset on SPA page leave and pagehide, but survive same-page history updates', () => {
  for (const leave of ['pushState', 'replaceState', 'popstate', 'pagehide']) {
    const h = setup();
    h.press({ key: 'R' });
    const path = h.context.location.pathname;
    h.context.history.replaceState({}, '', path);
    assert.notEqual(h.visited(), '');
    if (leave === 'pushState' || leave === 'replaceState') {
      h.context.history[leave]({}, '', '/chat/elsewhere');
      h.context.history[leave]({}, '', path);
    } else {
      if (leave === 'popstate') h.context.location.pathname = '/chat/elsewhere';
      h.listeners[leave]();
    }
    assert.equal(h.visited(), '');
  }
});

test('Grok replacing the post URL on filmstrip selection preserves visited videos', () => {
  const h = setup();
  h.context.history.replaceState({}, '', '/imagine/post/first');
  for (const btn of h.buttons) {
    const click = btn.click;
    btn.click = () => {
      click.call(btn);
      h.context.history.replaceState({}, '', '/imagine/post/' + btn.name);
    };
  }
  h.press({ key: 'R', getModifierState: () => true });
  assert.equal(h.visited().split(',').length, 2, 'the selected post URL must not reset visits');
  h.press({ key: 'R', getModifierState: () => true });
  assert.equal(h.visited(), 'first,second,third');
  h.press({ key: 'R', getModifierState: () => true });
  assert.equal(h.clicks.length, 2);
  assert.equal(h.toasts.at(-1).message, 'No more unvisited videos');
  for (const event of [{ code: 'KeyA' }, { code: 'KeyD' }, { key: 'r' }]) {
    h.press(event);
    assert.equal(h.visited(), 'first,second,third', 'other navigation must preserve the set');
  }
  h.context.history.replaceState({}, '', '/imagine/post/unrelated');
  assert.equal(h.visited(), '', 'opening a post outside the filmstrip clears the set');
});

test('delayed post URL replacement and history traversal within the filmstrip preserve visits', () => {
  const h = setup();
  h.context.history.replaceState({}, '', '/imagine/post/first');
  h.press({ key: 'R' });
  const visited = h.visited();
  h.context.history.replaceState({}, '', '/imagine/post/' + h.clicks.at(-1));
  assert.equal(h.visited(), visited);
  h.context.location.pathname = '/imagine/post/first';
  h.listeners.popstate();
  assert.equal(h.visited(), visited);
  h.context.history.pushState({}, '', '/imagine/saved');
  h.context.history.pushState({}, '', '/imagine/post/first');
  assert.equal(h.visited(), '');
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

test('A/D follow video order without wrapping in page and fullscreen modes', () => {
  for (const mode of ['page', 'video-fullscreen', 'overlay']) {
    const h = setup();
    if (mode === 'video-fullscreen') h.context.document.fullscreenElement = { tagName: 'VIDEO' };
    if (mode === 'overlay') h.context.overlay = {};
    h.buttons.splice(2, 0, h.buttons[0]); // An image between the first two videos.
    assert.equal(h.press({ code: 'KeyA' }).prevented, true);
    assert.deepEqual(h.clicks, [], 'previous at the first video does nothing');
    h.press({ code: 'KeyD' });
    h.press({ code: 'KeyD' });
    h.press({ code: 'KeyD' });
    assert.deepEqual(h.clicks, ['second', 'third'], 'next stops at the last video');
    h.press({ code: 'KeyA' });
    h.press({ code: 'KeyA' });
    h.press({ code: 'KeyA' });
    assert.deepEqual(h.clicks, ['second', 'third', 'second', 'first']);
    assert.equal(h.imageCalls(), 0);
    assert.equal(h.context.overlay, null);
  }
});

test('A/D navigate relative to a selected image and respect input guards', () => {
  const h = setup();
  h.buttons[0].click();
  h.press({ code: 'KeyA' });
  assert.deepEqual(h.clicks, ['image']);
  h.press({ code: 'KeyD' });
  assert.deepEqual(h.clicks, ['image', 'first']);
  for (const code of ['KeyA', 'KeyD']) {
    for (const overrides of [{ target: { typing: true } }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
      assert.equal(h.press({ code, ...overrides }).prevented, undefined);
    }
    h.context.location.pathname = '/chat/example';
    assert.equal(h.press({ code }).prevented, undefined);
    h.context.location.pathname = '/imagine';
  }
  assert.deepEqual(h.clicks, ['image', 'first']);
  h.removeStrip();
  h.press({ code: 'KeyD' });
  assert.deepEqual(h.clicks, ['image', 'first']);
});
