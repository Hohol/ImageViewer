const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const { readSection } = require('../../support/source.cjs');

const context = vm.createContext({ URL, Intl });
vm.runInContext(readSection('shared/viewer/local-images'), context);
const folder = 'file:///Users/example/Pictures/';
const collect = hrefs => Array.from(context.collectLocalImages(
  hrefs.map(href => ({ getAttribute: () => href })), folder));

test('local image index is alphabetical, flat, and deduplicated', () => {
  const images = collect([
    'z.jpg', 'a2.png', 'a10.png', 'A.jpg', 'a.jpg', 'a.jpg',
    '../outside.jpg', 'nested/inside.jpg', 'folder.jpg/', 'notes.txt',
    'https://example.com/image.jpg', '?q=image.png', 'a.jpg#fragment',
  ]);
  assert.deepEqual(images.map(image => image.name), ['A.jpg', 'a.jpg', 'a10.png', 'a2.png', 'z.jpg']);
});

test('local filenames preserve spaces, Unicode, percent and hash characters', () => {
  const names = ['a #1%.PNG', 'кот.webp', 'a&b.jpeg'];
  const images = collect(names.map(encodeURIComponent));
  assert.deepEqual(images.map(image => image.name).sort(), names.sort());
  for (const image of images) assert.equal(image.url, folder + encodeURIComponent(image.name));
  assert.equal(context.localImageName('file:///bad%ZZ.png'), '');
});
