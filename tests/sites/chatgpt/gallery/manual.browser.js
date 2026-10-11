(async () => {
  const gallery = await createGallery();
  setup({ id: 'manual-chat', count: 12, lazy: 800 });
  // Visit disjoint windows in both directions without a scan.
  const visited = [0, 3300, 1500, 2700, 900, 2100, 300];
  for (const position of visited) {
    setDistance(position);
    render();
    await sleep(130);
  }
  let list = gallery.images();
  const expected = Array.from({ length: 12 }, (_, i) => 'turn-' + i).join(',');
  check(list.length === 12, 'manual scroll collects all twelve loaded images without a scan');
  check(list.map(img => JSON.parse(gallery.key(img))[0]).join(',') === expected,
    'disjoint jumps up, down, and into the middle preserve chat order');
  check(!document.querySelector('#iv-chatgpt-scan'), 'manual collection does not show a scan panel');
  check(Math.abs(distance() - 300) < 3, 'manual collection does not move the reader’s scroll position');
  const cachedURLs = list.map(img => img.src);
  check(list.every(img => !siteURLs.includes(img.src)), 'manual collection owns its cached URLs');
  clearTurns();
  await sleep(80);
  await Promise.all(list.map(img => img.decode()));
  check(gallery.images().length === 12, 'cached images survive removal and source URL revocation');
  check(JSON.parse(gallery.key(gallery.nearestImage()))[0] === 'turn-10',
    'nearest image uses cached positions when source images are unmounted');
  render();
  await sleep(130);
  check(gallery.images().length === 12, 'remounting with new blob URLs does not duplicate manual captures');
  await gallery.scan();
  check(gallery.images().length === 12, 'a full scan reuses and merges the manual cache');

  total = 14;
  content.style.height = total * 300 + 'px';
  setDistance(0);
  render();
  await sleep(150);
  check(gallery.images().length === 14, 'manual collection continues after a full scan');

  // Switch conversations while image capture is waiting on a fetch.
  const savedFetch = window.fetch;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  window.fetch = async (...args) => {
    const response = await savedFetch(...args);
    if (String(args[0]).startsWith('blob:')) await gate;
    return response;
  };
  setup({ id: 'pending-old-chat', count: 3, lazy: 0 });
  await sleep(80);
  setup({ id: 'new-chat', count: 2, lazy: 0 });
  release();
  window.fetch = savedFetch;
  await sleep(180);
  check(gallery.images().length === 2, 'a chat switch discards in-flight captures from the previous conversation');
  const old = await Promise.allSettled(cachedURLs.map(url => nativeFetch(url)));
  check(old.every(result => result.status === 'rejected'), 'chat switches release the previous manual cache');

  // Already-decoded insertions must be caught by the observer, without load.
  clearTurns();
  await sleep(80);
  const detached = document.createElement('img');
  const canvas = document.createElement('canvas');
  canvas.width = 10;
  canvas.height = 10;
  const blob = await new Promise(resolve => canvas.toBlob(resolve));
  detached.src = URL.createObjectURL(blob);
  await detached.decode();
  const turn = document.createElement('div');
  turn.dataset.turnKey = 'preloaded';
  turn.style.top = '0';
  turn.append(detached);
  content.append(turn);
  await sleep(100);
  check(gallery.images().length === 3, 'already-loaded DOM insertions are cached without waiting for a new load event');

  setup({ id: 'normal-manual', direction: 'column', count: 12, lazy: 800 });
  for (const position of visited) {
    setDistance(position);
    render();
    await sleep(130);
  }
  list = gallery.images();
  check(list.map(img => JSON.parse(gallery.key(img))[0]).join(',') === expected,
    'manual capture is ordered correctly in normal-direction timelines too');
  const replacement = root.cloneNode(false);
  const newTurn = document.createElement('div');
  newTurn.dataset.turnKey = 'replacement-turn';
  const ready = document.createElement('img');
  ready.src = URL.createObjectURL(blob);
  await ready.decode();
  newTurn.append(ready);
  replacement.append(newTurn);
  root.replaceWith(replacement);
  await sleep(180);
  const saved = gallery.images().find(img => JSON.parse(gallery.key(img))[0] === 'replacement-turn');
  check(saved && saved.src !== ready.src && !saved.isConnected, 'passive capture rebinds when ChatGPT replaces the timeline');
})().then(() => finish()).catch(finish);
