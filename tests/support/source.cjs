const fs = require('node:fs');
const path = require('node:path');

const scriptPath = path.resolve(__dirname, '../../ImageViewer.js');
const sections = {
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
  const start = source.indexOf(markers[0]);
  const end = source.indexOf(markers[1], start);
  if (start < 0 || end <= start || source.indexOf(markers[0], start + 1) !== -1) {
    throw new Error(`Update tests/support/source.cjs: cannot locate ${name} in ImageViewer.js`);
  }
  return source.slice(start, end);
}

module.exports = { readSection, scriptPath };
