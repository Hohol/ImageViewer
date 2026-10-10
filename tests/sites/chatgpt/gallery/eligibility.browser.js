(async () => {
  // Mix accepted generated results with every formerly click-only exclusion.
  decorateImage = (turn, img) => {
    const index = Number(turn.dataset.index);
    const preview = img.parentElement;
    if (index === 1) preview.setAttribute('aria-label', 'Favorites');
    if (index === 2) turn.setAttribute('role', 'listitem');
    if (index === 3) turn.classList.add('backdrop-blur-md');
    if (index === 4) {
      turn.classList.add('flex', 'flex-col', 'gap-2');
      preview.removeAttribute('data-testid');
    }
    if (index === 5) preview.classList.add('preview-image-button');
    if (index === 6) img.alt = 'User';
    // The generated-image exception inside this generic layout must still pass.
    if (index === 7) turn.classList.add('flex', 'flex-col', 'gap-2');
  };
  const gallery = await createGallery();
  const keys = () => (gallery.images() || []).map(img => JSON.parse(gallery.key(img))[0]);
  setup({ id: 'excluded-scan', count: 9, lazy: 0 });
  await gallery.scan();
  check(keys().join(',') === 'turn-0,turn-7,turn-8', 'scan caches only eligible original images');
  clearTurns();
  await sleep(80);
  check(keys().join(',') === 'turn-0,turn-7,turn-8', 'eligible cached images survive losing their DOM ancestors');
  await Promise.all(gallery.images().map(img => img.decode()));
  check(true, 'eligible cached blob copies remain usable');

  setup({ id: 'excluded-navigation', count: 9, start: 2400, lazy: 0 });
  await sleep(150);
  check(keys().join(',') === 'turn-0', 'passive capture excludes the mounted Favorites thumbnail');
  const first = gallery.images()[0];
  const found = await gallery.findNext(first, 1, () => true);
  check(found && JSON.parse(gallery.key(found.list[found.index]))[0] === 'turn-7',
    'directional lookup skips excluded images across unloaded turns');
  check(keys().every(key => ['turn-0', 'turn-7', 'turn-8'].includes(key)),
    'navigation cannot introduce excluded images into the cache');
})().then(() => finish()).catch(finish);
