const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { readSection } = require('../../support/source.cjs');

function setup(localStorage) {
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
  const strip = { querySelectorAll: () => buttons, querySelector: () => buttons.includes(selected) ? selected : null };
  const context = {
    location: { pathname: '/imagine/post/example', origin: 'https://grok.com' }, isGrokHost: () => true,
    URL, localStorage,
    pickBestVisibleVideo: () => null,
    document: { querySelector: () => stripPresent ? strip : null, querySelectorAll: () => [] },
    overlay: null, ivChatGPTGallery: null,
    viewerHotkeysModalBlocksKeydown: () => false,
    isKeyboardTypingTarget: target => target.typing,
    hideGallery: () => { context.overlay = null; },
    showViewerToast: (message, duration) => { toasts.push({ message, duration }); },
    imaginePostIdFromFilmstripButton: btn => btn?.name || null,
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
    const event = { code: 'KeyR', key: 'R', target: {}, preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...overrides };
    context.handleViewerKeydown(event);
    return event;
  }
  return { context, buttons, clicks, toasts, listeners, press, imageCalls: () => imageCalls,
    select: btn => { selected = btn; },
    visited: () => vm.runInContext('Array.from(imagineVisitedVideos).sort().join(",")', context),
    removeStrip: () => { stripPresent = false; } };
}

test('post Back and Escape always navigate to Saved, retaining dismissal priorities', () => {
  const h = setup();
  const destinations = [];
  h.context.location.assign = url => destinations.push(url);
  h.context.isFullscreenApiActive = () => false;
  h.context.document.querySelector = () => null;
  const click = { type: 'click', button: 0, target: { closest: () => ({}) },
    preventDefault() {}, stopImmediatePropagation() {} };
  assert.equal(h.context.handleGrokPostBack(click), true);
  h.press({ code: 'Escape', key: 'Escape', target: { typing: true } });
  assert.deepEqual(destinations, ['/imagine/saved', '/imagine/saved']);
  const escape = { ...click, type: 'keydown', key: 'Escape' };
  h.context.overlay = {};
  assert.equal(h.context.handleGrokPostBack(escape), false);
  h.context.overlay = null;
  h.context.isFullscreenApiActive = () => true;
  assert.equal(h.context.handleGrokPostBack(escape), false);
  h.context.isFullscreenApiActive = () => false;
  h.context.document.querySelectorAll = () => [{ getClientRects: () => [{}], closest: () => null }];
  h.context.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
  assert.equal(h.context.handleGrokPostBack(escape), false);
  assert.equal(h.context.handleGrokPostBack({ ...click, ctrlKey: true }), false);
  assert.equal(h.context.handleGrokPostBack({ ...click, target: { closest: () => null } }), false);
  h.context.location.pathname = '/imagine/saved';
  assert.equal(h.context.handleGrokPostBack(click), false);
  assert.equal(destinations.length, 2);
});

test('Escape ignores hidden cookie dialogs and closed popups on post pages', () => {
  for (const mode of ['no-layout', 'hidden-ancestor', 'visibility-hidden', 'display-none']) {
    const h = setup();
    const destinations = [];
    h.context.location.assign = url => destinations.push(url);
    h.context.isFullscreenApiActive = () => false;
    h.context.document.querySelectorAll = () => [{
      getClientRects: () => mode === 'no-layout' ? [] : [{}],
      closest: () => mode === 'hidden-ancestor' ? {} : null,
    }];
    h.context.getComputedStyle = () => ({
      visibility: mode === 'visibility-hidden' ? 'hidden' : 'visible',
      display: mode === 'display-none' ? 'none' : 'block',
    });
    const event = h.press({ code: 'Escape', key: 'Escape' });
    assert.equal(event.stopped, true, mode);
    assert.deepEqual(destinations, ['/imagine/saved'], mode);
  }
});

