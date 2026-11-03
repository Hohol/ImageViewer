const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readSection } = require('../../../support/source.cjs');
const source = readSection('chatgpt/retries');
const block = source.slice(source.indexOf('        async function autosend(session)'), source.indexOf('        function isPromptSend'));

test('queued draw accepts an existing image without accessing the composer or sending d', async () => {
  const image = { complete: false, naturalWidth: 0 };
  let active = true, result;
  const turn = { querySelector: () => null };
  const session = {};
  const context = vm.createContext({
    latest: () => turn, state: () => 'complete', busy: () => active,
    images: () => [image], editorSelector: 'textarea', sessionTime: () => 100,
    finish: message => { result = message; }, run: session,
    composer() { throw new Error('Must not access the composer'); },
    async waitFor(current, predicate) {
      assert.equal(predicate(), false, 'wait for the answer to finish');
      active = false;
      assert.equal(predicate(), false, 'wait for the image to load');
      image.complete = true; image.naturalWidth = 1024;
      assert.equal(predicate(), true, 'accept the loaded generated image');
    }
  });
  vm.runInContext(block, context);
  await context.autosend(session);
  assert.equal(result, 'Image generated (0 retries)');
});
