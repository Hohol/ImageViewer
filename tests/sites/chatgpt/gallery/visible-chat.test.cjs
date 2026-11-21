const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSection } = require('../../../support/source.cjs');
const source = readSection('chatgpt/gallery');
const routeHelper = source.slice(source.indexOf('        function galleryRouteId('),
  source.indexOf('        const firstImageMarker'));
const block = routeHelper + source.slice(source.indexOf('        const timeline ='), source.indexOf('        const log ='));
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
  const trace = [];
  let root = { querySelectorAll: () => [] };
  const context = vm.createContext({
    location: { pathname: '/' }, conversationPath: '/', conversation: id,
    pageHidden: false, departedConversation: null, conversationId: () => id,
    reset: reason => resets.push(reason),
    timeline: () => root, turnSelector: '[data-turn-key]', traceGalleryCache: true,
    galleryCacheTraceKey: 'cache', traceCache: (event, detail) => trace.push(detail),
  });
  vm.runInContext(routeHelper + source.slice(source.indexOf('        let previousRouteTrace;'),
    source.indexOf('        function mergeTurns(')), context);
  context.syncConversation();
  context.location.pathname = '/c/saved';
  assert.equal(context.syncConversation(), id);
  assert.deepEqual(resets, []);
  context.location.pathname = '/c/other';
  assert.equal(context.syncConversation(), null);
  assert.deepEqual(resets, ['page-navigation']);
  assert.equal(trace.at(-1).previousPath, '/c/saved');
  assert.equal(trace.at(-1).timelineReused, true);
  assert.equal(trace.at(-1).blocked, true);
  context.syncConversation();
  assert.equal(trace.length, 3, 'a stuck guard logs once and preserves the transition');
  id = 'other';
  root = { querySelectorAll: () => [] };
  assert.equal(context.syncConversation(), 'other');
  assert.equal(trace.at(-1).timelineReused, false);
  assert.equal(trace.at(-1).blocked, false);
});

test('an encoded local route becomes a permanent route without blocking or clearing the cache', () => {
  let id = null;
  const resets = [];
  const context = vm.createContext({
    location: { pathname: '/g/project/c/local-chatgpt%3Acurrent' },
    conversationPath: '/g/project/project', conversation: null,
    pageHidden: false, departedConversation: null,
    conversationId: () => id || context.galleryRouteId(context.location.pathname),
    reset: reason => resets.push(reason),
  });
  vm.runInContext(routeHelper + source.slice(source.indexOf('        function syncConversation('),
    source.indexOf('        function mergeTurns(')), context);
  assert.equal(context.syncConversation(), 'local-chatgpt:current');
  id = 'local-chatgpt:current';
  assert.equal(context.syncConversation(), id);
  resets.length = 0;
  context.location.pathname = '/g/project/c/saved';
  assert.equal(context.syncConversation(), id);
  assert.equal(context.departedConversation, null);
  assert.deepEqual(resets, []);
  assert.equal(context.syncConversation(), id, 'subsequent captures remain enabled');
  context.location.pathname = '/g/project/c/different';
  assert.equal(context.syncConversation(), null, 'a later saved-chat switch still blocks the old DOM');
  assert.deepEqual(resets, ['page-navigation']);
});
