const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../internal/hub/ui/index.html'), 'utf8');
const source = ['signOut', 'close', 'connect', 'refresh', 'drawLog'].map((name) =>
  html.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0]).join('\n');

function page() {
  const nodes = new Map(), timers = new Map(), writes = [], views = [], sockets = [];
  let resets = 0, closed = 0, nextTimer = 0;
  const el = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      textContent: 'private', children: ['private'], classList: { toggle() {} },
      replaceChildren() { this.children = []; },
    });
    return nodes.get(selector);
  };
  class Socket {
    static OPEN = 1;
    constructor() { sockets.push(this); this.readyState = 1; }
    close() { closed++; this.readyState = 3; this.onclose?.(); }
  }
  const context = vm.createContext({
    retryPending: null, canWatch: () => true,
    signedIn: true, authLost: false, refreshRun: 0, authRun: 0,
    me: { name: 'Dana' }, hosts: [{ id: 'private' }], lastAgents: [{ name: 'private' }],
    watching: 'private', socket: null, reconnectTimer: null, typist: 'Dana', renamingId: null,
    terminalOwner: null, screenReady: false,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    WebSocket: Socket, Uint8Array, el, keyboardChanged() {}, say() {}, fit() {}, describe() {},
    setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
    term: { write: (data) => writes.push(data), reset: () => { resets++; } },
    resetTerminal() { resets++; context.terminalOwner = null; context.screenReady = false; },
    applyAccess() {}, show: (view) => views.push(view), attention: { reset() {} },
  });
  vm.runInContext(source, context);
  return { context, el, timers, writes, views, sockets, resets: () => resets, closed: () => closed };
}

test('authentication loss closes the terminal, clears private state, and stays signed out', async () => {
  const p = page();
  p.context.connect('private');
  const socket = p.context.socket;
  p.context.fetch = async () => ({ status: 401 });
  await p.context.refresh();
  assert.equal(p.closed(), 1);
  assert.equal(p.context.socket, null);
  assert.equal(p.context.watching, null);
  assert.equal(p.context.signedIn, false);
  assert.equal(p.context.me.name, undefined);
  assert.equal(p.context.hosts.length, 0);
  assert.equal(p.context.lastAgents.length, 0);
  assert.equal(p.resets(), 1);
  for (const selector of ['.groups', '.host-cards', '.log-rows']) {
    assert.deepEqual(p.el(selector).children, []);
  }
  assert.deepEqual(p.views, ['signin']);
  socket.onmessage({ data: new ArrayBuffer(1) });
  assert.deepEqual(p.writes, []);
  p.context.fetch = () => { throw new Error('signed-out page tried to authenticate again'); };
  await p.context.refresh();
  p.context.watching = 'private';
  p.context.connect('private');
  assert.equal(p.sockets.length, 1);
});

test('sign-out cancels reconnects and makes an already queued callback harmless', () => {
  const p = page();
  p.context.fetch = async () => ({ status: 503, ok: false });
  p.context.connect('private');
  p.context.socket.onclose();
  assert.equal(p.timers.size, 1);
  const queued = [...p.timers.values()][0];
  p.context.signOut();
  assert.equal(p.timers.size, 0);
  queued();
  assert.equal(p.sockets.length, 1);
});

test('a delayed activity-log body cannot restore private output after sign-out', async () => {
  const p = page();
  let resolveBody;
  let bodyStarted;
  const started = new Promise((resolve) => { bodyStarted = resolve; });
  const body = new Promise((resolve) => { resolveBody = resolve; });
  p.context.fetch = async () => ({ status: 200, ok: true,
    json: () => { bodyStarted(); return body; },
  });
  const pending = p.context.drawLog();
  await started;
  p.context.signOut();
  resolveBody({ entries: [{ text: 'private' }] });
  await pending;
  assert.deepEqual(p.el('.log-rows').children, []);
});
