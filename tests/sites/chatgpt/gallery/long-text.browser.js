(async () => {
  definitions = [
    { height: 600, image: true }, { height: 7000 }, { height: 7000 },
    { height: 600, image: true }, { height: 7000 }, { height: 600, image: true },
  ];
  root.style.height = '600px';
  const gallery = await createGallery();
  setup({ count: definitions.length, lazy: 3200 });
  await gallery.scan();
  const list = gallery.images();
  check(list.length === 3, 'scan preserves three images separated by 21,000 pixels of text');
  check(list.map(img => JSON.parse(gallery.key(img))[0]).join(',') === 'turn-0,turn-3,turn-5',
    'scan keeps sparse images in chronological order');
  await Promise.all(list.map(img => img.decode()));
  check(events.some(event => event.event === 'scan-text-skip' && event.pixels > 5000),
    'scan jumps across inspected text without viewport-sized stepping');

  setup({ id: 'long-forward', count: definitions.length, start: turnTop(total) - root.clientHeight, lazy: 3200 });
  await sleep(250);
  let selected = gallery.images()[0];
  moves = 0;
  let found = await gallery.findNext(selected, 1, () => true);
  check(found && JSON.parse(gallery.key(found.list[found.index]))[0] === 'turn-3',
    'forward navigation crosses 14,000 pixels of text to the next image');
  check(moves < 10, 'forward navigation skips long text in fewer than ten scroll steps');

  setup({ id: 'long-backward', count: definitions.length, lazy: 3200 });
  await sleep(250);
  selected = gallery.images().at(-1);
  moves = 0;
  found = await gallery.findNext(selected, -1, () => true);
  check(found && JSON.parse(gallery.key(found.list[found.index]))[0] === 'turn-3',
    'backward navigation crosses 7,000 pixels of text to the previous image');
  check(moves < 10, 'backward navigation skips long text in fewer than ten scroll steps');
})().then(() => finish()).catch(finish);
