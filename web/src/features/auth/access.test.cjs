const { fixture, bind } = require('../../../test/controller.cjs');
const assert = require('node:assert/strict');

const test = require('node:test');

function page(readOnly) {
  const nodes = new Map(), frames = [], messages = [];
  let closed = 0, requests = 0, confirmations = 0;
  const el = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { hidden: false, disabled: false });
    return nodes.get(selector);
  };
  const context = fixture({
    retryPending: null, agentInURL: () => null, lastAgents: [], hosts: [],
    signedIn: true, me: { read_only: readOnly }, term: { options: {} }, screenReady: true,
    renamingId: 'api', WebSocket: { OPEN: 1 },
    socket: { readyState: 1, send: (data) => frames.push(JSON.parse(data)) },
    el, closeCreate: () => { closed++; el('.scrim').hidden = true; },
    say: (_, text) => messages.push(text),
    fetch: () => { requests++; }, confirm: () => { confirmations++; return true; },
  });
  bind(context, ["canControl","applyAccess","tell","startRename","openCreate","stop"]);
  return { context, el, frames, messages, closed: () => closed,
    requests: () => requests, confirmations: () => confirmations };
}

test('read-only refresh disables input, hides actions and closes pending edits', () => {
  const p = page(true);
  p.context.applyAccess();
  assert.equal(p.context.term.options.disableStdin, true);
  assert.equal(p.el('.home-new').hidden, true);
  assert.equal(p.el('.watch .restart').hidden, true);
  assert.equal(p.el('.watch .restart').disabled, true);
  assert.equal(p.context.renamingId, null);
  assert.equal(p.closed(), 1);
});

test('promoting then demoting access updates the existing terminal controls', () => {
  const p = page(true);
  p.context.applyAccess();
  p.context.me.read_only = false;
  p.context.applyAccess();
  assert.equal(p.context.term.options.disableStdin, false);
  assert.equal(p.el('.home-new').hidden, false);
  assert.equal(p.el('.watch .restart').disabled, false);
  p.context.me.read_only = true;
  p.context.applyAccess();
  assert.equal(p.el('.watch .restart').hidden, true);
  assert.equal(p.context.term.options.disableStdin, true);
});

test('read-only control attempts never send frames, requests, or confirmation prompts', async () => {
  const p = page(true);
  for (const type of ['keys', 'interrupt', 'restart', 'fresh']) {
    assert.equal(p.context.tell({ type, keys: 'hello' }), false);
  }
  p.context.startRename({ name: 'other' });
  p.context.openCreate('devbox');
  await p.context.stop('api');
  assert.deepEqual(p.frames, []);
  assert.equal(p.requests(), 0);
  assert.equal(p.confirmations(), 0);
  assert.equal(p.context.renamingId, 'api');
});

test('existing members can type; signed-out members cannot', () => {
  const p = page(undefined);
  assert.equal(p.context.tell({ type: 'keys', keys: 'hello' }), true);
  assert.deepEqual(p.frames, [{ type: 'keys', keys: 'hello' }]);
  p.context.signedIn = false;
  assert.equal(p.context.tell({ type: 'keys', keys: 'again' }), false);
  p.context.applyAccess();
  assert.equal(p.frames.length, 1);
  assert.equal(p.context.term.options.disableStdin, true);
});
