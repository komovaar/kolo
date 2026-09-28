const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// Exercise the page's actual refresh function with independently delayed HTTP
// headers and bodies: an old body must not resurrect stale attention state.
const html = fs.readFileSync(path.join(__dirname, '../internal/hub/ui/index.html'), 'utf8');
const refresh = html.match(/async function refresh\(\) \{[\s\S]*?\n\}/)[0];
const data = (name) => ({ you: { name: 'Dana' }, hosts: [], agents: [{ name }] });
const response = (value) => ({ status: 200, ok: true, json: async () => value });

function page() {
  const updates = [], screens = [];
  let resets = 0;
  const context = vm.createContext({
    refreshRun: 0, signedIn: false, renamingId: null, location: { search: '' },
    el: () => ({ classList: { toggle() {} } }),
    show: (name) => screens.push(name), drawGroups() {}, drawChoices() {}, drawHome() {}, drawSession() {}, applyAccess() {},
    attention: { update: (agents) => updates.push(agents[0].name), reset: () => { resets++; } },
  });
  vm.runInContext(refresh, context);
  return { context, updates, screens, resets: () => resets };
}

test('an older JSON body cannot overwrite the latest agent snapshot', async () => {
  const p = page();
  let resolveOld;
  const oldBody = new Promise((resolve) => { resolveOld = resolve; });
  p.context.fetch = async () => ({ status: 200, ok: true, json: () => oldBody });
  const old = p.context.refresh();
  await Promise.resolve();
  p.context.fetch = async () => response(data('new'));
  await p.context.refresh();
  resolveOld(data('old'));
  await old;
  assert.deepEqual(p.updates, ['new']);
});

test('a body arriving after authentication expires cannot reopen the app or alert', async () => {
  const p = page();
  let resolveOld;
  const oldBody = new Promise((resolve) => { resolveOld = resolve; });
  p.context.fetch = async () => ({ status: 200, ok: true, json: () => oldBody });
  const old = p.context.refresh();
  await Promise.resolve();
  p.context.fetch = async () => ({ status: 401, ok: false });
  await p.context.refresh();
  resolveOld(data('old'));
  await old;
  assert.deepEqual(p.updates, []);
  assert.deepEqual(p.screens, ['signin']);
  assert.equal(p.resets(), 1);
});
