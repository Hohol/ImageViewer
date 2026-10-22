const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSection } = require('../../support/source.cjs');

function setup() {
  const listeners = {}, frames = new Map(), moves = [], nodes = [];
  let frame = 0, toggles = 0, folderVisits = 0;
  const element = () => {
    const el = { style: {}, children: [], scrollTop: 0, scrollHeight: 2000, clientHeight: 500,
      append(...children) { this.children.push(...children); }, setAttribute() {},
      addEventListener() {}, focus() {}, remove() { this.removed = true; } };
    nodes.push(el);
    return el;
  };
  const document = { createElement: element, createTextNode: text => text,
    addEventListener: (name, fn) => { listeners[name] = fn; }, fullscreenElement: null,
    exitFullscreen: async () => { document.fullscreenElement = null; } };
  const viewer = element();
  viewer.requestFullscreen = async () => { document.fullscreenElement = viewer; };
  const stage = element();
  const context = vm.createContext({ document, viewer, stage, console, nativeSize: true,
    images: [0, 1, 2], index: 1, folder: 'file:///test/',
    location: { assign: () => folderVisits++ },
    window: { addEventListener: (name, fn) => { listeners[name] = fn; } },
    navigate: delta => moves.push(delta), toggleSize: () => toggles++,
    requestAnimationFrame: fn => { frames.set(++frame, fn); return frame; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  vm.runInContext(readSection('shared/viewer/local-hotkeys'), context);
  const event = (code, overrides = {}) => ({ code, key: code, preventDefault() { this.consumed = true; },
    stopImmediatePropagation() {}, ...overrides });
  const down = (code, extra) => { const e = event(code, extra); context.viewerKeydownHandler(e); return e; };
  const up = (code, extra) => listeners.keyup(event(code, extra));
  const tick = now => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(now)); };
  return { down, up, moves, nodes, context, listeners, document, frames, stage, tick,
    toggles: () => toggles, folderVisits: () => folderVisits };
}

test('local navigation aliases, random excludes current, and C/T are unbound', () => {
  const s = setup();
  for (const code of ['ArrowLeft', 'ArrowRight', 'Space', 'KeyR']) assert.equal(s.down(code).consumed, true);
  assert.deepEqual(s.moves.slice(0, 3), [-1, 1, 1]);
  assert.ok([-1, 1].includes(s.moves[3]));
  for (const code of ['KeyC', 'KeyT']) assert.equal(s.down(code).consumed, undefined);
  s.down('Period'); s.down('Period', { repeat: true });
  assert.equal(s.toggles(), 1);
});

test('standalone modifier navigates only on release and combos or blur cancel it', () => {
  const s = setup();
  s.down('MetaLeft', { key: 'Meta', metaKey: true });
  assert.equal(s.moves.length, 0);
  s.up('MetaLeft', { key: 'Meta' });
  assert.deepEqual(s.moves, [-1]);
  s.down('MetaLeft', { key: 'Meta', metaKey: true });
  s.down('KeyC', { metaKey: true }); s.up('MetaLeft', { key: 'Meta' });
  s.down('AltLeft', { key: 'Alt', altKey: true }); s.listeners.blur(); s.up('AltLeft', { key: 'Alt' });
  assert.deepEqual(s.moves, [-1]);
});

test('help consumes its dismissal key and repeats until release', () => {
  const s = setup(); s.down('KeyH');
  const help = s.nodes.find(el => el.id === 'iv-local-help');
  assert.ok(help);
  s.down('ArrowRight'); s.down('ArrowRight', { repeat: true });
  assert.equal(help.removed, true); assert.deepEqual(s.moves, []);
  s.up('ArrowRight'); s.down('ArrowRight'); assert.deepEqual(s.moves, [1]);
});

test('native scrolling stops on release and blur', () => {
  const s = setup(); s.down('ArrowDown'); s.tick(100); s.tick(150);
  assert.equal(s.stage.scrollTop, 36);
  s.up('ArrowDown'); assert.equal(s.frames.size, 0);
  s.down('ArrowUp'); s.listeners.blur(); assert.equal(s.frames.size, 0);
});

test('fullscreen aliases and Escape preserve the viewer until fullscreen exits', async () => {
  const s = setup();
  s.down('KeyF'); await new Promise(resolve => setImmediate(resolve)); assert.ok(s.document.fullscreenElement);
  s.down('Escape'); await new Promise(resolve => setImmediate(resolve)); assert.equal(s.document.fullscreenElement, null);
  assert.equal(s.folderVisits(), 0);
  s.down('KeyB'); await new Promise(resolve => setImmediate(resolve)); assert.ok(s.document.fullscreenElement);
  s.down('Slash'); await new Promise(resolve => setImmediate(resolve)); assert.equal(s.document.fullscreenElement, null);
  s.down('Escape'); assert.equal(s.folderVisits(), 1);
});
