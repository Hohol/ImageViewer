const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSection } = require('../../support/source.cjs');

function harness(options = {}) {
  const writes = [], messages = [], draws = [], canvases = [], loadModes = [];
  const video = { tagName: 'VIDEO', readyState: 2, videoWidth: 1920, videoHeight: 1080,
    currentTime: 4.25, currentSrc: 'https://media.test/video.mp4', paused: false };
  const clone = new EventTarget();
  Object.assign(clone, { videoWidth: 1920, videoHeight: 1080, readyState: 2, time: 0 });
  Object.defineProperty(clone, 'currentTime', {
    get() { return this.time; },
    set(time) { this.time = time; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); },
  });
  clone.load = () => {
    if (clone.src) loadModes.push(clone.crossOrigin);
    const failed = options.loadError || options.rejectMode === clone.crossOrigin;
    if (clone.src) queueMicrotask(() => clone.dispatchEvent(new Event(failed ? 'error' : 'loadeddata')));
  };
  clone.removeAttribute = name => { delete clone[name]; };
  const context = {
    setTimeout, clearTimeout, overlay: null,
    showViewerToast: message => messages.push(message), ivLogImageClipboard() {},
    ClipboardItem: class { constructor(data) { this.data = data; } },
    navigator: { clipboard: { async write(items) {
      if (options.denyClipboard) throw new Error('Permission denied');
      writes.push(await items[0].data['image/png']);
    } } },
    document: {
      createElement(tag) {
        if (tag === 'video') return clone;
        assert.equal(tag, 'canvas');
        const canvas = {
          getContext: () => ({ drawImage(target) { draws.push({ target, time: target.currentTime }); } }),
          toBlob(callback, mime) {
            assert.equal(mime, 'image/png');
            if (options.tainted && draws.at(-1).target === video) {
              const error = new Error('Tainted canvas'); error.name = 'SecurityError'; throw error;
            }
            const complete = () => callback(options.emptyBlob ? null : { type: mime, size: 42 });
            if (options.defer) context.encode = complete;
            else complete();
          },
        };
        canvases.push(canvas);
        return canvas;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(readSection('shared/viewer/video-frame-copy'), context);
  return { context, video, clone, writes, messages, draws, canvases, loadModes };
}

test('copies a full-resolution PNG of the frame at keypress without changing playback', async () => {
  const { context, video, draws, writes, canvases, messages } = harness({ defer: true });
  const before = { ...video };
  const copying = context.copyVideoFrameToClipboard(video);
  assert.equal(draws[0].time, 4.25, 'pixels captured synchronously before PNG encoding');
  assert.equal(canvases[0].width, 1920);
  assert.equal(canvases[0].height, 1080);
  await context.copyVideoFrameToClipboard(video);
  assert.equal(draws.length, 1, 'overlapping copies are suppressed');
  context.encode();
  await copying;
  assert.equal(writes[0].type, 'image/png');
  assert.deepEqual(video, before, 'playback and original video remain untouched');
  assert.equal(messages.at(-1), 'Video frame copied to clipboard');
});

test('tainted canvas fallback loads a separate CORS player and seeks the captured timestamp', async () => {
  const { context, video, clone, draws, writes } = harness({ tainted: true });
  const before = { ...video };
  await context.copyVideoFrameToClipboard(video);
  assert.equal(clone.crossOrigin, 'use-credentials');
  assert.equal(clone.muted, true);
  assert.equal(draws[1].target, clone);
  assert.equal(draws[1].time, before.currentTime);
  assert.equal(clone.src, undefined, 'temporary player released');
  assert.equal(writes.length, 1);
  assert.deepEqual(video, before);
});

test('Grok video without crossOrigin can copy from an asset that rejects anonymous loading', async () => {
  const { context, video, writes, loadModes } = harness({ tainted: true, rejectMode: 'anonymous' });
  video.crossOrigin = null;
  await context.copyVideoFrameToClipboard(video);
  assert.equal(writes.length, 1);
  assert.deepEqual(loadModes, ['use-credentials']);
});

test('public CDN fallback retries anonymous CORS when credentials are rejected', async () => {
  const { context, video, writes, loadModes } = harness({ tainted: true, rejectMode: 'use-credentials' });
  await context.copyVideoFrameToClipboard(video);
  assert.equal(writes.length, 1);
  assert.deepEqual(loadModes, ['use-credentials', 'anonymous']);
});

test('unready and seeking videos leave the clipboard untouched', async () => {
  for (const state of [{ readyState: 1 }, { videoWidth: 0 }, { videoHeight: 0 }, { seeking: true }]) {
    const { context, video, writes, messages } = harness();
    Object.assign(video, state);
    await context.copyVideoFrameToClipboard(video);
    assert.equal(writes.length, 0);
    assert.equal(messages.at(-1), 'Video frame is not ready yet');
  }
});

test('capture, CORS, and permission failures are handled and allow subsequent copies', async () => {
  for (const options of [{ emptyBlob: true }, { tainted: true, loadError: true }, { denyClipboard: true }]) {
    const { context, video, clone, messages } = harness(options);
    await context.copyVideoFrameToClipboard(video);
    assert.match(messages.at(-1), /^Could not copy video frame: /);
    assert.equal(messages.at(-1), 'Could not copy video frame: ' + (options.emptyBlob ? 'Frame encoding failed'
      : options.tainted ? 'Video frame could not be loaded' : 'Permission denied'));
    if (options.tainted) assert.equal(clone.src, undefined);
    options.emptyBlob = options.tainted = options.loadError = options.denyClipboard = false;
    await context.copyVideoFrameToClipboard(video);
    assert.equal(messages.at(-1), 'Video frame copied to clipboard');
  }
});

test('copy shortcut selects fullscreen video, targeted media, then visible fallback', () => {
  const { context, video } = harness();
  const img = { tagName: 'IMG' }, copied = [];
  Object.assign(context, {
    isKeyboardTypingTarget: target => target?.tagName === 'INPUT',
    viewerImageFromEventTarget: target => target?.tagName === 'IMG' ? target : null,
    viewerVideoFromPointer: () => null, viewerImageFromPointer: () => null,
    getTargetVideo: () => video, pickBestVisibleEligibleImage: () => img,
    copyVideoFrameToClipboard: target => copied.push(target),
    copyImageToClipboard: target => copied.push(target),
  });
  const event = { target: {}, preventDefault() {}, stopImmediatePropagation() {} };
  context.document.fullscreenElement = video;
  context.handleMediaCopyKeydown({ ...event, target: img });
  assert.equal(copied.pop(), video, 'fullscreen video wins over images elsewhere on the page');
  context.document.fullscreenElement = null;
  context.handleMediaCopyKeydown({ ...event, target: img });
  assert.equal(copied.pop(), img, 'explicit image keeps existing copying behavior');
  context.handleMediaCopyKeydown({ ...event, target: video });
  assert.equal(copied.pop(), video);
  context.viewerImageFromPointer = () => img;
  context.handleMediaCopyKeydown(event);
  assert.equal(copied.pop(), img, 'hovered image wins over a background video');
  context.viewerImageFromPointer = () => null;
  context.handleMediaCopyKeydown(event);
  assert.equal(copied.pop(), video);
  context.getTargetVideo = () => null;
  context.handleMediaCopyKeydown(event);
  assert.equal(copied.pop(), img);
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true },
    { repeat: true }, { target: { tagName: 'INPUT' } }]) {
    context.handleMediaCopyKeydown({ ...event, ...extra });
  }
  context.overlay = {};
  context.handleMediaCopyKeydown(event);
  assert.equal(copied.length, 0, 'typing, modified keys, repeats, and gallery are not copied here');
});

test('temporary video event timeout removes listeners and rejects', async () => {
  const { context } = harness();
  let expire;
  context.setTimeout = callback => { expire = callback; return 1; };
  context.clearTimeout = () => {};
  const listeners = new Map();
  const video = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  const ready = context.waitForVideoFrameEvent(video, 'loadeddata', () => {});
  expire();
  await assert.rejects(ready, /timed out/);
  assert.equal(listeners.size, 0);
});
