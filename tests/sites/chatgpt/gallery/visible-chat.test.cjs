const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSection } = require('../../../support/source.cjs');
const source = readSection('chatgpt/gallery');
const block = source.slice(source.indexOf('        const timeline ='), source.indexOf('        const log ='));
test('gallery reads the visible timeline and its conversation after chat navigation', () => {
  const root = (id, visible) => ({
    getBoundingClientRect: () => ({ width: visible ? 800 : 0, height: visible ? 600 : 0 }),
    querySelector: () => ({ getAttribute: () => id })
  });
  const hidden = root('old', false), current = root('new', true);
  const context = vm.createContext({ timelineSelector: '[data-app-action-timeline-scroll]',
    document: { querySelectorAll: () => [hidden, current] }, location: { pathname: '/c/new' } });
  vm.runInContext(block, context);
  assert.equal(vm.runInContext('timeline()', context), current);
  assert.equal(vm.runInContext('conversationId()', context), 'new');
});

test('a local chat can identify its gallery through the visible composer outside the timeline', () => {
  const root = {
    getBoundingClientRect: () => ({ width: 800, height: 600 }),
    querySelector: () => null,
  };
  const composer = (id, width) => ({
    getAttribute: () => id,
    querySelector: () => ({ getBoundingClientRect: () => ({ width, height: 60 }) }),
  });
  const context = vm.createContext({
    timelineSelector: '[data-app-action-timeline-scroll]',
    document: { querySelectorAll: selector => selector === '[data-app-action-timeline-scroll]'
      ? [root] : [composer('outgoing', 0), composer('local-chatgpt:current', 800)] },
    location: { pathname: '/' },
  });
  vm.runInContext(block, context);
  assert.equal(vm.runInContext('conversationId()', context), 'local-chatgpt:current');
});

test('a saved URL keeps the same local chat cache, but a different saved chat blocks its outgoing DOM', () => {
  let id = 'local-chatgpt:current';
  const resets = [];
  const context = vm.createContext({
    location: { pathname: '/' }, conversationPath: '/', conversation: id,
    pageHidden: false, departedConversation: null, conversationId: () => id,
    reset: reason => resets.push(reason),
  });
  vm.runInContext(source.slice(source.indexOf('        function syncConversation()'),
    source.indexOf('        function mergeTurns(')), context);
  context.location.pathname = '/c/saved';
  assert.equal(context.syncConversation(), id);
  assert.deepEqual(resets, []);
  context.location.pathname = '/c/other';
  assert.equal(context.syncConversation(), null);
  assert.deepEqual(resets, ['page-navigation']);
  id = 'other';
  assert.equal(context.syncConversation(), 'other');
});
