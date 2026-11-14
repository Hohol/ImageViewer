const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSection } = require('../../../support/source.cjs');
const source = readSection('chatgpt/retries');
const block = source.slice(source.indexOf('        const sessionTime ='), source.indexOf('        function click(session'));
test('unloaded-target waits freeze timeout and preserve attempt status', async () => {
  let now = 0, mounted = false;
  const status = { textContent: 'Attempt 2/10 · Generating' };
  const session = { turnKey: 'target' };
  const context = vm.createContext({ Date: { now: () => now }, status, check() {}, updateGenerationTitle() {},
    editorSelector: 'textarea', latest: () => mounted ? { id: 'target', querySelector: () => ({}) } : null,
    key: t => t.id,
    setTimeout: fn => { now += 250; if (now >= 2000) mounted = true; fn(); } });
  vm.runInContext(block, context);
  let calls = 0;
  await context.waitFor(session, () => ++calls === 2, 500, 'timed out');
  assert.equal(session.pausedMs, 2000);
  assert.equal(status.textContent, 'Attempt 2/10 · Generating');
  assert.equal(calls, 2);
});
test('a replacement turn is accepted only at the tail and with the expected prompt', () => {
  let tail = false, text = 'd';
  const current = { id: 'replacement', querySelector: () => ({}) };
  const context = vm.createContext({ editorSelector: 'textarea', latest: () => current, key: t => t.id,
    prompt: () => text, timeline: () => ({}), latestPosition: () => ({ atLatest: tail }) });
  vm.runInContext(block, context);
  const session = { turnKey: 'original', prompt: 'd', allowTurnReplacement: true };
  assert.equal(context.targetMounted(session), false);
  tail = true;
  assert.equal(context.targetMounted(session), true);
  text = 'other';
  assert.equal(context.targetMounted(session), false);
  session.allowTurnReplacement = false; text = 'd';
  assert.equal(context.targetMounted(session), false);
});

test('an open editor counts as a mounted turn without its display bubble', () => {
  const current = { id: 'target', querySelector: selector => selector === 'textarea' ? {} : null };
  const context = vm.createContext({ editorSelector: 'textarea', latest: () => current, key: t => t.id });
  vm.runInContext(block, context);
  assert.equal(context.targetMounted({ turnKey: 'target' }), true);
});

test('queued draw waits for the conversation tail before capturing its target', () => {
  let current = { id: 'older', querySelector: () => ({}) };
  let atLatest = false;
  const context = vm.createContext({
    editorSelector: 'textarea', latest: () => current, key: turn => turn.id,
    timeline: () => ({}), latestPosition: () => ({ atLatest }),
  });
  vm.runInContext(block, context);
  const session = { autosend: true };
  assert.equal(context.targetMounted(session), false);
  assert.equal(session.turnKey, undefined);

  const target = { id: 'target', querySelector: () => ({}) };
  current = target;
  atLatest = true;
  assert.equal(context.targetMounted(session), true);
  assert.equal(session.turnKey, 'target');

  current = { id: 'older', querySelector: () => ({}) };
  assert.equal(context.targetMounted(session), false);
  current = target;
  atLatest = false;
  assert.equal(context.targetMounted(session), true);
});

test('submitted d after the previous tail does not require scrolling to the response bottom', async () => {
  const previous = { id: 'previous' };
  const current = { id: 'new', querySelector: () => ({}) };
  let turns = [previous, current];
  const status = { textContent: 'Attempt 0/10 · Generating' };
  const context = vm.createContext({ Date, status, check() {}, updateGenerationTitle() {},
    editorSelector: 'textarea', turnSelector: '[data-turn-key]',
    latest: () => current, key: t => t.id, prompt: () => 'd',
    timeline: () => ({ querySelectorAll: () => turns }),
    latestPosition: () => ({ atLatest: false }),
    setTimeout() { throw new Error('Loaded new message must not pause'); } });
  vm.runInContext(block, context);
  const session = { turnKey: 'previous', previousTurn: 'previous', prompt: 'd',
    manualPrompt: true, allowTurnReplacement: true };
  await context.waitFor(session, () => true, 15000, 'Submitted prompt did not appear');
  assert.equal(status.textContent, 'Attempt 0/10 · Generating');
  turns = [current, previous];
  assert.equal(context.targetMounted(session), false, 'older matching d cannot be adopted');
  turns = [current];
  assert.equal(context.targetMounted(session), false, 'unanchored history still needs the tail check');
  turns = [previous, current];
  session.allowTurnReplacement = false;
  assert.equal(context.targetMounted(session), false, 'locked sessions still require their target');
});
