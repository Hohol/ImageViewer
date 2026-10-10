// Use real DOM selectors and shipped filters. Only host identity and gallery
// availability are supplied by the fixture. CSP prevents sample CDN requests.
let host = 'chatgpt';
function isChatGPTHost() { return host === 'chatgpt'; }
function isGeminiHost() { return host === 'gemini'; }
function isGrokHost() { return host === 'grok'; }
let ivChatGPTGallery = null, overlay = null;
const samples = document.querySelector('#samples');
const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
function sample(markup = '<img>', attributes = {}) {
  samples.innerHTML = markup;
  const img = samples.querySelector('img');
  img.src = pixel;
  for (const [key, value] of Object.entries(attributes)) img.setAttribute(key, value);
  return img;
}
function expectEligibility(img, eligible, description) {
  check(isExcludedImage(img) === !eligible &&
    (imageFromEventTarget(img) === img) === eligible &&
    collectNavigableImages().includes(img) === eligible,
    description + ' — filter, clicking, and navigation agree');
}
