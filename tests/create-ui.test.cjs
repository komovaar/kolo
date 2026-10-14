const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../internal/hub/ui/assets/session-controller.js'), 'utf8');
const model = import('../public/app/features/sessions/creation-model.ts');
const host = (id, extra = {}) => ({ id, dirs: ['/work'], allow: ['sh'], ...extra });
const initial = { open: true, pending: false, hosts: [], allowed: true, host: '', dir: '', command: '', name: '', message: '', problem: false };

test('machine-specific creation selects the requested host and its defaults', async () => {
  const { reconcileCreation } = await model;
  const state = reconcileCreation({ ...initial, host: 'old' }, [host('old'), host('chosen', { allow: ['claude'], dirs: ['/other'] })], true, 'chosen');
  assert.equal(state.host, 'chosen');
  assert.equal(state.command, 'claude');
  assert.equal(state.dir, '/other');
});

test('polling preserves typed creation drafts and error feedback', async () => {
  const { reconcileCreation } = await model;
  const state = { ...initial, host: 'devbox', dir: '/custom/project', name: 'review', command: 'sh', message: 'Name already used' };
  const next = reconcileCreation(state, [host('devbox')], true);
  assert.equal(next.dir, state.dir);
  assert.equal(next.name, state.name);
  assert.equal(next.message, state.message);
});

test('creation requires control access, available programs, and directories', async () => {
  const { creationReady, reconcileCreation } = await model;
  for (const hosts of [[], [host('empty', { allow: null })], [host('empty', { dirs: [] })]]) {
    assert.equal(creationReady(reconcileCreation(initial, hosts, true)), false);
  }
  assert.equal(creationReady(reconcileCreation(initial, [host('one')], false)), false);
});

test('polling cannot replace an in-flight creation request', async () => {
  const { reconcileCreation, creationReady } = await model;
  const state = { ...initial, pending: true, host: 'devbox' };
  assert.equal(reconcileCreation(state, [host('another')], true), state);
  assert.equal(creationReady(state), false);
});

const createSource = html.match(/async function createSession\(ev\) \{[\s\S]*?\n\}/)[0];
function creationPage(fetch, refresh) {
  const submit = { disabled: false }, notes = [];
  const request = { name: 'work', host: 'devbox', dir: '/work', command: 'sh' };
  const context = vm.createContext({
    canControl: () => true, signedIn: true, authRun: 0, createPending: false,
    document: { activeElement: null },
    fetch, refresh, location: {},
    window: { KoloUI: { creation: { command: 'sh', setPending: (pending) => { submit.disabled = pending; } } } },
    FormData: class { get(key) { return request[key]; } },
    el: () => ({ hidden: true }), say: (_, text) => notes.push(text),
    closeCreate() { context.closed = true; }, drawChoices() {},
  });
  vm.runInContext(createSource, context);
  return { context, notes, request, submit, event: { preventDefault() {}, target: { querySelector: () => submit } } };
}

test('a lost create response opens the matching session found by reconciliation', async () => {
  const p = creationPage(async () => { throw Error('lost response'); }, async () => ({ agents: [p.request] }));
  await p.context.createSession(p.event);
  assert.equal(p.context.location.hash, '#/agent/work');
  assert.equal(p.context.closed, true);
  assert.equal(p.submit.disabled, false);
});

test('unreadable successful response reports uncertainty when reconciliation cannot confirm it', async () => {
  const p = creationPage(async () => ({ ok: true, json: async () => { throw Error('broken body'); } }), async () => null);
  await p.context.createSession(p.event);
  assert.match(p.notes[0], /Could not confirm/);
  assert.doesNotMatch(p.notes[0], /Nothing was created/);
  assert.equal(p.context.location.hash, undefined);
});

test('creation does not open private sessions after sign-out', async () => {
  const p = creationPage(async () => { p.context.authRun++; return { ok: true }; }, async () => ({ agents: [p.request] }));
  await p.context.createSession(p.event);
  assert.equal(p.context.location.hash, undefined);
});


test('changing machines resets directories and handles unrestricted commands', async () => {
  const { reconcileCreation } = await model;
  const hosts = [host('one'), host('two', { allow: ['*'], dirs: ['*'] })];
  const state = reconcileCreation({ ...initial, host: 'one', dir: '/custom/project', command: 'sh' }, hosts, true, 'two');
  assert.equal(state.dir, '');
  assert.equal(state.command, '');
  const next = reconcileCreation({ ...state, dir: '/typed', command: 'bash' }, hosts, true);
  assert.equal(next.dir, '/typed');
  assert.equal(next.command, 'bash');
});

test('automatic names are valid and unique even for non-Latin folder names', () => {
  const context = vm.createContext({ crypto: require('node:crypto').webcrypto, programOf: () => 'codex' });
  vm.runInContext(html.match(/function automaticSessionName\([^)]*\) \{[\s\S]*?\n\}/)[0], context);
  const names = new Set();
  for (let i = 0; i < 100; i++) {
    const name = context.automaticSessionName('codex', '/work/Проєкт with a long folder name');
    assert.match(name, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
    assert.ok(name.length <= 32);
    names.add(name);
  }
  assert.equal(names.size, 100);
});
