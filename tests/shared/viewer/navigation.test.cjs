const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { readSection } = require('../../support/source.cjs');

test('viewer navigation cancels stale searches and deduplicates repeated keys', async () => {
  const image = key => ({ key, src: 'blob:' + key });
  let cached = [image('middle')], displayed, resolveSearch, calls = 0;
  const context = {
    overlay: {}, imgs: [...cached], currentIndex: 0, imageNavigationSearch: null,
    showViewerToast: () => {}, ivChatGPTNavigationDebug: null,
    ivChatGPTGallery: {
      key: img => img?.key, images: () => cached, cancelNavigation: () => {},
      findNext: () => {
        calls++;
        return new Promise(resolve => { resolveSearch = resolve; });
      },
    },
    saveOverlayNativeScrollForCurrent: () => {},
    displayImageInOverlay: img => { displayed = img; },
  };
  vm.createContext(context);
  vm.runInContext(readSection('shared/viewer/navigation'), context);

  let pending = context.navigate(-1);
  await context.navigate(-1);
  assert.equal(calls, 1, 'repeat key must not create multiple searches');
  cached = [image('older'), ...cached];
  resolveSearch({ list: cached, index: 0 });
  await pending;
  assert.equal(displayed.key, 'older');
  assert.equal(context.currentIndex, 0);
  await context.navigate(1);
  assert.equal(displayed.key, 'middle');

  pending = context.navigate(1);
  await context.navigate(-1);
  resolveSearch({ list: [...cached, image('newer')], index: 2 });
  await pending;
  assert.equal(displayed.key, 'older', 'opposite navigation must discard a late result');

  pending = context.navigate(-1);
  context.cancelImageNavigationSearch();
  context.overlay = null;
  resolveSearch({ list: [image('oldest'), ...cached], index: 0 });
  await pending;
  assert.equal(displayed.key, 'older', 'closing overlay must discard a late result');
  context.ivChatGPTGallery = null;
  await context.navigate(1);
  assert.equal(displayed.key, 'middle', 'other hosts retain existing navigation');
});
