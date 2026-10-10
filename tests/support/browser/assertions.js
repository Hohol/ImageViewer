// Common assertion reporting for isolated browser suites.
const results = document.querySelector('#results');
const suiteName = new URLSearchParams(location.search).get('suite');
const checks = [];
let finished = false;
function check(condition, message) {
  if (!condition) throw new Error(message);
  checks.push('PASS ' + message);
  results.textContent = checks.join('\n');
}
function finish(error) {
  if (finished) return;
  finished = true;
  window.dispatchEvent(new Event('imageviewer-test-finished'));
  const failure = error ? String(error.stack || error) : null;
  results.textContent = checks.join('\n') + (failure ? '\nFAIL ' + failure : '\nALL TESTS PASSED');
  results.dataset.status = failure ? 'failed' : 'passed';
  parent.postMessage({ type: 'imageviewer-test-result', suite: suiteName, checks, error: failure }, location.origin);
}
