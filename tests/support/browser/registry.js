// Register browser suites once, with explicit ownership and a site/feature fixture.
// Other sites and shared features can provide their own page and script paths.
const browserSuites = ['scan', 'manual', 'navigation', 'boundaries', 'branches', 'long-text'].map(name => ({
  id: 'chatgpt/gallery/' + name,
  page: '/sites/chatgpt/gallery/fixture.html',
  script: '/sites/chatgpt/gallery/' + name + '.browser.js',
}));
