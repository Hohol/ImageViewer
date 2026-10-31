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
  const context = vm.createContext({ Date: { now: () => now }, status, check() {},
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
