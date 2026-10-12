const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../internal/hub/ui/index.html'), 'utf8');
const source = ['drawChoices', 'fill'].map((name) =>
  html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0]).join('\n');
const host = (id, extra = {}) => ({ id, dirs: ['/work'], allow: ['sh'], ...extra });

function page(hosts) {
  const nodes = new Map(), picks = [];
  const el = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: '', children: [], classList: { toggle() {} },
      replaceChildren() { this.children = []; this.value = ''; },
      append(child) { this.children.push(child); if (!this.value) this.value = child.value; },
    });
    return nodes.get(selector);
  };
  const context = vm.createContext({
    hosts, el, choicesSnapshot: '', createHostPref: null, createPending: false,
    document: { createElement: () => ({}) },
    drawKindPicker: (commands) => picks.push(commands),
    say: (selector, message) => { el(selector).textContent = message; },
  });
  vm.runInContext(source, context);
  return { context, el, picks };
}

test('a machine-specific action overrides the previously selected machine', () => {
  const p = page([host('old'), host('chosen', { allow: ['claude'] })]);
  p.el('#new-host').value = 'old';
  p.context.createHostPref = 'chosen';
  p.context.drawChoices();
  assert.equal(p.el('#new-host').value, 'chosen');
  assert.deepEqual(p.picks, [['claude']]);
});

test('unchanged polling preserves program controls and server error feedback', () => {
  const p = page([host('devbox')]);
  p.context.drawChoices();
  const option = p.el('#new-dir').children[0];
  p.el('.dialog-note').textContent = 'That session name is already in use.';
  p.context.drawChoices();
  assert.equal(p.picks.length, 1);
  assert.equal(p.el('#new-dir').children[0], option);
  assert.match(p.el('.dialog-note').textContent, /already in use/);
});

test('missing programs or directories disable creation without breaking the form', () => {
  for (const hosts of [[], [host('empty', { allow: null })], [host('empty', { dirs: [] })]]) {
    const p = page(hosts);
    p.context.drawChoices();
    assert.equal(p.el('form.create button[type=submit]').disabled, true);
    assert.ok(p.el('.dialog-note').textContent);
  }
});

test('polling cannot re-enable submission while creation is in flight', () => {
  const p = page([host('devbox')]);
  p.context.drawChoices();
  p.context.createPending = true;
  p.el('form.create button[type=submit]').disabled = true;
  p.context.hosts = [host('another')];
  p.context.drawChoices();
  assert.equal(p.el('form.create button[type=submit]').disabled, true);
  assert.equal(p.el('#new-host').value, 'devbox');
});

const createSource = html.match(/async function createSession\(ev\) \{[\s\S]*?\n\}/)[0];
function creationPage(fetch, refresh) {
  const submit = { disabled: false }, notes = [];
  const request = { name: 'work', host: 'devbox', dir: '/work', command: 'sh' };
  const context = vm.createContext({
    canControl: () => true, signedIn: true, authRun: 0, createPending: false,
    pickedCommand: 'sh', fetch, refresh, location: {},
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
