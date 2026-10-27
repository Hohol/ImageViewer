const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const source = readFileSync(resolve(__dirname, '../../../../ImageViewer.js'), 'utf8');
const block = source.slice(source.indexOf('        let audioContext = null;'), source.indexOf('        function setRetryButtonActive'));
function harness() {
  let chat = 'one', turn = { id: 'a', response: 'r1', busy: false, state: 'complete', images: [] }, tones = 0;
  class AudioContext {
    state = 'running'; currentTime = 0; destination = {};
    createOscillator() { return { frequency: {}, connect() {}, start() { tones++; }, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }
  const context = vm.createContext({ window: { AudioContext }, destroyed: false, run: null,
    identity: () => chat, latest: () => turn, responseIds: t => t.response, key: t => t.id,
    busy: t => t.busy, state: t => t.state, images: t => t.images,
    document: { title: 'My chat', hidden: false, addEventListener() {}, body: {}, head: {} }, MutationObserver: class { observe() {} } });
  vm.runInContext(block, context);
  context.unlockSound({ isTrusted: true });
  return { context, check: () => context.checkGenerationSound(), turn, chat: value => { chat = value; }, tones: () => tones };
}
test('ChatGPT chimes once for a loaded successful generation without retries, never for historical images', () => {
  const h = harness();
  h.turn.images = [{ complete: true, naturalWidth: 100 }];
  h.check();
  assert.equal(h.tones(), 0);
  h.turn.busy = true; h.turn.state = 'in_progress'; h.check();
  h.turn.busy = false; h.turn.state = 'complete'; h.turn.images[0].complete = false; h.check();
  assert.equal(h.tones(), 0);
  h.turn.images[0].complete = true; h.check(); h.check();
  assert.equal(h.tones(), 2);
  h.turn.busy = true; h.check(); h.turn.busy = false; h.check();
  assert.equal(h.tones(), 2);
});
test('failed generations stay silent; a subsequent successful retry chimes', () => {
  const h = harness();
  h.turn.busy = true; h.check(); h.turn.busy = false; h.check();
  assert.equal(h.tones(), 0);
  h.turn.response = 'r2'; h.turn.busy = true; h.check();
  h.turn.busy = false; h.turn.images = [{ complete: true, naturalWidth: 100 }]; h.check();
  assert.equal(h.tones(), 2);
});
test('changing chats discards a pending sound', () => {
  const h = harness();
  h.turn.busy = true; h.check(); h.chat('two');
  h.turn.busy = false; h.turn.images = [{ complete: true, naturalWidth: 100 }]; h.check();
  assert.equal(h.tones(), 0);
});

test('completion ignores disappearing fallback markers and reordered duplicate response IDs', () => {
  const h = harness();
  h.turn.response = 'r2 r2|r1|fallback-turn-1';
  h.turn.busy = true; h.turn.state = 'in_progress'; h.check();
  h.turn.response = 'r1|r2';
  h.turn.busy = false; h.turn.state = 'complete';
  h.turn.images = [{ complete: false, naturalWidth: 0 }]; h.check();
  assert.equal(h.tones(), 0);
  h.turn.images[0] = { complete: true, naturalWidth: 1024 }; h.check(); h.check();
  assert.equal(h.tones(), 2);
});
test('a different completed response cannot consume a pending sound', () => {
  const h = harness();
  h.turn.busy = true; h.check();
  h.turn.response = 'different'; h.turn.busy = false;
  h.turn.images = [{ complete: true, naturalWidth: 1024 }]; h.check();
  assert.equal(h.tones(), 0);
});

test('tab title marks generation and unseen success, then clears on return', () => {
  const h = harness(), doc = h.context.document;
  h.turn.busy = true; h.check();
  assert.equal(doc.title, '⏳ My chat');
  doc.hidden = true;
  h.turn.busy = false; h.turn.images = [{ complete: true, naturalWidth: 100 }]; h.check();
  assert.equal(doc.title, '✅ My chat');
  h.check(); assert.equal(doc.title, '✅ My chat');
  doc.hidden = false; h.context.updateGenerationTitle();
  assert.equal(doc.title, 'My chat');
});
test('visible completion stays normal and title updates preserve ChatGPT renames', () => {
  const h = harness(), doc = h.context.document;
  h.turn.busy = true; h.check();
  doc.title = 'New chat name'; h.context.updateGenerationTitle();
  assert.equal(doc.title, '⏳ New chat name');
  h.turn.busy = false; h.turn.images = [{ complete: true, naturalWidth: 100 }]; h.check();
  assert.equal(doc.title, 'New chat name');
});
test('retry gaps retain generation indicator; stopping or changing chats clears it', () => {
  const h = harness(), doc = h.context.document;
  h.context.run = { autosend: false }; h.check();
  assert.equal(doc.title, '⏳ My chat');
  h.context.run = null; h.check(); assert.equal(doc.title, 'My chat');
  h.turn.busy = true; h.check(); doc.hidden = true;
  h.turn.busy = false; h.turn.images = [{ complete: true, naturalWidth: 100 }]; h.check();
  assert.equal(doc.title, '✅ My chat');
  h.chat('two'); h.check(); assert.equal(doc.title, 'My chat');
});

test('attempt limit shows a red cross until viewed, and a new generation clears it', () => {
  const h = harness(), doc = h.context.document;
  doc.hidden = true;
  h.context.run = { autosend: false };
  h.context.markGenerationFailure();
  h.context.run = null; h.check();
  assert.equal(doc.title, '❌ My chat');
  doc.hidden = false; h.context.updateGenerationTitle();
  assert.equal(doc.title, 'My chat');
  h.context.markGenerationFailure();
  assert.equal(doc.title, 'My chat');
  doc.hidden = true; h.context.markGenerationFailure();
  h.turn.busy = true; h.check();
  assert.equal(doc.title, '⏳ My chat');
});

test('error outcomes mark the tab failed, while cancellation does not', () => {
  const h = harness(), doc = h.context.document;
  Object.assign(h.context, { setRetryButtonActive() {}, button: {}, autosendButton: {}, status: {} });
  vm.runInContext(source.slice(source.indexOf('        function finish(message'),
    source.indexOf('        function check(session)')), h.context);
  doc.hidden = true;
  h.context.finish('Submitted prompt did not appear', true);
  assert.equal(doc.title, '❌ My chat');
  doc.hidden = false; h.context.updateGenerationTitle();
  doc.hidden = true;
  h.context.finish('Retries stopped');
  assert.equal(doc.title, 'My chat');
});
