(async () => {
  const gallery = await createGallery();
  setup({ initial: 4, history: true, start: 600, lazy: 3000 });
  const originalOverflow = root.style.getPropertyValue('overflow-y');
  const scanningWithScroll = gallery.scan();
  const wheel = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
  const touch = new Event('touchmove', { bubbles: true, cancelable: true });
  root.dispatchEvent(wheel);
  root.dispatchEvent(touch);
  check(wheel.defaultPrevented && touch.defaultPrevented && gallery.scanning &&
    getComputedStyle(root).overflowY === 'hidden', 'manual scrolling is blocked without cancelling the scan');
  await scanningWithScroll;
  const wheelAfter = new WheelEvent('wheel', { bubbles: true, cancelable: true });
  root.dispatchEvent(wheelAfter);
  check(!wheelAfter.defaultPrevented && root.style.getPropertyValue('overflow-y') === originalOverflow,
    'finishing a scan restores manual scrolling and the scrollbar');
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
  check(root.style.getPropertyValue('overflow-y') === originalOverflow,
    'cancellation also releases the scroll lock');

  setup({ id: 'switch-chat', count: 20 });
  nativeTimeout(() => { composer.dataset.mapComposerConversation = 'another-chat'; clearTurns(); }, 200);
  await gallery.scan();
  check(gallery.images() === null, 'conversation switch during scan discards the previous chat cache');

  // Simulate visibility transitions to test scan lifecycle, not browser throttling.
  const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
  const setHidden = value => {
    Object.defineProperty(document, 'hidden', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  try {
    setup({ id: 'pause-chat', count: 6 });
    const scanning = gallery.scan();
    await sleep(60);
    setHidden(true);
    const pausedDistance = distance();
    await sleep(700); // Longer than the subject's accelerated section timeout.
    check(gallery.scanning && distance() === pausedDistance,
      'hidden scan remains active without scrolling');
    setHidden(false);
    await scanning;
    check(gallery.images().length === 6 &&
      events.filter(event => event.event === 'scan-finish').at(-1).timeouts === 0,
      'returning to the tab completes the gallery without a hidden-time timeout');

    setup({ id: 'cancel-paused-chat', count: 6 });
    const cancelling = gallery.scan();
    setHidden(true);
    gallery.cancel();
    await cancelling;
    setHidden(false);
    check(!gallery.scanning && !document.querySelector('#iv-chatgpt-scan'),
      'cancelling a hidden scan cleans up without resuming');

    setup({ id: 'switch-paused-chat', count: 6 });
    const switching = gallery.scan();
    setHidden(true);
    composer.dataset.mapComposerConversation = 'another-paused-chat';
    clearTurns();
    await switching;
    setHidden(false);
    check(!gallery.scanning && gallery.images() === null,
      'changing chats abandons a paused scan and its old cache');
  } finally {
    if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
    else delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  }

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
