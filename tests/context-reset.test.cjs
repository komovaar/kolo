const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../internal/hub/ui/index.html'), 'utf8');
const source = ['drawSession', 'acknowledgeContext'].map((name) => html.match(new RegExp(
  `(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0]).join('\n');
function page() {
  const nodes = new Map(), messages = [], requests = [];
  const el = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { hidden: false, disabled: false, dataset: {} });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    selected: 'work', agentInURL: () => context.selected,
    me: { read_only: false }, signedIn: true, authRun: 0, contextAckPending: null,
    lastAgents: [{ name: 'work', host: 'machine', status: 'running', context_resets: [
      { id: 'first', previous_session: '<old-conversation>' },
    ] }], hosts: [{ id: 'machine' }], el,
    canControl: () => context.signedIn && !context.me.read_only,
    sessionState: () => ({ label: 'Running', key: 'unknown' }), applyAccess() {},
    say: (_, text) => messages.push(text), refresh: async () => {},
    signOut: () => { context.signedIn = false; context.authRun++; },
    fetch: async (...args) => { requests.push(args); return { ok: true, status: 204 }; },
  });
  vm.runInContext(source, context);
  return { context, el, messages, requests };
}

test('reset remains visible when running and read-only viewers cannot dismiss it', async () => {
  const p = page();
  p.context.drawSession();
  assert.equal(p.el('.session-error').hidden, true);
  assert.equal(p.el('.context-warning').hidden, false);
  assert.match(p.el('.context-warning-text').textContent, /<old-conversation>/);
  p.context.me.read_only = true;
  p.context.drawSession();
  assert.equal(p.el('.context-ack').hidden, true);
  await p.context.acknowledgeContext();
  assert.equal(p.requests.length, 0);
});

test('pending acknowledgement retains the warning and only confirmed polling clears it', async () => {
  const p = page();
  let resolve;
  p.context.fetch = (...args) => { p.requests.push(args); return new Promise((r) => { resolve = r; }); };
  const pending = p.context.acknowledgeContext();
  assert.equal(p.el('.context-warning').hidden, false);
  assert.equal(p.el('.context-ack').disabled, true);
  await p.context.acknowledgeContext();
  assert.equal(p.requests.length, 1);
  assert.equal(JSON.parse(p.requests[0][1].body).id, 'first');
  resolve({ ok: true, status: 204 });
  await pending;
  assert.equal(p.el('.context-warning').hidden, false, 'success does not hide a newer/unconfirmed state');
  p.context.lastAgents[0].context_resets[0].acknowledged = true;
  p.context.drawSession();
  assert.equal(p.el('.context-warning').hidden, true);
  p.context.lastAgents[0].context_resets.push({ id: 'second', previous_session: 'next' });
  p.context.drawSession();
  assert.equal(p.el('.context-warning').hidden, false);
  assert.match(p.el('.context-warning-text').textContent, /next/);
});

test('save failure retains warning; late replies do not affect another route or login', async () => {
  const p = page();
  p.context.fetch = async () => ({ ok: false, status: 503, text: async () => 'host could not save acknowledgement' });
  await p.context.acknowledgeContext();
  assert.equal(p.el('.context-warning').hidden, false);
  assert.match(p.messages[0], /could not save/);
  for (const change of ['route', 'login']) {
    const q = page();
    let resolve;
    q.context.fetch = () => new Promise((r) => { resolve = r; });
    let refreshed = false;
    q.context.refresh = async () => { refreshed = true; };
    const pending = q.context.acknowledgeContext();
    if (change === 'route') q.context.selected = 'other';
    else { q.context.authRun++; q.context.signedIn = false; }
    resolve({ ok: true, status: 204 });
    await pending;
    assert.equal(refreshed, false, change);
    assert.equal(q.context.lastAgents[0].context_resets[0].acknowledged, undefined);
  }
});
