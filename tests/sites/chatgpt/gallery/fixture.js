// Shared synthetic ChatGPT timeline. It mounts only a neighbouring window of
// turns, revokes source blobs on unmount, and can delay images/history pages.
// No account, real chat content, external assets, or browser extensions needed.
const root = document.querySelector('#timeline');
const content = document.querySelector('#content');
const composer = document.querySelector('[data-map-composer-conversation]');
const nativeTimeout = window.setTimeout.bind(window);
const nativeFetch = window.fetch.bind(window);
const nativeNow = performance.now.bind(performance);
const intervals = [];
window.addEventListener('imageviewer-test-finished', () => intervals.forEach(clearInterval));
// Speed up only the subject's waits, not native browser rendering. These are
// foreground correctness tests, not Chrome background-throttling simulations.
const scale = 20;
const sleep = ms => new Promise(resolve => nativeTimeout(resolve, ms));
const events = [];

// Surrounding viewer APIs are stubs; the gallery below is extracted verbatim
// from the current userscript, as are its image eligibility rules.
// Navigation integration has a separate Node test.
let overlay = null, imgs = [], currentIndex = -1;
const ivChatGPTNavigationDebug = { record(event, data) { events.push({ event, ...data }); } };
function isChatGPTHost() { return true; }
function isGrokHost() { return false; }
function isGeminiHost() { return false; }
function clearOverlay() { overlay = null; }
function hideGallery() { overlay = null; }
function hideViewerHotkeysModal() {}
function showViewerToast(message) { events.push({ event: 'toast', message }); }
function hideViewerToast(message) { events.push({ event: 'hide-toast', message }); }
function ivLogImageClipboard() {}
async function clipboardPngBlobFromImageElement(img) {
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return new Promise(resolve => canvas.toBlob(resolve));
}
async function createGallery(cacheOnly = () => false) {
  const response = await nativeFetch('/subject/chatgpt/gallery.js');
  if (!response.ok) throw new Error(await response.text());
  const code = await response.text();
  return new Function('cacheOnly', 'setTimeout', 'setInterval', 'performance', code + '\nreturn createChatGPTGallery(cacheOnly);')(
    cacheOnly,
    (fn, ms) => nativeTimeout(fn, ms / scale),
    (fn, ms) => {
      const id = window.setInterval(fn, ms / scale);
      intervals.push(id);
      return id;
    },
    { now: () => nativeNow() * scale },
  );
}

let total = 12, first = 0, broken = -1, delay = 1800, paginate = false, historyTimer = false;
let siteURLs = [], removedURLs = [], generation = 0;
let branchFrom = Infinity, branchSuffix = '', imageEvery = 1;
let definitions = null;
let moves = 0;
let decorateImage = () => {};
let rejectFetch = false;
window.fetch = (...args) => rejectFetch && String(args[0]).startsWith('blob:')
  ? Promise.reject(new TypeError('Fixture: blocked image fetch')) : nativeFetch(...args);

function distance() {
  return getComputedStyle(root).flexDirection === 'column-reverse'
    ? -root.scrollTop : root.scrollHeight - root.clientHeight - root.scrollTop;
}
function setDistance(n) {
  root.scrollTop = getComputedStyle(root).flexDirection === 'column-reverse'
    ? -n : root.scrollHeight - root.clientHeight - n;
}
function turnHeight(i) { return definitions ? definitions[i].height : 300; }
function turnTop(i) {
  let top = 0;
  for (let index = first; index < i; index++) top += turnHeight(index);
  return top;
}
function removeTurn(turn) {
  for (const img of turn.querySelectorAll('img')) {
    URL.revokeObjectURL(img.src);
    removedURLs.push(img.src);
  }
  turn.remove();
}
function clearTurns() { for (const turn of [...content.children]) removeTurn(turn); }
function render() {
  const position = distance();
  const offset = Math.max(0, turnTop(total) - root.clientHeight - position);
  let center = first;
  while (center < total - 1 && turnTop(center + 1) <= offset) center++;
  const wanted = [];
  for (let i = Math.max(first, center - 1); i <= Math.min(total - 1, center + 1); i++) wanted.push(i);
  for (const turn of [...content.children]) {
    if (!wanted.includes(Number(turn.dataset.index))) removeTurn(turn);
  }
  for (const i of wanted) {
    if (content.querySelector(`[data-index="${i}"]`)) continue;
    const turn = document.createElement('div');
    const suffix = i >= branchFrom ? branchSuffix : '';
    turn.dataset.turnKey = 'turn-' + i + suffix;
    turn.dataset.index = i;
    turn.style.top = turnTop(i) + 'px';
    turn.style.height = turnHeight(i) + 'px';
    const owner = document.createElement('div');
    owner.dataset.chatgptSearchMessageIds = 'message-' + i + suffix;
    turn.append(owner);
    const after = [...content.children].find(el => Number(el.dataset.index) > i);
    content.insertBefore(turn, after || null);
    if (!(definitions ? definitions[i].image : i % imageEvery === 0)) {
      owner.dataset.talvtTurnState = 'complete';
      owner.textContent = 'A long, fully rendered text response.';
      continue;
    }
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.dataset.testid = 'generated-image-preview';
    owner.append(preview);
    nativeTimeout(async () => {
      if (!turn.isConnected) return;
      const img = document.createElement('img');
      img.alt = 'Generated image';
      if (i === broken) {
        img.src = 'blob:' + location.origin + '/missing';
        preview.append(img);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = 80;
      canvas.height = 120;
      const context = canvas.getContext('2d');
      context.fillStyle = `hsl(${i * 30},80%,50%)`;
      context.fillRect(0, 0, 80, 120);
      const blob = await new Promise(resolve => canvas.toBlob(resolve));
      if (!turn.isConnected) return;
      img.src = URL.createObjectURL(blob);
      siteURLs.push(img.src);
      preview.append(img);
      decorateImage(turn, img);
    }, delay / scale);
  }
  if (paginate && first > 0 && position >= root.scrollHeight - root.clientHeight - 2 && !historyTimer) {
    historyTimer = true;
    const token = generation;
    nativeTimeout(() => {
      if (token !== generation) return;
      const previous = distance();
      clearTurns();
      first = 0;
      content.style.height = turnTop(total) + 'px';
      setDistance(previous);
      render();
    }, 1000 / scale);
  }
}
root.addEventListener('scroll', () => { moves++; render(); });
function setup({ id = 'test-chat', direction = 'column-reverse', count = 12,
  start = 0, initial = 0, bad = -1, lazy = 1800, history = false } = {}) {
  generation++;
  composer.dataset.mapComposerConversation = id;
  root.style.flexDirection = direction;
  total = count;
  first = initial;
  broken = bad;
  delay = lazy;
  paginate = history;
  historyTimer = false;
  clearTurns();
  content.style.height = turnTop(total) + 'px';
  setDistance(start);
  render();
}
