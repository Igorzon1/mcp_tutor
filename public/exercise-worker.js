// Only this isolated worker permits evaluation of exercise code. Its response
// has a separate CSP that blocks network access and additional scripts/workers.
const send = self.postMessage.bind(self);
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'importScripts', 'indexedDB', 'caches']) {
  try { Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false }); } catch {}
}

self.onmessage = event => {
  const payload = event.data;
  const started = performance.now();
  let output = '';
  const print = value => {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  const log = (...values) => {
    if (output.length < 12000) output = (output + values.map(print).join(' ') + '\n').slice(0, 12000);
  };
  for (const name of ['log', 'info', 'warn', 'error', 'debug']) self.console[name] = log;
  let checks = [];
  let error;
  try {
    const assertions = payload.tests.map(test => '({label:' + JSON.stringify(test.label) + ',passed:Boolean(' + test.expression + ')})').join(',');
    const result = Function('"use strict";\n' + payload.code + '\nreturn [' + assertions + '];')();
    checks = Array.isArray(result) ? result.map(item => ({ label: String(item.label), passed: Boolean(item.passed) })) : [];
  } catch (caught) {
    error = String(caught?.name || 'Error') + ': ' + String(caught?.message || caught);
    checks = payload.tests.map(test => ({ label: test.label, passed: false }));
  }
  send({ token: payload.token, type: 'mcp-tutor-js-result', status: error ? 'error' : (checks.length && checks.every(check => check.passed) ? 'passed' : 'needs_work'), checks, output, error, durationMs: Math.round(performance.now() - started) });
};
