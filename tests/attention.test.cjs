const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../internal/hub/ui/assets/attention.js'), 'utf8');
const agent = (state, extra = {}) => ({ name: 'api', label: 'API', status: 'running', screen_state: state, ...extra });

function page({ permission = 'granted', enabled = true, secure = true, supported = true,
                storageFails = false, constructorFails = false } = {}) {
  const notices = [], opened = [], attributes = {};
  let requests = 0, selected = null, focused = 0;
  const button = { setAttribute: (key, value) => { attributes[key] = value; } };
  const document = { title: 'kolo', hidden: true, hasFocus: () => true };
  const storage = new Map([['kolo.attention', enabled ? 'on' : 'off']]);
  class Notification {
    static permission = permission;
    static async requestPermission() { requests++; return this.permission; }
    constructor(title, options) {
      if (constructorFails) throw new TypeError('unsupported');
      Object.assign(this, { title, options, closed: false });
      notices.push(this);
    }
    close() { this.closed = true; }
  }
  const window = { isSecureContext: secure, Notification: supported ? Notification : undefined,
    focus: () => { focused++; } };
  const context = vm.createContext({ window, document, Notification: window.Notification,
    localStorage: {
      getItem(key) { if (storageFails) throw Error('blocked'); return storage.get(key); },
      setItem(key, value) { if (storageFails) throw Error('blocked'); storage.set(key, value); },
    },
  });
  vm.runInContext(source, context);
  const attention = new context.KoloAttention(button, () => selected, (name) => opened.push(name));
  return { attention, document, button, attributes, notices, opened, storage, Notification,
    select: (name) => { selected = name; }, requests: () => requests, focused: () => focused };
}

test('initial snapshot counts existing questions without replaying notifications', () => {
  const p = page();
  p.attention.update([agent('dialog'), agent('dialog', { name: 'web' }), agent('busy', { name: 'worker' })]);
  assert.equal(p.document.title, '(2 waiting) kolo');
  assert.equal(p.notices.length, 0);
  assert.equal(p.requests(), 0);
});

test('background transition alerts once; rename and refresh do not repeat it', () => {
  const p = page();
  p.attention.update([agent('busy')]);
  p.attention.update([agent('dialog')]);
  p.attention.update([agent('dialog', { label: 'Renamed' })]);
  assert.equal(p.notices.length, 1);
  assert.equal(p.notices[0].title, 'API needs you');
  assert.deepEqual(Object.keys(p.notices[0].options).sort(), ['body', 'icon', 'tag']);
  p.notices[0].onclick();
  assert.deepEqual(p.opened, ['api']);
  assert.equal(p.focused(), 1);
  assert.equal(p.notices[0].closed, true);
});

test('answering closes the alert and permits another question to alert', () => {
  const p = page();
  p.attention.update([agent('idle')]);
  p.attention.update([agent('dialog')]);
  p.attention.update([agent('busy')]);
  assert.equal(p.document.title, 'kolo');
  assert.equal(p.notices[0].closed, true);
  p.attention.update([agent('dialog')]);
  assert.equal(p.notices.length, 2);
});

test('the focused agent is quiet, other agents still alert', () => {
  const p = page();
  p.document.hidden = false;
  p.select('api');
  p.attention.update([agent('busy')]);
  p.attention.update([agent('dialog'), agent('dialog', { name: 'web' })]);
  assert.equal(p.notices.length, 1);
  assert.equal(p.notices[0].options.tag, 'kolo-attention-web');
  p.document.hidden = true;
  p.attention.update([agent('dialog')]);
  assert.equal(p.notices.length, 1);
});

test('visible but unfocused windows receive alerts for the selected agent', () => {
  const p = page();
  p.document.hidden = false;
  p.document.hasFocus = () => false;
  p.select('api');
  p.attention.update([agent('busy')]);
  p.attention.update([agent('dialog')]);
  assert.equal(p.notices.length, 1);
});

test('opening an agent dismisses its outstanding alert', () => {
  const p = page();
  p.attention.update([]);
  p.attention.update([agent('dialog')]);
  p.document.hidden = false;
  p.select('api');
  p.attention.update([agent('dialog')]);
  assert.equal(p.notices[0].closed, true);
});

