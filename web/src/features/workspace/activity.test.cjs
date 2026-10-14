const { fixture, bind } = require('../../../test/controller.cjs');
const assert = require('node:assert/strict');

const test = require('node:test');

function page(fetch) {
  const message = { hidden: true }, rows = { children: ['previous entry'],
    replaceChildren() { this.children = []; }, append(row) { this.children.push(row); } };
  const context = fixture({
    authRun: 0, logRun: 0, signedIn: true, fetch,
    el: (selector) => selector === '.log-message' ? message : rows,
    document: { createElement: () => ({}) }, entryRow: (e) => e,
    signOut: () => { context.signedIn = false; },
  });
  bind(context, ["drawLog"]);
  return { context, message, rows };
}

test('network, HTTP and unreadable-body errors preserve previous activity', async () => {
  for (const fetch of [
    async () => { throw Error('offline'); },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, json: async () => { throw Error('invalid JSON'); } }),
    async () => ({ ok: true, json: async () => ({}) }),
  ]) {
    const p = page(fetch); await p.context.drawLog();
    assert.deepEqual(p.rows.children, ['previous entry']);
    assert.equal(p.message.hidden, false);
    assert.match(p.message.textContent, /out of date/);
  }
});

test('successful retry clears fetch error and reports in-memory recording', async () => {
  const p = page(async () => { throw Error('offline'); });
  await p.context.drawLog();
  p.context.fetch = async () => ({ ok: true, json: async () => ({ entries: [{ what: 'created' }], persistent: false }) });
  await p.context.drawLog();
  assert.match(p.message.textContent, /only kept in memory/);
  assert.equal(p.rows.children[0].what, 'created');
  p.context.fetch = async () => ({ ok: true, json: async () => ({ entries: [], persistent: true }) });
  await p.context.drawLog();
  assert.equal(p.message.hidden, true);
});

test('older responses cannot replace newer entries or recording warnings', async () => {
  let resolve;
  const p = page(() => new Promise((done) => { resolve = done; }));
  const old = p.context.drawLog();
  p.context.fetch = async () => ({ ok: true, json: async () => ({ entries: [{ what: 'new' }], persistent: false }) });
  await p.context.drawLog();
  resolve({ ok: true, json: async () => ({ entries: [{ what: 'old' }], persistent: true }) });
  await old;
  assert.equal(p.rows.children[0].what, 'new');
  assert.match(p.message.textContent, /only kept in memory/);
});

test('late errors cannot show private status after authentication is lost', async () => {
  let reject;
  const p = page(() => new Promise((_, fail) => { reject = fail; }));
  const pending = p.context.drawLog();
  p.context.authRun++; p.context.signedIn = false;
  reject(Error('offline')); await pending;
  assert.equal(p.message.hidden, true);
});
