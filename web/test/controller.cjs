const { controllerActions } = require('../src/app/bind.ts');

function fixture(overrides) {
  return { fetch: globalThis.fetch, FormData: globalThis.FormData, crypto: globalThis.crypto, ...overrides };
}
function bind(runtime, names) {
  const operations = controllerActions(runtime);
  for (const name of names) {
    if (!operations[name]) throw new Error('Unknown controller operation: ' + name);
    runtime[name] = operations[name];
  }
  return runtime;
}
module.exports = { fixture, bind };
