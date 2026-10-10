(async () => {
  imageEvery = 4;
  const gallery = await createGallery();
  const key = img => JSON.parse(gallery.key(img))[0];
  const search = (img, direction) => gallery.findNext(img, direction, () => true);
  const starts = () => events.filter(event => event.event === 'scan-navigation-start').length;
  const toasts = () => events.filter(event => event.event === 'toast');
  setup({ count: 17, start: 2400, lazy: 1800 });
  await gallery.scan();
  const list = gallery.images();
  check(list.length === 5, 'full scan collects all five sparse images');
  check(Math.abs(distance() - (root.scrollHeight - root.clientHeight)) < 3, 'full scan leaves chat at its beginning');
  let before = events.length, position = distance();
  await search(list[0], -1);
  await search(list.at(-1), 1);
  check(events.length === before && distance() === position,
    'both confirmed ends skip searching, scrolling, and toasts after a full scan');
  setDistance(0);
  render();
  await sleep(200);
  before = events.length;
  await search(list.at(-1), 1);
  check(events.length === before, 'known-turn remounts preserve the silent boundary');

  setup({ id: 'unknown', count: 17, lazy: 1800 });
  await sleep(220);
  let selected = gallery.images().at(-1);
  before = toasts().length;
  const unknownEnd = search(selected, 1);
  check(toasts().length === before + 1 && toasts().at(-1).message.startsWith('Looking for later'),
    'unknown boundary announces loading synchronously before waiting');
  await unknownEnd;
  before = starts();
  position = distance();
  await search(selected, 1);
  check(starts() === before && position === distance(), 'repeat navigation uses the newly confirmed end');
  const found = await search(selected, -1);
  check(found && key(found.list[found.index]) === 'turn-12', 'unknown direction still loads earlier chunks');

  // Reverse direction while the previous search is still awaiting a timer.
  setup({ id: 'reverse-toast', count: 17, start: 2400, lazy: 1800 });
  await sleep(220);
  let token = 1;
  const middle = gallery.images()[0];
  const older = gallery.findNext(middle, -1, () => token === 1);
  check(toasts().at(-1).message.startsWith('Looking for earlier'), 'earlier loading toast appears immediately');
  token = 2;
  const newer = gallery.findNext(middle, 1, () => token === 2);
  check(toasts().at(-1).message.startsWith('Looking for later'),
    'direction reversal updates toast before previous search cleanup finishes');
  await Promise.all([older, newer]);

  setup({ id: 'unknown', count: 17, lazy: 1800 });
  await sleep(220);
  selected = gallery.images().at(-1);
  await search(selected, 1);
  // A new turn extends the same conversation after the end was confirmed.
  setup({ id: 'unknown', count: 21, lazy: 3000 });
  await sleep(30);
  before = starts();
  const added = await search(selected, 1);
  check(starts() > before && added && key(added.list[added.index]) === 'turn-20',
    'new turns invalidate the end and allow newly generated images');

  selected = added.list[added.index];
  await search(selected, 1);
  const last = content.querySelector('[data-index="20"]');
  const extra = document.createElement('img');
  extra.src = selected.src;
  last.append(extra);
  await extra.decode();
  before = starts();
  const extraFound = await search(selected, 1);
  check(starts() > before && extraFound && gallery.key(extraFound.list[extraFound.index]) !== gallery.key(selected),
    'a new image in an existing turn invalidates the end');

  setup({ id: 'broken', count: 5, bad: 0 });
  await sleep(220);
  selected = gallery.images().at(-1);
  await search(selected, -1);
  before = starts();
  await search(selected, -1);
  check(starts() > before, 'incomplete loads do not permanently mark a gallery boundary');
  check(toasts().some(event => event.message.includes('incomplete')), 'incomplete searches still provide retry feedback');
})().then(() => finish()).catch(finish);