test('saved J opens loaded post links, skips hidden cards, and ignores repeats and typing', () => {
  const h = setup();
  h.context.location.pathname = '/imagine/saved';
  const opened = [];
  h.context.location.assign = url => opened.push(url);
  const link = (href, visible = true) => ({ href, visibility: 'visible',
    getClientRects: () => visible ? [{}] : [], click() { opened.push(this.href); } });
  const first = link('/imagine/post/first?conversation=original');
  const hidden = link('/imagine/post/hidden', false);
  const invisible = link('/imagine/post/invisible');
  invisible.visibility = 'hidden';
  h.context.document.querySelectorAll = () => [hidden, first, invisible];
  h.context.getComputedStyle = el => ({ visibility: el.visibility });
  h.press({ code: 'KeyJ', key: 'j' });
  assert.deepEqual(opened, [first.href]);
  for (const guard of [{ repeat: true }, { target: { typing: true } }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) h.press({ code: 'KeyJ', key: 'j', ...guard });
  assert.equal(opened.length, 1);
  h.context.document.querySelectorAll = () => [];
  h.press({ code: 'KeyJ', key: 'j' });
  assert.deepEqual(opened, [first.href, first.href]);
  assert.equal(h.imageCalls(), 0);
  assert.equal(h.clicks.length, 0);
});

test('saved cache retains unmounted posts, deduplicates remounts, and captures only on saved pages', () => {
  const h = setup();
  const opened = [];
  h.context.location.pathname = '/imagine/saved';
  h.context.location.assign = url => opened.push(url);
  h.context.getComputedStyle = () => ({ visibility: 'visible' });
  const card = href => ({ href, getClientRects: () => [{}], click: () => opened.push(href) });
  let cards = [card('/imagine/post/top?conversation=one')];
  h.context.document.querySelectorAll = () => cards;
  h.context.captureGrokSavedPosts();
  cards = [card('/imagine/post/bottom?conversation=two')];
  h.context.captureGrokSavedPosts();
  cards = [card('/imagine/post/top?conversation=one')];
  h.context.captureGrokSavedPosts();
  assert.equal(vm.runInContext('grokSavedPostUrls.size', h.context), 2);
  h.context.location.pathname = '/imagine/post/other';
  cards = [card('/imagine/post/unrelated')];
  h.context.captureGrokSavedPosts();
  assert.equal(vm.runInContext('grokSavedPostUrls.size', h.context), 2);
  h.context.location.pathname = '/imagine/saved';
  cards = [];
  vm.runInContext('Math.random = () => 0', h.context);
  h.press({ code: 'KeyJ', key: 'j' });
  vm.runInContext('Math.random = () => 0.999', h.context);
  h.press({ code: 'KeyJ', key: 'j' });
  assert.deepEqual(opened, ['/imagine/post/top?conversation=one', '/imagine/post/bottom?conversation=two']);
});

test('saved cache restores from local storage in a new session and rejects unrelated stored URLs', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const first = setup(storage);
  first.context.location.pathname = '/imagine/saved';
  const href = 'https://grok.com/imagine/post/top?conversation=original';
  first.context.getComputedStyle = () => ({ visibility: 'visible' });
  first.context.document.querySelectorAll = () => [{ href, getClientRects: () => [{}] }];
  first.context.captureGrokSavedPosts();
  const restored = setup(storage);
  restored.context.location.pathname = '/imagine/saved';
  const opened = [];
  restored.context.location.assign = url => opened.push(url);
  restored.press({ code: 'KeyJ', key: 'j' });
  assert.deepEqual(opened, [href]);
  storage.setItem('ivGrokSavedPostUrls', JSON.stringify([href, 'https://example.com/imagine/post/no', 'javascript:alert(1)', 'https://grok.com/settings']));
  const filtered = setup(storage);
  assert.equal(vm.runInContext('grokSavedPostUrls.size', filtered.context), 1);
  storage.setItem('ivGrokSavedPostUrls', 'invalid json');
  assert.equal(vm.runInContext('grokSavedPostUrls.size', setup(storage).context), 0);
});

