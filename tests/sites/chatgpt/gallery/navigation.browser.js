(async () => {
  imageEvery = 4;
  let controlsActive = false;
  const gallery = await createGallery(() => controlsActive);
  const key = img => JSON.parse(gallery.key(img))[0];
  const search = (img, direction) => gallery.findNext(img, direction, () => true);
  setup({ count: 17, lazy: 1800 });
  await sleep(220);
  let selected = gallery.images().at(-1);
  check(key(selected) === 'turn-16', 'starts with only the newest image cached');
  controlsActive = true;
  const scrollBefore = root.scrollTop;
  check(gallery.images().length > 0, 'active drawing controls still allow cached images');
  check(await search(selected, -1) === null, 'active controls block uncached navigation');
  await gallery.scan();
  check(root.scrollTop === scrollBefore, 'active controls prevent gallery scrolling and scans');
  controlsActive = false;
  for (const expected of [12, 8, 4, 0]) {
    const found = await search(selected, -1);
    check(found && key(found.list[found.index]) === 'turn-' + expected, 'backward search crosses text to turn ' + expected);
    selected = found.list[found.index];
    await selected.decode();
  }
  check(await search(selected, -1) === null, 'backward search stops at real chat start');
  const beforeEnd = events.length;
  await search(selected, -1);
  check(events.length === beforeEnd, 'confirmed boundary is silent');

  // Fresh chat: only the oldest image is known; later turns are not mounted.
  setup({ id: 'forward', count: 17, start: 4800, lazy: 2200 });
  await sleep(230);
  selected = gallery.images()[0];
  check(key(selected) === 'turn-0', 'starts at oldest image');
  for (const expected of [4, 8, 12, 16]) {
    const found = await search(selected, 1);
    check(found && key(found.list[found.index]) === 'turn-' + expected, 'forward search crosses text to turn ' + expected);
    selected = found.list[found.index];
  }
  check(await search(selected, 1) === null, 'forward search stops at real chat end');

  setup({ id: 'pagination', count: 13, initial: 4, history: true, start: 2400, lazy: 2400 });
  await sleep(250);
  selected = gallery.images()[0];
  const paged = await search(selected, -1);
  check(paged && key(paged.list[paged.index]) === 'turn-0', 'navigation loads older history and its delayed image');

  setup({ id: 'normal', direction: 'column', count: 17, start: 4800 });
  await sleep(200);
  selected = gallery.images()[0];
  const normal = await search(selected, 1);
  check(normal && key(normal.list[normal.index]) === 'turn-4', 'works in ordinary scroll containers too');

  setup({ id: 'cancel', count: 17, lazy: 6000 });
  await sleep(400);
  selected = gallery.images().at(-1);
  const pending = search(selected, -1);
  await sleep(25);
  gallery.cancelNavigation();
  check(await pending === null, 'closing or changing direction cancels pending search');
  const stopped = distance();
  await sleep(180);
  check(distance() === stopped, 'cancelled search no longer scrolls');

  setup({ id: 'switch', count: 17, lazy: 3000 });
  await sleep(240);
  selected = gallery.images().at(-1);
  const old = search(selected, -1);
  await sleep(25);
  setup({ id: 'other-chat', count: 5 });
  check(await old === null, 'chat switch cannot return an old result');
  await sleep(200);
  check(gallery.images().length <= 2, 'new chat owns a separate cache');
})().then(() => finish()).catch(finish);
