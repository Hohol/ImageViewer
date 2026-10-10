(async () => {
  const gallery = await createGallery();
  setup({ initial: 4, history: true, start: 600, lazy: 3000 });
  await gallery.scan();
  let list = gallery.images();
  check(list.length === 12, 'scan catches delayed images across older-history pagination');
  check(list.map(img => JSON.parse(gallery.key(img))[0]).join(',') ===
    Array.from({ length: 12 }, (_, i) => 'turn-' + i).join(','),
    'gallery stays chronological across overlapping windows');
  check(Math.abs(distance() - (root.scrollHeight - root.clientHeight)) < 3, 'scan remains at the beginning');
  check(removedURLs.length > 0, 'fixture unmounted turns and revoked their blob URLs');
  check(list.every(img => !siteURLs.includes(img.src)), 'gallery owns independent blob URLs');
  await Promise.all(list.map(img => img.decode()));
  check(true, 'all retained images decode after source turns unmount');
  setDistance(0);
  render();
  await sleep(180);
  check(gallery.images().length === 12, 'remounting a message with a new blob URL does not duplicate it');

  const oldURLs = list.map(img => img.src);
  setup({ id: 'forward-chat', direction: 'column', count: 5, start: 300 });
  await sleep(60);
  await gallery.scan();
  list = gallery.images();
  check(list.length === 5, 'normal-direction timeline scan collects all images');
  check(Math.abs(distance() - (root.scrollHeight - root.clientHeight)) < 3, 'normal-direction scan remains at the beginning');
  const previous = await Promise.allSettled(oldURLs.map(url => nativeFetch(url)));
  check(previous.every(result => result.status === 'rejected'), 'switching chats revokes old cached URLs');

  setup({ id: 'cancel-chat', count: 20, start: 900 });
  let stopped;
  nativeTimeout(() => { gallery.cancel(); stopped = distance(); }, 260);
  await gallery.scan();
  list = gallery.images();
  check(list.length > 0 && list.length < 20, 'cancellation retains the partial gallery');
  check(distance() === stopped, 'cancellation leaves the current scroll position');

  setup({ id: 'switch-chat', count: 20 });
  nativeTimeout(() => { composer.dataset.mapComposerConversation = 'another-chat'; clearTurns(); }, 200);
  await gallery.scan();
  check(gallery.images() === null, 'conversation switch during scan discards the previous chat cache');

  rejectFetch = true;
  setup({ id: 'canvas-fallback', count: 2 });
  await gallery.scan();
  check(gallery.images().length === 2, 'decoded-pixel fallback preserves images when fetch is blocked');
  rejectFetch = false;
  setup({ id: 'broken-image', count: 2, bad: 0 });
  await gallery.scan();
  check(events.some(event => event.event === 'scan-section-timeout'), 'broken image triggers a bounded loading timeout');
  check(events.filter(event => event.event === 'toast').at(-1).message.includes('may be missing'),
    'incomplete scan reports missing images');
  check(!gallery.scanning && !document.querySelector('#iv-chatgpt-scan'), 'scan UI and active state are cleaned up');
})().then(() => finish()).catch(finish);