test('post J skips the current post regardless of conversation query and safely handles no alternatives', () => {
  const h = setup();
  h.context.location.pathname = '/imagine/post/current/';
  const opened = [];
  h.context.location.assign = url => opened.push(url);
  vm.runInContext(`grokSavedPostUrls.add('https://grok.com/imagine/post/current?conversation=old');
    grokSavedPostUrls.add('https://grok.com/imagine/post/other?conversation=keep');`, h.context);
  for (const guard of [{ repeat: true }, { target: { typing: true } }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    h.press({ code: 'KeyJ', key: 'j', ...guard });
  }
  assert.equal(opened.length, 0);
  h.press({ code: 'KeyJ', key: 'j' });
  assert.deepEqual(opened, ['https://grok.com/imagine/post/other?conversation=keep']);
  vm.runInContext("grokSavedPostUrls.delete('https://grok.com/imagine/post/other?conversation=keep')", h.context);
  h.press({ code: 'KeyJ', key: 'j' });
  assert.equal(opened.length, 1);
  h.context.location.pathname = '/chat/example';
  assert.equal(h.press({ code: 'KeyJ', key: 'j' }).prevented, undefined);
});

test('random post sound handoff restores muted and unmuted state after a full navigation', () => {
  for (const muted of [true, false]) {
    const data = new Map();
    const storage = { getItem: key => data.get(key) || null,
      setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
    const source = setup();
    source.context.sessionStorage = storage;
    source.context.pickBestVisibleVideo = () => ({ muted });
    source.context.rememberGrokJumpSound('https://grok.com/imagine/post/destination');
    const destination = setup();
    destination.context.sessionStorage = storage;
    destination.context.location.pathname = '/imagine/post/destination';
    const video = { muted: !muted };
    const events = {};
    destination.context.document.addEventListener = (name, fn) => { events[name] = fn; };
    destination.context.pickBestVisibleVideo = () => video;
    let clicks = 0;
    destination.context.getComputedStyle = () => ({ visibility: 'visible' });
    destination.context.document.querySelectorAll = () => [{ textContent: muted ? 'Mute' : 'Unmute',
      getClientRects: () => [{}], click: () => { clicks++; } }];
    destination.context.bindGrokJumpSound();
    assert.equal(video.muted, muted);
    assert.equal(clicks, 1);
    video.muted = !muted; // A late player initialization must also be corrected.
    events.playing();
    assert.equal(video.muted, muted);
    events.pointerdown({ isTrusted: true });
    video.muted = !muted;
    events.playing();
    assert.equal(video.muted, !muted, 'explicit user interaction releases the handoff');
    assert.equal(data.size, 0);
  }
});

test('X delegates to the selected-delete button in page and fullscreen modes with confirmation toast', () => {
  for (const fullscreen of [false, true]) {
    const h = setup();
    if (fullscreen) h.context.document.fullscreenElement = { tagName: 'VIDEO' };
    h.context.IV_GROK_DELETE_SELECTED_BTN_ID = 'iv-grok-delete-selected-media';
    h.context.IV_GROK_DELETE_ARM_MS = 10000;
    const hidden = [];
    h.context.hideViewerToast = message => hidden.push(message);
    let clicks = 0;
    const button = { dataset: {}, disabled: false, click() {
      clicks++;
      if (this.dataset.ivGrokSelArmed) {
        delete this.dataset.ivGrokSelArmed;
        this.disabled = true;
      } else this.dataset.ivGrokSelArmed = '1';
    } };
    h.context.document.getElementById = id => {
      assert.equal(id, 'iv-grok-delete-selected-media');
      return button;
    };
    const press = overrides => h.press({ code: 'KeyX', key: 'x', ...overrides });
    assert.equal(press().stopped, true);
    assert.equal(clicks, 1);
    assert.deepEqual(h.toasts.at(-1), { message: 'Press X again to delete (1/3)', duration: 10000 });
    for (const guard of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true },
      { target: { typing: true } }, { isComposing: true }]) press(guard);
    assert.equal(clicks, 1);
    press();
    assert.equal(clicks, 2);
    assert.deepEqual(hidden, ['Press X again to delete (1/3)']);
    press();
    assert.equal(clicks, 2, 'disabled deletion cannot be submitted again');
    button.disabled = false;
    h.context.location.pathname = '/imagine/saved';
    assert.equal(press().prevented, undefined);
    assert.equal(clicks, 2);
  }
});

test('deleting the selected video advances next, falls back previous, and skips hidden videos', () => {
  for (const fullscreen of [false, true]) {
    for (const mode of ['remove', 'hide']) {
      const h = setup();
      if (fullscreen) h.context.document.fullscreenElement = { tagName: 'VIDEO' };
      h.context.syncImagineSelectionAfterDeletion();
      if (mode === 'remove') h.buttons.splice(1, 1);
      else h.buttons[1].parentElement = { style: { display: 'none' } };
      h.context.syncImagineSelectionAfterDeletion();
      assert.deepEqual(h.clicks, ['second']);
      h.select(h.buttons.find(btn => btn.name === 'third'));
      h.context.syncImagineSelectionAfterDeletion();
      h.buttons.splice(h.buttons.findIndex(btn => btn.name === 'third'), 1);
      h.context.syncImagineSelectionAfterDeletion();
      assert.deepEqual(h.clicks, ['second', 'second']);
      h.buttons.splice(h.buttons.findIndex(btn => btn.name === 'second'), 1);
      h.context.syncImagineSelectionAfterDeletion();
      assert.equal(h.clicks.length, 2, 'no video survivor: do not select an image');
    }
  }
});

