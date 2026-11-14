const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { scriptPath } = require('../../../support/source.cjs');
const source = readFileSync(scriptPath, 'utf8');
const start = source.indexOf('        imgs = collectNavigableImages();', source.indexOf('    function showGallery('));
const block = source.slice(start, source.indexOf('        // Cached ChatGPT images', start));
test('a selected loaded live image opens during automation even before it is indexed', () => {
  let toasts = 0;
  const image = { isConnected: true, complete: true, naturalWidth: 1024 };
  const context = vm.createContext({ img: image, imgs: [], collectNavigableImages: () => [],
    ivChatGPTGallery: { cacheOnly: true }, showViewerToast: () => { toasts++; } });
  vm.runInContext(`function select() { ${block} } select();`, context);
  assert.equal(context.imgs[0], image);
  assert.equal(toasts, 0);
  image.isConnected = false;
  vm.runInContext('select();', context);
  assert.equal(context.imgs.length, 0);
  assert.equal(toasts, 1);
});

test('gallery hotkey opens a visible loaded image when the gallery index is empty', () => {
  const { readSection } = require('../../../support/source.cjs');
  const rect = { left: 10, top: 10, right: 310, bottom: 310, width: 300, height: 300 };
  const image = { isConnected: true, complete: true, naturalWidth: 1024, src: 'blob:visible',
    getBoundingClientRect: () => rect };
  const hidden = { ...image, src: 'blob:hidden', getBoundingClientRect: () => ({ ...rect, width: 0, height: 0 }) };
  const unloaded = { ...image, src: 'blob:loading', complete: false, naturalWidth: 0 };
  const context = vm.createContext({
    window: { innerWidth: 1000, innerHeight: 800 }, overlay: null,
    document: { querySelectorAll: () => [image, hidden, unloaded] },
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    isExcludedImage: () => false,
    ivChatGPTGallery: { cacheOnly: true, images: () => [], nearestImage: () => null },
    showViewerToast() { throw new Error('Visible image must open without an empty-gallery error'); }
  });
  vm.runInContext(readSection('shared/viewer/hotkey-image') + readSection('shared/viewer/image-collection'), context);
  vm.runInContext(`let imgs; const img = pickGalleryHotkeyImage(); function open() { ${block} } open();`, context);
  assert.equal(vm.runInContext('imgs.length', context), 1);
  assert.equal(vm.runInContext('imgs[0]', context), image);
});
