const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSection } = require('../../../support/source.cjs');
const source = readSection('chatgpt/retries');
const block = source.slice(source.indexOf('        const visibleChatElement'), source.indexOf('        const latest ='));
test('controls select the visible chat after SPA navigation and ignore route label changes', () => {
  const element = (id, visible) => ({
    getBoundingClientRect: () => ({ width: visible ? 800 : 0, height: visible ? 100 : 0 }),
    getAttribute: () => id
  });
  const oldComposer = element('old', false), currentComposer = element('new', true);
  // Real composer wrappers use display:contents: only their child forms have boxes.
  for (const wrapper of [oldComposer, currentComposer]) {
    const form = { getBoundingClientRect: wrapper.getBoundingClientRect };
    wrapper.querySelector = () => form;
    wrapper.getBoundingClientRect = () => ({ width: 0, height: 0 });
  }
  const oldTimeline = element('old-timeline', false), currentTimeline = element('new-timeline', true);
  const context = vm.createContext({ location: { pathname: '/g/project-name/c/new' },
    document: { querySelectorAll: selector => selector.includes('timeline')
      ? [oldTimeline, currentTimeline] : [oldComposer, currentComposer] } });
  vm.runInContext(block, context);
  assert.equal(vm.runInContext('composer()', context), currentComposer);
  assert.equal(vm.runInContext('timeline()', context), currentTimeline);
  assert.equal(vm.runInContext('identity()', context), 'new');
  context.location.pathname = '/g/project/c/new';
  assert.equal(vm.runInContext('identity()', context), 'new');
  currentComposer.querySelector().getBoundingClientRect = () => ({ width: 0, height: 0 });
  assert.equal(vm.runInContext('composer()', context), undefined);
  assert.equal(vm.runInContext('identity()', context), 'new');
});
