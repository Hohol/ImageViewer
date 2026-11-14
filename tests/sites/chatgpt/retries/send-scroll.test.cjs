const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSection } = require('../../../support/source.cjs');

const source = readSection('chatgpt/retries');
const block = source.slice(source.indexOf('        let cancelSendScrollRecovery'),
  source.indexOf('        function manualSubmission'));

function setup() {
  let frame, clicks = 0, turn = 'old';
  const listeners = new Map();
  const root = {
    scrollTop: 4314, scrollHeight: 8012, clientHeight: 686,
    querySelector: () => ({ click: () => clicks++ }),
  };
  const context = vm.createContext({
    timeline: () => root, identity: () => 'chat', latest: () => turn, key: value => value,
    distanceFromLatest: el => el.scrollHeight - el.clientHeight - el.scrollTop,
    composer: () => ({ querySelector: () => ({}) }), stopSelector: 'button', enabled: Boolean,
    performance: { now: () => 0 }, getComputedStyle: () => ({ flexDirection: 'column' }),
    ivChatGPTGallery: null,
    requestAnimationFrame: fn => { frame = fn; }, cancelAnimationFrame: () => { frame = null; },
    document: {
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: type => listeners.delete(type),
    },
  });
  vm.runInContext(block, context);
  context.recoverSendScroll();
  return {
    step: now => frame?.(now), clicks: () => clicks,
    wheel: () => listeners.get('wheel')?.({ type: 'wheel', isTrusted: true }),
    shrink() {
      turn = 'new';
      root.scrollHeight = 4820;
      root.scrollTop = 4134;
    },
    jump() { root.scrollTop = 3600; },
  };
}

test('send scroll recovery uses the native bottom button once after the recorded jump', () => {
  const chat = setup();
  chat.shrink();
  chat.step(113);
  chat.jump();
  chat.step(208);
  assert.equal(chat.clicks(), 0);
  chat.step(420);
  chat.step(680);
  assert.equal(chat.clicks(), 1);
});

test('clamping after resize and manual scrolling do not trigger recovery', () => {
  const chat = setup();
  chat.shrink();
  chat.step(113);
  chat.step(420);
  assert.equal(chat.clicks(), 0);
  chat.jump();
  chat.step(450);
  chat.wheel();
  chat.step(700);
  assert.equal(chat.clicks(), 0);
});