test('missing screen state does not repeat the same question after reconnect', () => {
  const p = page();
  p.attention.update([]);
  p.attention.update([agent('dialog')]);
  p.attention.update([agent('unknown')]);
  p.attention.update([agent('dialog')]);
  assert.equal(p.notices.length, 1);
});

test('stopped and failed agents clear alerts and cannot open stale sessions', () => {
  const p = page();
  p.attention.update([]);
  p.attention.update([agent('dialog')]);
  p.attention.update([agent('dialog', { status: 'failed' })]);
  assert.equal(p.document.title, 'kolo');
  p.notices[0].onclick();
  assert.deepEqual(p.opened, []);
  p.attention.update([]);
  assert.equal(p.attention.episodes.size, 0);
});

test('reset closes notices, restores title, and establishes a fresh baseline', () => {
  const p = page();
  p.attention.update([]);
  p.attention.update([agent('dialog')]);
  p.attention.reset();
  assert.equal(p.document.title, 'kolo');
  assert.equal(p.notices[0].closed, true);
  p.notices[0].onclick();
  assert.deepEqual(p.opened, []);
  p.attention.update([agent('dialog')]);
  assert.equal(p.notices.length, 1);
});

test('alerts default off even with browser permission and enabling saves the choice', async () => {
  const p = page({ enabled: false });
  p.attention.update([]);
  p.attention.update([agent('dialog')]);
  assert.equal(p.notices.length, 0);
  await p.button.onclick();
  assert.equal(p.storage.get('kolo.attention'), 'on');
  assert.equal(p.attributes['aria-pressed'], 'true');
  p.attention.update([agent('busy')]);
  p.attention.update([agent('dialog')]);
  assert.equal(p.notices.length, 1);
  await p.button.onclick();
  assert.equal(p.storage.get('kolo.attention'), 'off');
  assert.equal(p.notices[0].closed, true);
});

test('permission is only requested by a click; dismissing the prompt keeps alerts off', async () => {
  const p = page({ permission: 'default', enabled: false });
  p.attention.update([]);
  p.attention.update([agent('dialog')]);
  assert.equal(p.requests(), 0);
  await p.button.onclick();
  assert.equal(p.requests(), 1);
  assert.equal(p.storage.get('kolo.attention'), 'off');
});

for (const options of [{ permission: 'denied' }, { secure: false }, { supported: false }]) {
  test(`unavailable alerts retain title counts: ${JSON.stringify(options)}`, async () => {
    const p = page(options);
    p.attention.update([]);
    p.attention.update([agent('dialog')]);
    assert.equal(p.button.disabled, true);
    assert.equal(p.document.title, '(1 waiting) kolo');
    await p.button.onclick();
    assert.equal(p.requests(), 0);
    assert.equal(p.notices.length, 0);
  });
}

test('revoked permission prevents further notifications', () => {
  const p = page();
  p.attention.update([]);
  p.Notification.permission = 'denied';
  p.attention.update([agent('dialog')]);
  assert.equal(p.notices.length, 0);
  assert.equal(p.button.textContent, 'desktop alerts blocked');
});

test('blocked browser storage does not break enabling or status updates', async () => {
  const p = page({ storageFails: true });
  await p.button.onclick();
  p.attention.update([]);
  p.attention.update([agent('dialog')]);
  assert.equal(p.notices.length, 1);
});

test('mobile constructor failures fall back to the tab title', () => {
  const p = page({ constructorFails: true });
  p.attention.update([]);
  p.attention.update([agent('dialog')]);
  assert.equal(p.document.title, '(1 waiting) kolo');
  assert.equal(p.button.textContent, 'desktop alerts unavailable');
});

test('permission and asynchronous display errors leave a usable page', async () => {
  const p = page({ permission: 'default', enabled: false });
  p.Notification.requestPermission = async () => { throw Error('unsupported'); };
  await p.button.onclick();
  assert.equal(p.button.textContent, 'desktop alerts unavailable');
  const q = page();
  q.attention.update([]);
  q.attention.update([agent('dialog')]);
  q.notices[0].onerror();
  assert.equal(q.notices[0].closed, true);
  assert.equal(q.button.textContent, 'desktop alerts unavailable');
});
