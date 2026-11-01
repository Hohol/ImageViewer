const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { readSection } = require('../../support/source.cjs');

function harness() {
  const listeners = new Map();
  const calls = [];
  const video = {
    tagName: 'VIDEO', controls: false, _originalControls: true,
    dataset: { originalStyle: 'width: 300px;', originalClass: 'player' },
    style: { cssText: 'width: 100vw;' }, className: '',
    _onMouseMove() {}, removeEventListener() { calls.push('remove video listener'); },
  };
  const context = {
    isFullscreenApiActive: () => !!context.document.fullscreenElement,
    ivLogVideoFullscreen(event) { calls.push(event); },
    resolveVideoForFullscreenToggle: target => target,
    requestVideoFullscreen() { calls.push('request fullscreen'); },
    stopCursorAutoHide() { calls.push('stop cursor hiding'); },
    scheduleAddFullscreenButtonsToVideos() { calls.push('refresh video buttons'); },
    handleViewerKeydown() {},
    document: {
      fullscreenElement: video,
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener() { calls.push('remove mouse listener'); },
      querySelectorAll() { return [video]; },
      getElementById() { return { remove() { calls.push('remove control style'); } }; },
      async exitFullscreen() {
        calls.push('native exit');
        context.document.fullscreenElement = null;
        listeners.get('fullscreenchange')();
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(readSection('shared/viewer/video-fullscreen'), context);
  return { context, calls, video, nativeExit: () => listeners.get('fullscreenchange')() };
}

test('video toggle exits once and restores controls, styles, and listeners', async () => {
  const { context, calls, video } = harness();
  context.toggleVideoFullscreen(video);
  await Promise.resolve();
  assert.equal(calls.filter(call => call === 'native exit').length, 1);
  assert.equal(calls.includes('request fullscreen'), false);
  assert.equal(context.document.fullscreenElement, null);
  assert.equal(video.controls, true);
  assert.equal(video.style.cssText, 'width: 300px;');
  assert.equal(video.className, 'player');
  assert.equal(video._onMouseMove, undefined);
  assert.equal(video.dataset.originalStyle, undefined);
  assert(calls.includes('remove video listener'));
  assert(calls.includes('remove mouse listener'));
  assert(calls.includes('remove control style'));
});

test('native video exit restores the player without requesting fullscreen', () => {
  const { context, calls, video, nativeExit } = harness();
  context.document.fullscreenElement = null;
  nativeExit();
  assert.equal(video.controls, true);
  assert.equal(video.style.cssText, 'width: 300px;');
  assert.equal(calls.includes('native exit'), false);
  assert.equal(calls.includes('request fullscreen'), false);
});

test('inactive API and failed video exits do not cause retries or re-entry', async () => {
  const { context, calls } = harness();
  context.document.fullscreenElement = null;
  await context.exitVideoFullscreen();
  assert.deepEqual(calls, []);
  context.document.fullscreenElement = {};
  for (const synchronous of [false, true]) {
    context.document.exitFullscreen = () => {
      calls.push('failed exit');
      if (synchronous) throw new Error('Denied');
      return Promise.reject(new Error('Denied'));
    };
    await context.exitVideoFullscreen();
  }
  assert.deepEqual(calls, ['failed exit', 'exit failed', 'failed exit', 'exit failed']);
});
