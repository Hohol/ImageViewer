// Register browser suites once, with explicit ownership and a site/feature fixture.
// Other sites and shared features can provide their own page and script paths.
const browserSuites = ['scan', 'manual', 'navigation', 'boundaries', 'branches', 'long-text', 'eligibility'].map(name => ({
  id: 'chatgpt/gallery/' + name,
  page: '/sites/chatgpt/gallery/fixture.html',
  script: '/sites/chatgpt/gallery/' + name + '.browser.js',
}));

browserSuites.push(
  {
    id: 'chatgpt/svg-image-eligibility',
    page: '/shared/viewer/eligibility/fixture.html',
    script: '/sites/chatgpt/svg-image-eligibility.browser.js',
  },
  {
    id: 'chatgpt/search-image-eligibility',
    page: '/shared/viewer/eligibility/fixture.html',
    script: '/sites/chatgpt/search-image-eligibility.browser.js',
  },
  {
    id: 'shared/viewer/image-eligibility',
    page: '/shared/viewer/eligibility/fixture.html',
    script: '/shared/viewer/eligibility/common.browser.js',
  },
  ...['gemini', 'grok'].map(site => ({
    id: site + '/image-eligibility',
    page: '/shared/viewer/eligibility/fixture.html',
    script: '/sites/' + site + '/image-eligibility.browser.js',
  })),
);
