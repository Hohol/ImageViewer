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
