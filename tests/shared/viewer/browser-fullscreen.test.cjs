const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { readSection } = require('../../support/source.cjs');

test('browser fullscreen toggles preserve the gallery and in-page closing makes no exit request', async () => {
  const listeners = new Map();
  const gallery = {};
  let fullscreen = true, exitCalls = 0, fail = false, release;
  const context = {
    overlay: gallery, galleryInPage: false, galleryFullscreenPending: false,
    isFullscreenApiActive: () => fullscreen,
    showViewerToast() {},
    clearOverlay() { context.overlay = null; context.galleryInPage = false; },
    document: {
      addEventListener(type, fn) { listeners.set(type, fn); },
      async exitFullscreen() { exitCalls++; fullscreen = false; listeners.get('fullscreenchange')(); },
      documentElement: {
        async requestFullscreen() {
          if (fail) throw new Error('Denied');
          if (release) await new Promise(resolve => { release = resolve; });
          fullscreen = true;
          listeners.get('fullscreenchange')();
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(readSection('shared/viewer/browser-fullscreen'), context);
  await context.toggleGalleryBrowserFullscreen();
  assert.equal(fullscreen, false);
  assert.equal(context.galleryInPage, true);
  assert.equal(context.overlay, gallery);
  await context.toggleGalleryBrowserFullscreen();
  assert.equal(fullscreen, true);
  assert.equal(context.overlay, gallery);
  await context.toggleGalleryBrowserFullscreen();
  fail = true;
  await context.toggleGalleryBrowserFullscreen();
  assert.equal(context.galleryInPage, true, 'failed entry preserves in-page mode');
  assert.equal(context.overlay, gallery);
  fail = false;
  release = true;
  const entering = context.toggleGalleryBrowserFullscreen();
  await context.toggleGalleryBrowserFullscreen();
  assert.equal(context.galleryFullscreenPending, true, 'repeated presses cannot overlap a pending transition');
  release();
  await entering;
  await context.toggleGalleryBrowserFullscreen();
  const beforeClose = exitCalls;
  context.hideGallery();
  assert.equal(context.overlay, null);
  assert.equal(exitCalls, beforeClose);
});

function closeHarness() {
  const listeners = new Map();
  const calls = [];
  const context = {
    overlay: {}, galleryInPage: false, galleryFullscreenPending: false,
    isFullscreenApiActive: () => !!context.document.fullscreenElement,
    // The captured Chrome trace reports this as true even before entry.
    window: { matchMedia: () => ({ matches: true }) },
    showViewerToast() {},
    clearOverlay() { context.overlay = null; context.galleryInPage = false; },
    document: {
      fullscreenElement: { tagName: 'HTML' },
      addEventListener(type, fn) { listeners.set(type, fn); },
      documentElement: { requestFullscreen() { calls.push('enter'); } },
      exitFullscreen() {
        calls.push('exit');
        return new Promise(resolve => {
          context.completeExit = () => {
            context.document.fullscreenElement = null;
            resolve();
          };
        });
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(readSection('shared/viewer/browser-fullscreen'), context);
  return { context, calls, change: () => listeners.get('fullscreenchange')() };
}

test('closing after Copy image makes one native exit despite stale fullscreen indicators', async () => {
  const { context, calls, change } = closeHarness();
  const closed = context.hideGallery();
  assert.deepEqual(calls, ['exit']);
  assert(context.overlay, 'exit is still pending');
  context.completeExit();
  await closed;
  change(); // Chrome dispatches fullscreenchange after the exit promise resolves.
  assert.equal(context.overlay, null);
  assert.deepEqual(calls, ['exit'], 'no re-entry or speculative exit retries');
});

test('native Escape after a context menu closes the gallery without re-entry', () => {
  const { context, calls, change } = closeHarness();
  context.document.fullscreenElement = null;
  change();
  assert.equal(context.overlay, null);
  assert.deepEqual(calls, []);
});

test('closing with the fullscreen API already inactive does not attempt recovery', () => {
  const { context, calls } = closeHarness();
  context.document.fullscreenElement = null;
  context.hideGallery();
  assert.equal(context.overlay, null);
  assert.deepEqual(calls, []);
});

test('failed native exits still close the gallery and do not start recovery', async () => {
  for (const synchronous of [false, true]) {
    const { context } = closeHarness();
    context.document.exitFullscreen = () => {
      const error = new Error('Exit failed');
      if (synchronous) throw error;
      return Promise.reject(error);
    };
    await context.hideGallery();
    assert.equal(context.overlay, null);
  }
});
