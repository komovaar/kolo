const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { Terminal } = require('../internal/hub/ui/assets/xterm.js');
require('../internal/hub/ui/assets/terminal-queries.js');

const html = fs.readFileSync(path.join(__dirname, '../internal/hub/ui/index.html'), 'utf8');
const functions = ['canControl', 'applyAccess', 'tell', 'createTerminal', 'resetTerminal',
  'close', 'connect', 'watch', 'signOut'];
const source = functions.map((name) => html.match(new RegExp(
  `function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0]).join('\n');
const write = (term, bytes) => new Promise((resolve) => term.write(bytes, resolve));
const flush = (term) => write(term, '');

function page() {
  const nodes = new Map(), observed = new Set(), timers = new Map(), frames = [], terminals = [];
  let nextTimer = 0;
  const el = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      children: [], classList: { toggle() {} }, replaceChildren() { this.children = []; },
    });
    return nodes.get(selector);
  };
  class HeadlessTerminal extends Terminal {
    constructor(options) { super(options); terminals.push(this); }
    open(container) {
      // Only mounting/rendering is stubbed. The vendored parser, write buffer,
      // decoder, modes and user-input encoding all run unchanged.
      const screen = {};
      Object.defineProperty(this, 'element', { value: { querySelector: () => screen, contains: () => false } });
      this._core.textarea = { value: '' };
      container.children.push(this.element);
    }
    loadAddon() {}
    onData(callback) { this.inputCallback = callback; return super.onData(callback); }
  }
  class Socket {
    static OPEN = 1;
    readyState = 0;
    send(data) { frames.push(JSON.parse(data)); }
    open() { this.readyState = 1; this.onopen(); }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const context = vm.createContext({
    retryPending: null, agentInURL: () => null, canWatch: () => true,
    signedIn: true, authLost: false, authRun: 0, refreshRun: 0,
    me: { name: 'Artem', read_only: false }, hosts: [], lastAgents: [],
    socket: null, watching: null, terminalOwner: null, screenReady: false,
    reconnectTimer: null, typist: null, renamingId: null,
    location: { protocol: 'http:', host: 'localhost', search: '' },
    document: { activeElement: null },
    Terminal: HeadlessTerminal, CanvasAddon: { CanvasAddon: class {} },
    KoloTerminalQueries, baseFont: 13, WebSocket: Socket, Uint8Array, console, el,
    watcher: { observe: (node) => observed.add(node), unobserve: (node) => observed.delete(node) },
    fit() {}, keyboardChanged() {}, say() {}, describe() {}, drawSession() {},
    closeCreate() {}, attention: { reset() {} }, show() {}, refresh: async () => null,
    setTimeout: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(source, context);
  context.term = context.createTerminal();
  context.watcher.observe(context.term.element.querySelector('.xterm-screen'));
  const binary = (socket, text) => socket.onmessage({ data: Uint8Array.from(
    typeof text === 'string' ? Buffer.from(text) : text).buffer });
  const connected = (name) => {
    context.watch(name);
    const socket = context.socket;
    socket.open();
    return socket;
  };
  return { context, el, frames, observed, timers, terminals, binary, connected,
    dispose() { context.close(); context.term.dispose(); } };
}

function text(term) {
  const buffer = term.buffer.active;
  return Array.from({ length: buffer.length }, (_, y) => buffer.getLine(y).translateToString()).join('\n');
}

test('switching between shell and TUI resets modes and keeps one terminal mounted', async () => {
  const p = page();
  try {
    for (let i = 0; i < 3; i++) {
      const tui = p.connected('tui');
      p.binary(tui, '\x1b[?1049h\x1b[?1;2004;1004;1002;1006h\x1b=old TUI');
      await flush(p.context.term);
      assert.equal(p.context.term.buffer.active.type, 'alternate');
      assert.equal(p.context.term.modes.bracketedPasteMode, true);
      const old = p.context.term;
      const shell = p.connected('shell');
      p.binary(shell, 'new shell');
      await flush(p.context.term);
      assert.notEqual(p.context.term, old);
      assert.equal(p.context.term.buffer.active.type, 'normal');
      for (const mode of ['applicationCursorKeysMode', 'applicationKeypadMode', 'bracketedPasteMode', 'sendFocusMode']) {
        assert.equal(p.context.term.modes[mode], false, mode);
      }
      assert.equal(p.context.term.modes.mouseTrackingMode, 'none');
      assert.ok(text(p.context.term).includes('new shell'));
      assert.ok(!text(p.context.term).includes('old TUI'));
      assert.equal(p.observed.size, 1);
      assert.equal(p.el('#term').children.length, 1);
      const before = p.frames.length;
      old.inputCallback('old keys');
      assert.equal(p.frames.length, before, 'detached terminal cannot send to the new session');
      p.context.term.paste('one\ntwo');
      assert.equal(p.frames.at(-1).keys, 'one\rtwo', 'shell paste has no TUI brackets');
    }
  } finally { p.dispose(); }
});

test('old buffered output and partial parsers cannot affect a new session', async () => {
  for (const [name, oldBytes, parsed] of [
    ['queued mode changes', '\x1b[?1049h\x1b[?1;2004hOLD queued screen', false],
    ['partial CSI', '\x1b[?2004;', true],
    ['partial OSC', '\x1b]0;old unfinished title', true],
    ['partial UTF-8', new Uint8Array([0xe2, 0x82]), true],
  ]) {
    const p = page();
    try {
      const oldSocket = p.connected('old');
      const old = p.context.term;
      p.binary(oldSocket, oldBytes);
      if (parsed) await flush(old);
      const current = p.connected('new');
      p.binary(current, 'NEW clean screen');
      p.binary(oldSocket, 'LATE old message');
      oldSocket.onopen(); oldSocket.onclose();
      await Promise.all([flush(old), flush(p.context.term)]);
      assert.ok(text(p.context.term).startsWith('NEW clean screen'), name);
      assert.ok(!text(p.context.term).includes('OLD'), name);
      assert.ok(!text(p.context.term).includes('LATE'), name);
      assert.equal(p.context.term.buffer.active.type, 'normal', name);
      assert.equal(p.context.term.modes.bracketedPasteMode, false, name);
      assert.equal(p.context.screenReady, true, name);
      assert.equal(p.el('.session-connection').textContent, 'Live connection', name);
      assert.equal(p.timers.size, 0, name);
    } finally { p.dispose(); }
  }
});

test('input waits for snapshot parsing and disconnect cannot be undone by its callback', async () => {
  const p = page();
  try {
    const socket = p.connected('screen');
    assert.equal(p.context.tell({ type: 'keys', keys: 'too early' }), false);
    assert.equal(p.context.term.options.disableStdin, true);
    assert.equal(p.el('.session-connection').textContent, 'Restoring screen…');
    p.binary(socket, '\x1b[?1;2004hready');
    assert.equal(p.context.tell({ type: 'keys', keys: 'still too early' }), false);
    await flush(p.context.term);
    assert.equal(p.context.tell({ type: 'keys', keys: 'ready' }), true);
    assert.equal(p.context.term.options.disableStdin, false);
    const old = p.context.term;
    // A restart/reconnect owns a fresh terminal, even for the same name.
    p.context.connect('screen');
    assert.notEqual(p.context.term, old);
    const replacement = p.context.socket;
    replacement.open();
    p.binary(replacement, 'snapshot still queued');
    replacement.close();
    await flush(p.context.term);
    assert.equal(p.context.screenReady, false);
    assert.equal(p.context.term.options.disableStdin, true);
    assert.equal(p.el('.session-connection').textContent, 'Reconnecting…');
    assert.equal(p.context.tell({ type: 'keys', keys: 'disconnected' }), false);
  } finally { p.dispose(); }
});

test('sign-out detaches buffered private output and leaves an empty terminal', async () => {
  const p = page();
  try {
    const socket = p.connected('private');
    const old = p.context.term;
    p.binary(socket, '\x1b[?1049hprivate queued output');
    p.context.signOut();
    await Promise.all([flush(old), flush(p.context.term)]);
    assert.ok(!text(p.context.term).includes('private'));
    assert.equal(p.context.term.buffer.active.type, 'normal');
    assert.equal(p.context.screenReady, false);
    assert.equal(p.context.term.options.disableStdin, true);
    assert.equal(p.context.socket, null);
    assert.equal(p.context.watching, null);
  } finally { p.dispose(); }
});
