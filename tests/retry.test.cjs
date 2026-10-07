const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../internal/hub/ui/index.html'), 'utf8');
const names = ['canControl', 'applyAccess', 'sessionState', 'drawSession', 'canWatch',
  'reconcileWatch', 'retrySession', 'close'];
const source = names.map((name) => html.match(new RegExp(
  `(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0]).join('\n');

function page() {
  const nodes = new Map(), messages = [], timers = new Map(), requests = [];
  let watched = 0, closed = 0;
  const el = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { hidden: false, disabled: false, dataset: {} });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    selected: 'repair', agentInURL: () => context.selected,
    signedIn: true, me: { read_only: false }, authRun: 0, contextAckPending: null, retryPending: null, renamingId: null,
    lastAgents: [{ name: 'repair', host: 'machine', status: 'failed', error: 'exit status 1', command: 'cat', dir: '/work' }],
    hosts: [{ id: 'machine' }], term: { options: {} }, screenReady: false,
    watching: 'repair', terminalOwner: null, socket: null, reconnectTimer: 1, typist: null,
    WebSocket: { OPEN: 1, CLOSED: 3 }, el, keyboardChanged() {}, closeCreate() {}, resetTerminal() {},
    clearTimeout: (id) => timers.delete(id), say: (_, text) => messages.push(text),
    watch: (name) => { watched++; context.watching = name; }, connect: () => { watched++; },
    refresh: async () => {}, signOut: () => { context.signedIn = false; context.authRun++; },
    fetch: async (...args) => { requests.push(args); return { ok: true, status: 202 }; },
  });
  vm.runInContext(source, context);
  timers.set(1, () => {});
  context.socket = { readyState: 3, close: () => { closed++; } };
  return { context, el, timers, requests, messages, watched: () => watched, closed: () => closed };
}

test('failure is visible, Retry is enabled without a socket, and reconnect stops', () => {
  const p = page();
  p.context.drawSession(); p.context.reconcileWatch();
  assert.equal(p.el('.session-error').textContent, 'exit status 1');
  assert.equal(p.el('.session-error').hidden, false);
  assert.equal(p.el('.session-connection').textContent, 'Session failed');
  assert.equal(p.el('.watch .restart').textContent, 'Retry');
  assert.equal(p.el('.watch .restart').disabled, false);
  assert.equal(p.context.socket, null);
  assert.equal(p.timers.size, 0);
  assert.equal(p.context.term.options.disableStdin, true);
  p.context.reconcileWatch();
  assert.equal(p.watched(), 0, 'polling a failed session never opens a screen');
});

test('Retry sends one HTTP request and resumes watching the same repaired session', async () => {
  const p = page();
  p.context.reconcileWatch();
  let resolve;
  p.context.fetch = (...args) => { p.requests.push(args); return new Promise((r) => { resolve = r; }); };
  const pending = p.context.retrySession('repair');
  assert.equal(p.el('.watch .restart').disabled, true);
  await p.context.retrySession('repair');
  assert.equal(p.requests.length, 1);
  assert.equal(p.requests[0][0], '/v1/agents/repair/retry');
  assert.equal(p.requests[0][1].method, 'POST');
  resolve({ ok: true, status: 202 });
  await pending;
  assert.equal(p.context.lastAgents[0].status, 'starting');
  assert.equal(p.el('.session-error').hidden, true);
  assert.equal(p.watched(), 1);
  assert.equal(p.context.retryPending, null);
});

test('missing sessions stop reconnecting; a returning machine can resume watching', () => {
  const p = page();
  p.context.lastAgents = [];
  p.context.reconcileWatch();
  assert.equal(p.el('.session-connection').textContent, 'Session unavailable');
  assert.equal(p.timers.size, 0);
  assert.equal(p.watched(), 0);
  p.context.lastAgents = [{ name: 'repair', host: 'machine', status: 'running' }];
  p.context.reconcileWatch();
  assert.equal(p.watched(), 1);
});

test('read-only members cannot retry and HTTP errors leave recovery available', async () => {
  const p = page();
  p.context.me.read_only = true;
  p.context.drawSession();
  assert.equal(p.el('.watch .restart').hidden, true);
  await p.context.retrySession('repair');
  assert.equal(p.requests.length, 0);
  p.context.me.read_only = false;
  p.context.fetch = async () => ({ ok: false, status: 503, text: async () => 'host went away' });
  await p.context.retrySession('repair');
  assert.equal(p.messages.at(-1), 'host went away');
  assert.equal(p.el('.watch .restart').disabled, false);
  assert.equal(p.context.lastAgents[0].status, 'failed');
});

test('late Retry responses cannot change another route or a signed-out page', async () => {
  for (const change of ['route', 'auth', 'error body']) {
    const p = page();
    let resolve;
    p.context.fetch = () => new Promise((r) => { resolve = r; });
    const pending = p.context.retrySession('repair');
    if (change === 'route') p.context.selected = 'other';
    if (change === 'auth') { p.context.signedIn = false; p.context.authRun++; }
    if (change === 'error body') {
      let resolveBody, entered;
      const bodyStarted = new Promise((r) => { entered = r; });
      resolve({ ok: false, status: 503, text: () => new Promise((r) => { resolveBody = r; entered(); }) });
      await bodyStarted;
      p.context.selected = 'other';
      resolveBody('private diagnostic');
    } else resolve({ ok: true, status: 202 });
    await pending;
    assert.equal(p.context.lastAgents[0].status, 'failed', change);
    assert.equal(p.watched(), 0, change);
    assert.equal(p.messages.length, 0, change);
  }
});