test('deletion tracking preserves selection for unselected deletions and unrelated page changes', () => {
  const h = setup();
  h.context.syncImagineSelectionAfterDeletion();
  h.buttons.pop();
  h.context.syncImagineSelectionAfterDeletion();
  assert.equal(h.clicks.length, 0);
  h.context.location.pathname = '/imagine/post/unrelated';
  h.buttons.splice(1, 1);
  h.context.syncImagineSelectionAfterDeletion();
  assert.equal(h.clicks.length, 0);
});

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

test('lowercase r includes the starting video, avoids repeats, and reports exhaustion', () => {
  const h = setup();
  h.press({ key: 'r' });
  assert.ok(h.visited().includes('first'));
  assert.equal(h.visited().split(',').length, 2);
  const firstPick = h.clicks[0];
  // A remounted thumbnail with the same media ID must still count as visited.
  h.buttons[1] = { ...h.buttons[1] };
  h.press({ key: 'r' });
  assert.notEqual(h.clicks[1], firstPick);
  assert.equal(h.visited(), 'first,second,third');
  h.press({ key: 'r' });
  assert.equal(h.clicks.length, 2);
  assert.deepEqual(h.toasts.at(-1), { message: 'No more unvisited videos', duration: 1000 });
});

test('Caps Lock uses ordinary random selection; lowercase and Caps Lock plus Shift select unvisited', () => {
  for (const key of ['r', 'R', 'К']) {
    const h = setup();
    const event = { key, getModifierState: modifier => modifier === 'CapsLock' };
    for (let i = 0; i < 5; i++) h.press(event);
    assert.equal(h.visited(), '');
    assert.equal(h.clicks.length, 5);
  }
  for (const event of [
    { key: 'r', getModifierState: () => false },
    { key: 'r', shiftKey: true, getModifierState: modifier => modifier === 'CapsLock' },
  ]) {
    const h = setup();
    h.press(event);
    h.press(event);
    h.press(event);
    assert.equal(h.visited(), 'first,second,third');
    assert.equal(h.clicks.length, 2);
    assert.equal(h.toasts.at(-1).message, 'No more unvisited videos');
  }
  const h = setup();
  h.press({ key: 'R', shiftKey: true, getModifierState: () => false });
  assert.equal(h.visited(), '', 'Shift+R uses ordinary random selection');
});

test('only lowercase r records visits; uppercase R still navigates after exhaustion', () => {
  const h = setup();
  for (const event of [{ code: 'KeyD' }, { code: 'KeyA' }, { key: 'R' }]) h.press(event);
  assert.equal(h.visited(), '');
  h.press({ key: 'r' });
  const visited = h.visited();
  h.press({ code: 'KeyD' });
  h.press({ code: 'KeyA' });
  h.press({ key: 'R' });
  assert.equal(h.visited(), visited);
  h.press({ key: 'r' });
  h.press({ key: 'r' });
  const count = h.clicks.length;
  h.press({ key: 'R' });
  assert.equal(h.clicks.length, count + 1);
});

