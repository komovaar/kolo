const assert = require('node:assert/strict');
const test = require('node:test');
const { Terminal } = require('../internal/hub/ui/assets/xterm.js');
require('../internal/hub/ui/assets/terminal-queries.js');

const write = (term, data) => new Promise((resolve) => term.write(data, resolve));

test('viewers never send automatic terminal query answers', async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  KoloTerminalQueries.hostReplies(term);
  const answers = [];
  term.onData((data) => answers.push(data));
  await write(term, '\x1b[5n\x1b[6n\x1b[?6n\x1b[c\x1b[>c\x1bZ' +
    '\x1b[18t\x1b[?2004$p\x1b[4$p\x1bP$qm\x1b\\' +
    '\x1b]4;1;?\x07\x1b]10;?\x07\x1b]11;?\x07\x1b]12;?\x07');
  assert.deepEqual(answers, []);
  term.dispose();
});

test('query suppression preserves mode changes and user paste', async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  KoloTerminalQueries.hostReplies(term);
  await write(term, '\x1b[?1;2004;1004h\x1b=ready');
  assert.equal(term.modes.applicationCursorKeysMode, true);
  assert.equal(term.modes.applicationKeypadMode, true);
  assert.equal(term.modes.bracketedPasteMode, true);
  assert.equal(term.modes.sendFocusMode, true);
  const keys = [];
  term.onData((data) => keys.push(data));
  term._core.textarea = { value: '' };
  term.paste('first\nsecond');
  assert.deepEqual(keys, ['\x1b[200~first\rsecond\x1b[201~']);
  term.dispose();
});
