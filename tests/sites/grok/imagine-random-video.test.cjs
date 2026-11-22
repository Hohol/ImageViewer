const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { readSection } = require('../../support/source.cjs');

function setup(localStorage, sessionStorage) {
  let selected, stripPresent = true, imageCalls = 0;
  const clicks = [];
  const toasts = [];
  const listeners = {};
  const button = (name, duration, video = false) => ({
    name, style: {}, closest: () => null,
    querySelector: selector => selector === 'video' && video ? {} : null,
    querySelectorAll: () => duration ? [{ textContent: duration }] : [],
    click() { clicks.push(name); selected = this; },
  });
  const buttons = [button('image'), button('first', '0:10'), button('second', '1:02:03'), button('third', null, true)];
  selected = buttons[1];
  const strip = { querySelectorAll: () => buttons, querySelector: () => buttons.includes(selected) ? selected : null };
  const context = {
    location: { pathname: '/imagine/post/example', origin: 'https://grok.com' }, isGrokHost: () => true,
    isChatGPTHost: () => false,
    URL, URLSearchParams, localStorage, sessionStorage,
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
      pushState: (_state, _title, path) => { const url = new URL(path, context.location.origin); context.location.pathname = url.pathname; context.location.search = url.search; },
      replaceState: (_state, _title, path) => { const url = new URL(path, context.location.origin); context.location.pathname = url.pathname; context.location.search = url.search; },
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

test('legacy camera-icon previews participate in A/D and random video navigation', () => {
  const h = setup();
  // Legacy markup has an img and <svg><g id="name=video-cam-fill">,
  // with neither a video element nor duration text inside the button.
  for (const btn of h.buttons.slice(1)) {
    btn.querySelector = selector => selector === 'svg g[id="name=video-cam-fill"]' ? {} : null;
    btn.querySelectorAll = () => [{ textContent: '' }];
  }
  h.press({ code: 'KeyD', key: 'd' });
  assert.deepEqual(h.clicks, ['second']);
  assert.equal(h.toasts.at(-1).message, '2/3');
  h.press({ code: 'KeyA', key: 'a' });
  assert.equal(h.clicks.at(-1), 'first');
  vm.runInContext('Math.random = () => 0', h.context);
  h.press();
  assert.equal(h.clicks.at(-1), 'second');
  h.press({ key: 'r' });
  assert.equal(h.clicks.at(-1), 'first');
  h.press({ key: 'r' });
  assert.equal(h.clicks.at(-1), 'third');
  h.press({ key: 'r' });
  assert.equal(h.toasts.at(-1).message, 'No more unvisited videos');
  assert.ok(!h.clicks.includes('image'), 'ordinary image thumbnails remain excluded');
});

test('Saved blocks arrival autofocus but permits search-triggered focus without clicking the prompt', () => {
  const h = setup();
  const events = {};
  let blurs = 0;
  const editor = { matches: () => true, blur() { blurs++; h.context.document.activeElement = null; } };
  h.context.document.addEventListener = (name, fn) => { events[name] = fn; };
  h.context.location.pathname = '/imagine/saved';
  h.context.document.activeElement = editor;
  h.context.bindGrokSavedComposerFocus();
  assert.equal(blurs, 1, 'initial autofocus is suppressed');
  h.context.document.activeElement = editor;
  events.focusin();
  assert.equal(blurs, 2, 'delayed autofocus is suppressed before interaction');
  events.pointerdown({ target: { closest: () => null } }); // Search wrapper, not the prompt.
  h.context.document.activeElement = editor;
  events.focusin();
  assert.equal(blurs, 2, 'search can focus its editor without a prompt click');
  h.context.history.pushState({}, '', '/imagine/post/example');
  h.context.history.pushState({}, '', '/imagine/saved');
  assert.equal(blurs, 3, 'returning to Saved rearms arrival suppression');
  events.keydown({ key: 'Tab' });
  h.context.document.activeElement = editor;
  events.focusin();
  assert.equal(blurs, 3, 'keyboard focus navigation remains available');
});

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
    h.context.document.querySelectorAll = selector => selector === 'a[href]' ? [] : [{
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

test('Back reuses native Saved links but never follows a rewritten Imagine link', () => {
  for (const route of ['back-saved', 'back-imagine', 'separate-saved']) {
    const h = setup();
    const assigned = [];
    const clicked = [];
    h.context.location.assign = url => assigned.push(url);
    const link = (href, label) => ({
      href,
      getAttribute(name) { return name === 'href' ? this.href : label; },
      setAttribute(name, value) { if (name === 'href') this.href = value; },
      click() {
        const event = { type: 'click', button: 0, target: { closest: () => this } };
        assert.equal(h.context.handleGrokPostBack(event), false, 'native click bypasses our interception');
        clicked.push(label);
      },
    });
    const back = link(route === 'back-saved' ? '/imagine/saved' : '/imagine', 'Back');
    const links = route === 'separate-saved' ? [back, link('/imagine/saved', 'Saved')] : [back];
    h.context.document.querySelectorAll = selector => selector === 'a[href]' ? links : [back];
    h.context.syncGrokPostBackLink();
    assert.equal(back.href, '/imagine/saved');
    h.context.navigateGrokBackToSaved();
    assert.deepEqual(assigned, route === 'back-imagine' ? ['/imagine/saved'] : []);
    assert.deepEqual(clicked, route === 'back-imagine' ? [] : [route === 'back-saved' ? 'Back' : 'Saved']);
  }
});

test('saved J opens loaded post links, skips hidden cards, and ignores repeats and typing', () => {
  const h = setup();
  h.context.location.pathname = '/imagine/saved';
  const opened = [];
  h.context.location.assign = url => opened.push(url);
  const link = (href, visible = true) => ({ href: new URL(href, 'https://grok.com').href, visibility: 'visible',
    getClientRects: () => visible ? [{}] : [], click() { opened.push(this.href); } });
  const first = link('https://grok.com/imagine/post/first?conversation=original');
  const hidden = link('/imagine/post/hidden', false);
  const invisible = link('/imagine/post/invisible');
  invisible.visibility = 'hidden';
  const external = link('https://example.com/imagine/post/external');
  const queryOnly = link('/imagine/saved?redirect=/imagine/post/other');
  const links = [hidden, first, invisible, external, queryOnly];
  h.context.document.querySelectorAll = selector =>
    selector === 'a[href*="/imagine/post/"]' ? links : [];
  h.context.getComputedStyle = el => ({ visibility: el.visibility });
  h.press({ code: 'KeyJ', key: 'j' });
  assert.deepEqual(opened, [first.href]);
  assert.equal(vm.runInContext('grokSavedPostUrls.size', h.context), 1);
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
  const card = href => ({ href: new URL(href, 'https://grok.com').href, getClientRects: () => [{}],
    click() { opened.push(this.href); } });
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
  assert.deepEqual(opened, ['https://grok.com/imagine/post/top?conversation=one', 'https://grok.com/imagine/post/bottom?conversation=two']);
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

test('deletion follows the last navigation hotkey, including attempts at an end', () => {
  for (const [event, start, expected] of [
    [{ code: 'KeyD' }, 'first', 'third'],
    [{ code: 'KeyA' }, 'third', 'first'],
    [{ code: 'KeyA' }, 'first', 'second'],
    [{ code: 'KeyD' }, 'third', 'second'],
    [{ key: 'R' }, 'first', 'third'],
  ]) {
    const h = setup();
    vm.runInContext('Math.random = () => 0', h.context);
    h.select(h.buttons.find(btn => btn.name === start));
    h.press(event);
    const deleted = h.clicks.at(-1) || start;
    h.context.syncImagineSelectionAfterDeletion();
    h.buttons.splice(h.buttons.findIndex(btn => btn.name === deleted), 1);
    // Make random selection choose the last survivor, distinct from next routing.
    vm.runInContext('Math.random = () => 0.99', h.context);
    h.context.syncImagineSelectionAfterDeletion();
    assert.equal(h.clicks.at(-1), expected, JSON.stringify(event) + ' from ' + start);
  }
});

test('lowercase r deletion selects unvisited survivors and preserves exhaustion', () => {
  const h = setup();
  vm.runInContext('Math.random = () => 0', h.context);
  h.press({ key: 'r' });
  assert.equal(h.clicks.at(-1), 'second');
  h.context.syncImagineSelectionAfterDeletion();
  h.buttons.splice(2, 1);
  h.context.syncImagineSelectionAfterDeletion();
  assert.equal(h.clicks.at(-1), 'third');
  assert.equal(h.visited(), 'first,second,third');
  h.buttons.pop();
  h.context.syncImagineSelectionAfterDeletion();
  assert.equal(h.clicks.length, 2);
  assert.equal(h.toasts.at(-1).message, 'No more unvisited videos');
});

test('leaving the filmstrip resets deletion navigation to next', () => {
  const h = setup();
  h.press({ code: 'KeyA' });
  h.context.history.pushState({}, '', '/imagine/saved');
  h.context.history.pushState({}, '', '/imagine/post/example');
  h.select(h.buttons[2]);
  h.context.syncImagineSelectionAfterDeletion();
  h.buttons.splice(2, 1);
  h.context.syncImagineSelectionAfterDeletion();
  assert.equal(h.clicks.at(-1), 'third');
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

test('empty J-opened posts jump again, evict deleted URLs, and fall back to Saved when exhausted', () => {
  const data = new Map([['ivGrokJumpEntry', '/imagine/post/example']]);
  const storage = { getItem: key => data.get(key) || null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const h = setup(storage, storage);
  const destinations = [];
  h.context.location.assign = url => destinations.push(url);
  h.context.history.back = () => assert.fail('J entry must not navigate back');
  vm.runInContext(`grokSavedPostUrls.add('https://grok.com/imagine/post/example?conversation=old');
    grokSavedPostUrls.add('https://grok.com/imagine/post/next?conversation=keep');`, h.context);
  h.context.leaveEmptyImaginePost(['example']);
  assert.deepEqual(destinations, ['https://grok.com/imagine/post/next?conversation=keep']);
  assert.equal(data.get('ivGrokJumpEntry'), '/imagine/post/next');
  assert.equal(data.get('ivGrokSavedPostUrls').includes('example'), false);
  h.context.location.pathname = '/imagine/post/next';
  h.context.leaveEmptyImaginePost(['next']);
  assert.equal(destinations.at(-1), '/imagine/saved');
});

test('J origin survives native thumbnail and deletion-driven URL changes without A/D/R', () => {
  for (const mode of ['native', 'after-deletion']) {
    const h = setup();
    vm.runInContext(`grokJumpEntryPath = grokJumpCurrentPath = location.pathname;
      imagineFilmstripMediaIds.clear();
      grokSavedPostUrls.add('https://grok.com/imagine/post/example');
      grokSavedPostUrls.add('https://grok.com/imagine/post/next');`, h.context);
    const destinations = [];
    h.context.location.assign = url => destinations.push(url);
    h.context.history.back = () => assert.fail('must continue J navigation');
    if (mode === 'native') {
      h.context.history.replaceState({}, '', '/imagine/post/second');
    } else {
      // Initial observer pass records IDs; deleting the selected first clip selects second.
      h.context.syncImagineSelectionAfterDeletion();
      const second = h.buttons[2];
      second.click = () => {
        h.select(second);
        h.context.history.replaceState({}, '', '/imagine/post/second');
      };
      h.buttons.splice(1, 1);
      h.context.syncImagineSelectionAfterDeletion();
    }
    assert.equal(h.context.location.pathname, '/imagine/post/second');
    h.buttons.splice(0); // Delete-all can empty the DOM before its final navigation.
    h.context.leaveEmptyImaginePost(['first', 'second', 'third']);
    assert.deepEqual(destinations, ['https://grok.com/imagine/post/next'], mode);
  }
});

test('confirmed missing J targets are evicted and retried once despite late router redirects', () => {
  const data = new Map([['ivGrokJumpEntry', '/imagine/post/example']]);
  const storage = { getItem: key => data.get(key) || null,
    setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const h = setup(storage, storage);
  const opened = [];
  h.context.location.assign = url => opened.push(url);
  vm.runInContext(`grokSavedPostUrls.add('https://grok.com/imagine/post/example?conversation=a');
    grokSavedPostUrls.add('https://grok.com/imagine/post/example?conversation=b');
    grokSavedPostUrls.add('https://grok.com/imagine/post/survivor');`, h.context);
  h.context.handleMissingGrokJumpPost('/imagine/post/unrelated');
  assert.equal(opened.length, 0);
  h.context.handleMissingGrokJumpPost('/imagine/post/example');
  assert.deepEqual(opened, ['https://grok.com/imagine/post/survivor']);
  assert.equal(vm.runInContext('grokSavedPostUrls.size', h.context), 1);
  h.context.handleMissingGrokJumpPost('/imagine/post/example');
  assert.equal(opened.length, 1, 'duplicate response cannot jump twice');
  h.context.history.pushState({}, '', '/imagine');
  assert.equal(data.get('ivGrokJumpEntry'), '/imagine/post/survivor', 'late redirect keeps next jump marker');
  assert.equal(data.get('ivGrokJumpRetries'), '1');
});

test('missing-post retries stop at the limit and handle a response arriving after redirect', () => {
  for (const retries of [0, 5]) {
    const data = new Map([['ivGrokJumpEntry', '/imagine/post/example'], ['ivGrokJumpRetries', String(retries)]]);
    const storage = { getItem: key => data.get(key) || null,
      setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
    const h = setup(storage, storage);
    const opened = [];
    h.context.location.assign = url => opened.push(url);
    vm.runInContext("grokSavedPostUrls.add('https://grok.com/imagine/post/other')", h.context);
    h.context.history.pushState({}, '', '/imagine');
    h.context.handleMissingGrokJumpPost('/imagine/post/example');
    assert.equal(opened.length, retries === 5 ? 0 : 1);
    if (retries === 5) assert.match(h.toasts.at(-1).message, /Stopped after 5/);
  }
});

test('cached links migrate to survivors with conversation and other parameters intact', () => {
  const h = setup();
  h.buttons[0].hidden = true;
  vm.runInContext(`grokSavedPostUrls.add('https://grok.com/imagine/post/first?conversation=group&extra=keep');
    grokSavedPostUrls.add('https://grok.com/imagine/post/unrelated?conversation=other');`, h.context);
  h.context.repairGrokSavedLinksAfterDeletion(['first', 'second']);
  let urls = vm.runInContext('Array.from(grokSavedPostUrls).join("\\n")', h.context);
  assert.match(urls, /post\/third\?conversation=group&extra=keep/);
  assert.match(urls, /post\/unrelated\?conversation=other/);
  assert.doesNotMatch(urls, /post\/(first|second)/);
  h.context.repairGrokSavedLinksAfterDeletion(['first', 'second', 'third']);
  urls = vm.runInContext('Array.from(grokSavedPostUrls).join("\\n")', h.context);
  assert.equal(urls, 'https://grok.com/imagine/post/unrelated?conversation=other');
});

test('J origin survives unidentified items in the same conversation but clears on a different conversation', () => {
  const h = setup();
  h.context.history.replaceState({}, '', '/imagine/post/example?conversation=group');
  vm.runInContext('grokJumpEntryPath = grokJumpCurrentPath = location.pathname', h.context);
  h.context.history.replaceState({}, '', '/imagine/post/unidentified-image?conversation=group');
  assert.equal(vm.runInContext('grokJumpCurrentPath', h.context), '/imagine/post/unidentified-image');
  h.context.history.replaceState({}, '', '/imagine/post/first?conversation=group');
  assert.equal(vm.runInContext('grokJumpEntryPath', h.context), '/imagine/post/example');
  assert.equal(vm.runInContext('grokJumpCurrentPath', h.context), '/imagine/post/first');
  h.context.history.replaceState({}, '', '/imagine/post/first?conversation=different');
  // Same media path in another conversation must not retain the previous J origin.
  assert.equal(vm.runInContext('grokJumpEntryPath', h.context), null);
});

test('Imagine volume up clears native mute and pending J mute restoration in page/fullscreen modes', () => {
  for (const fullscreen of [false, true]) {
    const data = new Map();
    const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value),
      removeItem: key => data.delete(key) };
    const h = setup(storage, storage);
    const video = { volume: 1, muted: true };
    if (fullscreen) h.context.document.fullscreenElement = { tagName: 'VIDEO' };
    let nativeMuted = true;
    h.context.getTargetVideo = () => video;
    h.context.isPostPage = () => true;
    h.context.STORAGE_KEY = 'volume';
    h.context.showVolumeOverlay = () => {};
    h.context.applySharedVolumeToAll = () => {};
    h.context.getComputedStyle = () => ({ visibility: 'visible' });
    const control = { textContent: 'Unmute', getClientRects: () => [{}], click() { nativeMuted = false; this.textContent = 'Mute'; } };
    h.context.document.querySelectorAll = () => [control];
    h.context.pickBestVisibleVideo = () => video;
    vm.runInContext('grokJumpSound = { path: location.pathname, muted: true, expires: Date.now() + 10000 }', h.context);
    storage.setItem('ivGrokJumpSound', 'pending');
    h.press({ code: 'ArrowUp', key: 'ArrowUp' });
    assert.equal(nativeMuted, false);
    assert.equal(video.muted, false);
    assert.equal(data.has('ivGrokJumpSound'), false);
    h.context.restoreGrokJumpSound();
    assert.equal(video.muted, false, 'pending restoration cannot remute after volume up');
    h.press({ code: 'ArrowUp', key: 'ArrowUp' });
    assert.equal(nativeMuted, false, 'repeated volume up does not toggle mute back on');
  }
});

test('cache migration groups by conversation and Saved observations replace targets without rescanning other groups', () => {
  const prefix = 'https://grok.com/imagine/post/';
  const initial = [prefix + 'old?conversation=group', prefix + 'other?conversation=other',
    prefix + 'last?conversation=group', prefix + 'no-conversation-a', prefix + 'no-conversation-b'];
  const data = new Map([['ivGrokSavedPostUrls', JSON.stringify(initial)]]);
  const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  const h = setup(storage);
  let cached = JSON.parse(data.get('ivGrokSavedPostUrls'));
  assert.equal(cached.length, 4);
  assert.equal(cached.includes(initial[0]), false);
  assert.equal(cached.includes(initial[2]), true);
  h.context.location.pathname = '/imagine/saved';
  h.context.getComputedStyle = () => ({ visibility: 'visible' });
  const fresh = prefix + 'fresh?conversation=group&extra=keep';
  h.context.document.querySelectorAll = () => [{ href: fresh, getClientRects: () => [{}] }];
  h.context.captureGrokSavedPosts();
  h.context.captureGrokSavedPosts();
  cached = JSON.parse(data.get('ivGrokSavedPostUrls'));
  assert.equal(cached.length, 4);
  assert.equal(cached.includes(initial[2]), false);
  assert.equal(cached.includes(fresh), true);
  assert.equal(cached.includes(initial[1]), true, 'unvisited group remains cached');
  assert.equal(cached.includes(initial[3]), true);
  assert.equal(cached.includes(initial[4]), true);
  h.context.location.pathname = '/imagine/post/different-item';
  h.context.location.search = '?conversation=group';
  const opened = [];
  h.context.location.assign = url => opened.push(url);
  for (let i = 0; i < 20; i++) h.press({ code: 'KeyJ', key: 'j' });
  assert.equal(opened.length, 20);
  assert.equal(opened.includes(fresh), false, 'exclude entire current conversation');
});

test('ordinary entries retain back navigation and leaving a J post clears its origin', () => {
  const h = setup();
  let back = 0;
  h.context.history.back = () => { back++; };
  h.context.leaveEmptyImaginePost();
  assert.equal(back, 1);
  vm.runInContext("grokJumpEntryPath = grokJumpCurrentPath = location.pathname", h.context);
  h.context.history.pushState({}, '', '/imagine/saved');
  h.context.history.pushState({}, '', '/imagine/post/example');
  h.context.leaveEmptyImaginePost();
  assert.equal(back, 2);
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
