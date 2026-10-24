const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { readSection } = require('../../support/source.cjs');

test('browser fullscreen toggles preserve the gallery and in-page closing avoids resync', async () => {
  const listeners = new Map();
  const gallery = {};
  let fullscreen = true, resyncs = 0, fail = false, release;
  const context = {
    overlay: gallery, galleryInPage: false, galleryFullscreenPending: false,
    ivIntentionalFullscreenExit: false, ivPendingVisualFullscreenExit: false,
    isFullscreenApiActive: () => fullscreen,
    ivLogFullscreenExit() {}, showViewerToast() {},
    clearOverlay() { context.overlay = null; context.galleryInPage = false; },
    resyncAfterContextMenu() { resyncs++; },
    armStuckVisualFullscreenExit() { throw new Error('intentional mode change must not arm resync'); },
    exitFullscreenWithWorkaround() { throw new Error('in-page close must not exit browser fullscreen'); },
    document: {
      addEventListener(type, fn) { listeners.set(type, fn); },
      async exitFullscreen() { fullscreen = false; listeners.get('fullscreenchange')(); },
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
  context.hideGallery();
  assert.equal(context.overlay, null);
  assert.equal(resyncs, 0);
});
