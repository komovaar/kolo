const { fixture, bind } = require('../../../test/controller.cjs');
const assert = require('node:assert/strict');

const test = require('node:test');

function page({ inside = true, available = true, disabled = false } = {}) {
  const focused = [], key = '["agent","devbox","work","created"]';
  const replacement = { dataset: { focusKey: key }, disabled,
    getClientRects: () => [1], focus: (options) => focused.push(['session', options]) };
  const container = { scrollTop: 120, contains: () => inside,
    querySelectorAll: () => available ? [replacement] : [] };
  const home = { focus: (options) => focused.push(['home', options]) };
  const context = fixture({
    document: { activeElement: { dataset: { focusKey: key } } },
    el: (selector) => selector === '.groups' ? container : home,
    renderGroups: () => { container.scrollTop = 0; },
  });
  bind(context, ["drawGroups"]);
  return { context, container, focused };
}

test('sidebar refresh restores the same control and scroll position', () => {
  const p = page(); p.context.drawGroups([]);
  assert.equal(p.focused[0][0], 'session');
  assert.equal(p.focused[0][1].preventScroll, true);
  assert.equal(p.container.scrollTop, 120);
});

test('removed or disabled controls return focus to workspace navigation', () => {
  for (const options of [{ available: false }, { disabled: true }]) {
    const p = page(options); p.context.drawGroups([]);
    assert.equal(p.focused[0][0], 'home');
  }
});

test('polling never takes focus from the terminal or other controls', () => {
  const p = page({ inside: false }); p.context.drawGroups([]);
  assert.equal(p.focused.length, 0);
});
