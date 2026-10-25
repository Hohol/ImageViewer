const root = document.querySelector('[data-app-action-timeline-scroll]');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  const end = Date.now() + 12000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Test timed out');
    await delay(30);
  }
}
let controller;
let sends;
let onSend;
let generation = 0;
let promptText = 'Draw a tree';
const canvas = document.createElement('canvas');
canvas.width = canvas.height = 16;
const imageUrl = canvas.toDataURL();
function mount(state = 'complete', image = false) {
  root.innerHTML = `<div data-turn-key="turn-${generation}"><div data-talvt-turn-state="${state}">
    <div data-chatgpt-search-unit-key="turn:user" data-chatgpt-search-message-ids="user">
      <div data-user-message-bubble>${promptText}</div><button aria-label="Edit message">Edit</button>
      <img alt="User attachment" src="${imageUrl}">
    </div>
    <div data-chatgpt-search-message-ids="response-${generation}">Image could not be generated: moderation failure</div>
    ${image ? `<img alt="Generated image 1" src="${imageUrl}#${generation}">` : ''}
    </div></div>`;
  root.querySelector('button').onclick = () => {
    const turn = root.firstElementChild;
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.setAttribute('aria-label', 'Edit message');
    editor.textContent = promptText;
    const form = document.createElement('form');
    form.addEventListener('submit', event => event.preventDefault());
    const send = document.createElement('button');
    send.type = 'button';
    send.textContent = 'Send';
    send.onclick = () => {
      form.requestSubmit();
      check(editor.textContent === promptText, 'retry preserves editor contents');
      sends++;
      generation++;
      mount('in_progress');
      onSend();
    };
    form.append(editor, send);
    turn.append(form);
  };
}
function setup(limit = 3, text = 'Draw a tree') {
  controller?.destroy();
  sends = 0;
  promptText = text;
  mount();
  controller = createChatGPTRetries(limit);
}
const start = () => document.querySelectorAll('#iv-chatgpt-retries button')[1].click();
const status = () => document.querySelector('#iv-chatgpt-retries [role="status"]').textContent;
(async () => {
  setup();
  const form = document.querySelector('form[data-chatgpt-composer]');
  const promptField = form.querySelector('[contenteditable]');
  const retryPanel = document.querySelector('#iv-chatgpt-retries');
  await until(() => form.classList.contains('iv-retry-side'));
  check(promptField.getBoundingClientRect().right <= retryPanel.getBoundingClientRect().left,
    'retry panel sits outside the composer without covering prompt controls');
  check(promptField.getBoundingClientRect().width === form.getBoundingClientRect().width,
    'side panel preserves the full original prompt width');
  form.style.width = '100%';
  await until(() => form.classList.contains('iv-retry-stacked'));
  check(promptField.getBoundingClientRect().bottom <= retryPanel.getBoundingClientRect().top,
    'insufficient outside space stacks controls without reducing prompt width');
  form.style.width = '900px';
  await until(() => form.classList.contains('iv-retry-side'));
  setup();
  // ChatGPT's reversed scroller is at the latest message at scrollTop zero.
  root.style.cssText = 'display:flex;flex-direction:column-reverse;height:120px;overflow:auto';
  root.firstElementChild.style.cssText = 'min-height:600px;flex-shrink:0';
  root.scrollTop = -250;
  onSend = () => {};
  start();
  check(status() === 'Scroll to the latest message first' && sends === 0,
    'reversed scroller rejects genuinely older history');
  root.scrollTop = 0;
  start();
  await until(() => sends === 1);
  check(status().includes('Generating'), 'reversed scroller accepts the latest message at scrollTop zero');
  controller.stop();
  root.style.cssText = '';
  setup();
  root.querySelector('button[aria-label="Edit message"]').remove();
  start();
  check(status() === 'Edit message control is unavailable', 'missing Edit does not incorrectly blame scrolling');
  setup();
  root.style.cssText = 'height:200px;overflow:auto';
  root.firstElementChild.style.height = '120px';
  const spacer = document.createElement('div');
  spacer.style.height = '400px';
  root.append(spacer);
  const bottomControl = document.createElement('button');
  bottomControl.setAttribute('aria-label', 'Scroll to bottom');
  bottomControl.setAttribute('aria-hidden', 'false');
  root.parentElement.append(bottomControl);
  onSend = () => {};
  start();
  check(status() === 'Scroll to the latest message first' && sends === 0,
    'visible bottom control still rejects older history');
  bottomControl.setAttribute('aria-hidden', 'true');
  start();
  await until(() => sends === 1);
  check(status().includes('Generating'),
    'visible latest turn with hidden bottom control accepts trailing blank space');
  controller.stop();
  bottomControl.remove();
  root.style.cssText = '';
  setup();
  // Hidden documents must remain eligible for retries. Actual browser timer
  // throttling is separately checked by running this fixture in a background tab.
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  document.dispatchEvent(new Event('visibilitychange'));
  onSend = () => setTimeout(() => mount('complete', sends === 2), 350);
  start();
  await until(() => status().startsWith('Image generated'));
  check(sends === 2, 'moderation failure retries while hidden; loaded generated image stops retries');
  delete document.hidden;
  check(document.querySelectorAll('#iv-chatgpt-retries button')[1].textContent === 'Retry image', 'button returns to idle');

  setup();
  onSend = () => {
    // Reproduce the captured live transition: a new response/turn is still
    // marked complete and Edit is absent, but the composer has a Stop button.
    mount('complete');
    root.querySelector('button[aria-label="Edit message"]').remove();
    const stop = document.createElement('button');
    stop.setAttribute('aria-label', 'Stop');
    document.querySelector('[data-map-composer-conversation]').append(stop);
    setTimeout(() => mount('in_progress'), 6000);
    setTimeout(() => { stop.remove(); mount('complete', true); }, 6500);
  };
  start();
  await until(() => sends === 1);
  await delay(5700);
  check(sends === 1 && status().includes('Attempt 1/3 · Generating'),
    'composer Stop prevents a premature second attempt while turn incorrectly says complete');
  await until(() => status().startsWith('Image generated'));
  check(sends === 1, 'delayed in-progress transition finishes the original attempt successfully');

  setup(2);
  onSend = () => setTimeout(() => mount('complete'), 350);
  start();
  await until(() => status().startsWith('Attempt limit'));
  check(sends === 2, 'additional attempt limit is enforced; attachments never count as success');

  setup();
  onSend = () => {};
  start();
  await until(() => sends === 1);
  start();
  mount('complete');
  await delay(550);
  check(sends === 1 && status() === 'Retries stopped', 'Stop retries cancels the loop during generation');

  setup();
  mount('in_progress');
  start();
  await delay(100);
  check(sends === 0, 'does not submit over an existing generation');
  mount('complete', true);
  await until(() => status() === 'Image generated (0 retries)');
  check(sends === 0, 'existing generation success needs no retry');

  setup();
  onSend = () => {};
  start();
  await until(() => sends === 1);
  document.querySelector('[data-map-composer-conversation]').setAttribute('data-map-composer-conversation', 'different');
  await until(() => status() === 'Chat changed');
  check(sends === 1, 'conversation change stops the session');

  setup();
  onSend = () => {};
  start();
  await until(() => sends === 1);
  mount('complete', true);
  const img = root.querySelector('img[alt^="Generated"]');
  Object.defineProperty(img, 'complete', { configurable: true, value: false });
  await delay(2500);
  check(sends === 1 && status().includes('Generating'), 'completed turn waits for its generated image to load');
  Object.defineProperty(img, 'complete', { configurable: true, value: true });
  await until(() => status().startsWith('Image generated'));
  const composerForm = document.querySelector('form[data-chatgpt-composer]');
  composerForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  check(status() === '' && document.querySelectorAll('#iv-chatgpt-retries button')[1].textContent === 'Retry image',
    'new prompt submission clears the completed retry status');
  controller.stop();
  mount();
  const editForm = document.createElement('form');
  const editInput = document.createElement('textarea');
  editForm.append(editInput);
  root.firstElementChild.append(editForm);
  editForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  check(status() === '', 'edited prompt submission clears stale retry status');
  setup();
  onSend = () => {};
  start();
  await until(() => sends === 1);
  composerForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  check(status() === '' && document.querySelectorAll('#iv-chatgpt-retries button')[1].textContent === 'Retry image',
    'manual submission cancels active retries and restores the default state');
  setup();
  const composerInput = composerForm.querySelector('[contenteditable]');
  composerInput.textContent = ' d ';
  composerForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  check(status() === 'Waiting for submitted prompt', 'manual d arms retries before the new turn appears');
  generation++;
  promptText = 'd';
  mount('in_progress');
  await delay(350);
  check(sends === 0 && status() === 'Waiting for current generation', 'd waits for initial generation without spending a retry');
  mount('complete', true);
  await until(() => status() === 'Image generated (0 retries)');

  setup();
  composerInput.textContent = 'd';
  onSend = () => setTimeout(() => mount('complete', true), 350);
  composerForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  generation++;
  promptText = 'd';
  mount('complete');
  await until(() => status() === 'Image generated (1 retries)');
  check(sends === 1, 'failed manual d automatically retries; automatic d submissions do not restart the loop');

  setup();
  const manualEditForm = document.createElement('form');
  const manualEditInput = document.createElement('textarea');
  manualEditInput.value = 'd';
  manualEditForm.append(manualEditInput);
  root.firstElementChild.append(manualEditForm);
  manualEditForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  check(status() === 'Waiting for submitted prompt', 'manually edited d also arms retries');
  controller.stop();
  generation++;
  promptText = 'd';
  mount('in_progress');
  await delay(350);
  check(status() === 'Retries stopped' && sends === 0, 'Stop retries cancels a pending manual d submission');

  setup();
  composerInput.textContent = 'draw a tree';
  composerForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  check(status() === '' && document.querySelectorAll('#iv-chatgpt-retries button')[1].textContent === 'Retry image',
    'other manually submitted prompts reset without enabling retries');
  const autosend = () => document.querySelector('#iv-chatgpt-retries button').click();
  let newSends = 0;
  const nativeSend = document.createElement('button');
  nativeSend.type = 'button';
  nativeSend.setAttribute('data-testid', 'send-button');
  nativeSend.onclick = () => {
    check(composerInput.textContent === 'd', 'autosend enters d through the composer');
    composerForm.requestSubmit();
    newSends++;
    composerInput.textContent = '';
    promptText = 'd';
    generation++;
    mount('in_progress');
    setTimeout(() => mount('complete', true), 350);
  };
  composerForm.addEventListener('submit', event => event.preventDefault());
  composerForm.append(nativeSend);
  setup();
  composerInput.textContent = '';
  mount('in_progress');
  autosend();
  await delay(2300);
  check(newSends === 0, 'autosend waits while the answer is in progress');
  mount('complete');
  await until(() => status() === 'Image generated (0 retries)');
  check(newSends === 1 && sends === 0, 'autosend sends once and activates image retries');

  setup();
  composerInput.textContent = '';
  mount('in_progress');
  autosend();
  autosend();
  mount('complete');
  await delay(2300);
  check(newSends === 1 && status() === 'Autosend cancelled', 'cancel prevents a queued d from sending');

  setup();
  composerInput.textContent = 'My draft';
  autosend();
  await until(() => status().includes('contains a draft'));
  check(newSends === 1 && composerInput.textContent === 'My draft', 'autosend preserves an existing draft');

  setup();
  composerInput.textContent = '';
  mount('in_progress');
  autosend();
  document.querySelector('[data-map-composer-conversation]').setAttribute('data-map-composer-conversation', 'autosend-other-chat');
  await until(() => status() === 'Chat changed');
  check(newSends === 1, 'chat navigation cancels pending autosend');
  nativeSend.remove();
  controller.destroy();
})().then(() => finish()).catch(error => { controller?.destroy(); finish(error); });