test('visited videos reset on SPA page leave and pagehide, but survive same-page history updates', () => {
  for (const leave of ['pushState', 'replaceState', 'popstate', 'pagehide']) {
    const h = setup();
    h.press({ key: 'r' });
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
  h.press({ key: 'r', getModifierState: () => false });
  assert.equal(h.visited().split(',').length, 2, 'the selected post URL must not reset visits');
  h.press({ key: 'r', getModifierState: () => false });
  assert.equal(h.visited(), 'first,second,third');
  h.press({ key: 'r', getModifierState: () => false });
  assert.equal(h.clicks.length, 2);
  assert.equal(h.toasts.at(-1).message, 'No more unvisited videos');
  for (const event of [{ code: 'KeyA' }, { code: 'KeyD' }, { key: 'R' }]) {
    h.press(event);
    assert.equal(h.visited(), 'first,second,third', 'other navigation must preserve the set');
  }
  h.context.history.replaceState({}, '', '/imagine/post/unrelated');
  assert.equal(h.visited(), '', 'opening a post outside the filmstrip clears the set');
});

test('delayed post URL replacement and history traversal within the filmstrip preserve visits', () => {
  const h = setup();
  h.context.history.replaceState({}, '', '/imagine/post/first');
  h.press({ key: 'r' });
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

test('all navigation methods skip removed videos and hidden deletion wrappers with live counts', () => {
  for (const mode of ['page', 'fullscreen']) {
    for (const removal of ['removed', 'hidden', 'hidden-wrapper']) {
      for (const event of [{ code: 'KeyA' }, { code: 'KeyD' }, { key: 'R' }, { key: 'r' }]) {
        const h = setup();
        if (mode === 'fullscreen') h.context.document.fullscreenElement = { tagName: 'VIDEO' };
        // Populate navigation state before deleting the middle video.
        h.press({ code: 'KeyD' });
        const middle = h.buttons[2];
        if (removal === 'removed') h.buttons.splice(2, 1);
        if (removal === 'hidden') middle.style.display = 'none';
        if (removal === 'hidden-wrapper') middle.parentElement = { style: { display: 'none' } };
        const backward = event.code === 'KeyA';
        h.select(backward ? h.buttons.at(-1) : h.buttons[1]);
        h.press(event);
        assert.equal(h.clicks.at(-1), backward ? 'first' : 'third');
        assert.deepEqual(h.toasts.at(-1), { message: backward ? '1/2' : '2/2', duration: 1000 });
        h.context.showImagineVideoIndex();
        assert.equal(h.toasts.at(-1).message, backward ? '1/2' : '2/2', 'hover shares the live count');
      }
    }
  }
});

test('deleting the current video before a delayed URL update preserves visited history', () => {
  const h = setup();
  h.context.history.replaceState({}, '', '/imagine/post/first');
  h.press({ key: 'r' });
  const deletedName = h.clicks.at(-1);
  h.context.history.replaceState({}, '', '/imagine/post/' + deletedName);
  const visited = h.visited();
  h.buttons.splice(h.buttons.findIndex(btn => btn.name === deletedName), 1);
  h.select(h.buttons[1]); // Grok selects a survivor before replacing the old URL.
  h.press({ code: 'KeyA' }); // Refresh navigation against the shrunken strip.
  h.context.history.replaceState({}, '', '/imagine/post/first');
  assert.equal(h.visited(), visited);
  h.press({ key: 'r' });
  assert.notEqual(h.clicks.at(-1), deletedName);
  assert.equal(h.toasts.at(-1).message, '2/2');
  h.press({ key: 'r' });
  assert.equal(h.toasts.at(-1).message, 'No more unvisited videos');
});

test('deleting unvisited videos causes exhaustion without revisiting survivors', () => {
  const h = setup();
  h.press({ key: 'r' });
  const chosen = h.clicks.at(-1);
  const unvisitedIndex = h.buttons.findIndex(btn => btn.name !== 'image' && btn.name !== 'first' && btn.name !== chosen);
  h.buttons.splice(unvisitedIndex, 1);
  const count = h.clicks.length;
  h.press({ key: 'r' });
  assert.equal(h.clicks.length, count);
  assert.equal(h.toasts.at(-1).message, 'No more unvisited videos');
  h.press({ key: 'R' });
  assert.equal(h.clicks.at(-1), 'first', 'ordinary random navigation remains available');
});

test('single and empty video lists after deletion are safe for every navigation method', () => {
  const h = setup();
  h.press({ key: 'r' });
  h.buttons.splice(2);
  h.select(h.buttons[1]);
  const count = h.clicks.length;
  for (const event of [{ code: 'KeyA' }, { code: 'KeyD' }, { key: 'R' }, { key: 'r' }]) h.press(event);
  assert.equal(h.clicks.length, count);
  h.context.showImagineVideoIndex();
  assert.equal(h.toasts.at(-1).message, '1/1');
  h.buttons.splice(1);
  for (const event of [{ code: 'KeyA' }, { code: 'KeyD' }, { key: 'R' }, { key: 'r' }]) h.press(event);
  assert.equal(h.clicks.length, count);
  const toastCount = h.toasts.length;
  h.context.showImagineVideoIndex();
  assert.equal(h.toasts.length, toastCount, 'no invalid index toast after deleting all videos');
});
