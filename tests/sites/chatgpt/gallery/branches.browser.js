(async () => {
  const gallery = await createGallery();
  const keys = () => (gallery.images() || []).map(img => JSON.parse(gallery.key(img))[0]);
  function editor(i) {
    const turn = content.querySelector(`[data-index="${i}"]`);
    if (!turn) throw new Error('Test turn not mounted: ' + i);
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.setAttribute('aria-label', 'Edit message');
    turn.append(edit);
    edit.onclick = () => {
      const box = document.createElement('div');
      box.innerHTML = '<textarea>Old prompt</textarea><button type="button">Cancel</button><button type="button">Send</button>';
      turn.append(box);
      box.children[1].onclick = () => box.remove();
    };
    edit.click();
    const box = turn.lastChild;
    return { cancel: () => box.children[1].click(), send: () => box.children[2].click() };
  }

  setup({ count: 8, lazy: 0 });
  await gallery.scan();
  check(keys().length === 8, 'full scan starts with eight cached images');
  const initial = gallery.images().map(img => img.src);
  overlay = document.createElement('div');
  const openGallery = overlay;
  imgs = gallery.images();
  const selected = imgs[2];
  currentIndex = 2;
  setDistance(900);
  render();
  await sleep(80);
  editor(4).cancel();
  await sleep(40);
  check(keys().length === 8 && !events.some(event => event.event === 'scan-branch-discarded'),
    'opening and cancelling an edit preserves cache');
  // Main composer controls must not be treated as an edit submission.
  const main = document.createElement('button');
  main.textContent = 'Send';
  composer.append(main);
  main.click();
  main.remove();
  check(keys().length === 8, 'main composer Send preserves earlier conversation');
  check(overlay === openGallery && imgs[currentIndex] === selected, 'main composer Send preserves the open gallery');

  editor(4).send();
  check(overlay === openGallery && imgs[currentIndex] === selected && imgs.length === 4,
    'edit submission keeps an unaffected image open and drops the discarded suffix from navigation');
  check(keys().join(',') === 'turn-0,turn-1,turn-2,turn-3', 'edit submit immediately discards edited turn and cached suffix');
  await sleep(130);
  check(keys().join(',') === 'turn-0,turn-1,turn-2,turn-3', 'lingering old DOM cannot repopulate cache');
  check(gallery.images().map(img => img.src).join(',') === initial.slice(0, 4).join(','), 'earlier owned image URLs are preserved');
  const discarded = await Promise.allSettled(initial.slice(4).map(url => nativeFetch(url)));
  check(discarded.every(result => result.status === 'rejected'), 'discarded images release their owned blob URLs');
  branchFrom = 4;
  branchSuffix = '-edited';
  setup({ count: 6, lazy: 0 });
  await sleep(140);
  check(keys().join(',') === 'turn-0,turn-1,turn-2,turn-3,turn-4-edited,turn-5-edited',
    'new branch images are collected in chronological order');

  // User-editor focus provides a fallback for the English edit-button label.
  const turn = content.querySelector('[data-index="4"]');
  const form = document.createElement('form');
  form.dataset.messageAuthorRole = 'user';
  form.innerHTML = '<textarea>Edited</textarea>';
  form.onsubmit = event => event.preventDefault();
  turn.append(form);
  form.firstChild.focus();
  imgs = gallery.images();
  currentIndex = 4;
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  check(!overlay, 'edit submission closes the gallery if it discards the selected image');
  check(keys().join(',') === 'turn-0,turn-1,turn-2,turn-3', 'user editor focus and form submission trim the branch');

  // Gate an old image fetch across submission to expose stale async writes.
  branchFrom = Infinity;
  branchSuffix = '';
  setup({ id: 'pending-edit', count: 8, start: 1200, lazy: 0 });
  await sleep(120);
  const savedFetch = window.fetch;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  window.fetch = async (...args) => {
    const response = await savedFetch(...args);
    if (String(args[0]).startsWith('blob:')) await gate;
    return response;
  };
  total = 9;
  content.style.height = '2700px';
  setDistance(0);
  render();
  await sleep(70);
  setDistance(1500);
  render();
  await sleep(40);
  editor(3).send();
  release();
  window.fetch = savedFetch;
  await sleep(150);
  check(keys().every(key => Number(key.split('-')[1]) < 3), 'pending old-branch capture cannot resurrect discarded images');

  // A running scan rebuilds turn order; cached, unmounted turns must also go.
  setup({ id: 'scan-edit', count: 12, lazy: 0 });
  await gallery.scan();
  check(keys().length === 12, 'second full scan has all twelve images');
  const scanning = gallery.scan();
  await sleep(25);
  setDistance(2100);
  render();
  await sleep(25);
  editor(4).send();
  await scanning;
  await sleep(100);
  check(keys().join(',') === 'turn-0,turn-1,turn-2,turn-3',
    'editing during a scan prunes its previous order and cancels stale scan work');
  check(!gallery.scanning, 'scan is cleaned up after branch invalidation');
})().then(() => finish()).catch(finish);
