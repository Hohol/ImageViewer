const suites = browserSuites;
const frame = document.querySelector('#fixture');
const status = document.querySelector('#status');
const rows = suites.map(({ id }) => {
  const row = document.createElement('li');
  row.textContent = id + ': waiting';
  document.querySelector('#suites').append(row);
  return row;
});
let current = 0;
let failures = 0;
let assertions = 0;
let watchdog;

function start() {
  rows[current].textContent = suites[current].id + ': running';
  frame.src = suites[current].page + '?suite=' + encodeURIComponent(suites[current].id);
  watchdog = setTimeout(() => complete({ error: 'Suite timed out after 60 seconds', checks: [] }), 60000);
}
function complete(result) {
  clearTimeout(watchdog);
  const row = rows[current];
  assertions += result.checks.length;
  failures += result.error ? 1 : 0;
  row.dataset.status = result.error ? 'failed' : 'passed';
  row.textContent = `${suites[current].id}: ${result.error ? 'FAIL' : 'PASS'} (${result.checks.length} checks)`;
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'Results';
  const text = document.createElement('pre');
  text.textContent = result.checks.join('\n') + (result.error ? '\n' + result.error : '');
  details.append(summary, text);
  row.append(details);
  if (++current < suites.length) start();
  else {
    frame.remove();
    status.dataset.status = failures ? 'failed' : 'passed';
    status.textContent = failures
      ? `FAIL: ${failures} suite(s) failed; ${assertions} checks passed.`
      : `ALL TESTS PASSED: ${suites.length} suites, ${assertions} checks.`;
  }
}
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow ||
      event.data?.type !== 'imageviewer-test-result' || event.data.suite !== suites[current]?.id) return;
  complete(event.data);
});
start();
