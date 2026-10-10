const suite = browserSuites.find(candidate => candidate.id === suiteName && candidate.page === location.pathname);
document.querySelector('#suite-name').textContent = suiteName || 'Unknown suite';
if (suite) {
  const script = document.createElement('script');
  script.src = suite.script;
  script.onerror = () => finish(new Error('Could not load suite: ' + suiteName));
  document.body.append(script);
} else {
  finish(new Error('Unknown suite: ' + suiteName));
}
window.addEventListener('error', event => finish(event.error || new Error(event.message)));
window.addEventListener('unhandledrejection', event => finish(event.reason));
