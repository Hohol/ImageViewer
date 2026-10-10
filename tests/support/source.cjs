const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.resolve(__dirname, '../../ImageViewer.js');
const sections = {
  'shared/viewer/image-eligibility': [
    ['    function isChatGPTProfileImage(', '    function viewerImageSrcForNewTab('],
    ['    function isGeminiOptInResultSrc(', '    // Grok: chat cards use'],
    ['    function isExcludedImage(', '    function clearOverlay()'],
  ],
  'shared/viewer/image-target': ['    function imageFromEventTarget(', '    function viewerImageFromEventTarget('],
  'shared/viewer/image-collection': ['    function collectNavigableImages()', '    function pickRandomIndex('],
  'chatgpt/gallery': ['    function createChatGPTGallery()', '    // ChatGPT scrolls'],
  'chatgpt/navigation-debug': ['    function createChatGPTNavigationDebug()', '    // The timeline only mounts'],
  'shared/viewer/navigation': ['    function cancelImageNavigationSearch()', '    function navigateToRandomImage()'],
};

// Exercise the shipped functions without executing the userscript's site setup.
// Fail explicitly if a refactor changes a boundary; never silently test an empty slice.
function readSection(name) {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const markers = sections[name];
  if (!markers) throw new Error(`Unknown source section: ${name}`);
  const fragments = typeof markers[0] === 'string' ? [markers] : markers;
  return fragments.map(([first, last]) => {
    const start = source.indexOf(first);
    const end = source.indexOf(last, start);
    if (start < 0 || end <= start || source.indexOf(first, start + 1) !== -1) {
      throw new Error(`Update tests/support/source.cjs: cannot locate ${name} in ImageViewer.js`);
    }
    return source.slice(start, end);
  }).join('\n');
}

module.exports = { readSection, scriptPath };
