const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Terminal } = require('../../hub/ui/assets/xterm.js');
require('../../hub/ui/assets/terminal-queries.js');

const write = (term, data) => new Promise((resolve) => term.write(data, resolve));

function cells(term) {
  const buffer = term.buffer.active;
  return Array.from({ length: term.rows }, (_, y) =>
    Array.from({ length: term.cols }, (_, x) => {
      const cell = buffer.getLine(buffer.baseY + y).getCell(x);
      let fg = cell.getFgColor(), bg = cell.getBgColor();
      let palette = cell.isFgPalette();
      if (fg < 0) fg = 256;
      if (bg < 0) bg = 257;
      if (cell.isInverse()) { [fg, bg] = [bg, fg]; palette = cell.isBgPalette(); }
      if (palette && cell.isBold() && fg < 8) fg += 8;
      return [cell.getChars() || ' ', fg, bg, !!cell.isBold(), !!cell.isItalic(),
        !!cell.isUnderline(), !!cell.isBlink()];
    }));
}

function state(term) {
  return { modes: term.modes, type: term.buffer.active.type,
    x: term.buffer.active.cursorX, y: term.buffer.active.cursorY, cells: cells(term) };
}

async function main() {
  const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
  for (const fixture of cases) {
    const live = new Terminal({ cols: 40, rows: 8 });
    const joined = new Terminal({ cols: 40, rows: 8 });
    KoloTerminalQueries.hostReplies(live);
    KoloTerminalQueries.hostReplies(joined);
    await write(live, fixture.input);
    await write(joined, fixture.snapshot);
    assert.deepEqual(state(joined), state(live), `${fixture.name}: snapshot`);
    const liveInput = [], joinedInput = [];
    live.onData((data) => liveInput.push(data));
    joined.onData((data) => joinedInput.push(data));
    // The public paste API encodes real input using the restored paste mode.
    // A textarea stub replaces only the DOM cleanup after encoding.
    live._core.textarea = joined._core.textarea = { value: '' };
    live.paste('one\ntwo');
    joined.paste('one\ntwo');
    assert.deepEqual(joinedInput, liveInput, `${fixture.name}: paste encoding`);
    await write(live, fixture.next);
    await write(joined, fixture.next);
    assert.deepEqual(state(joined), state(live), `${fixture.name}: subsequent output`);
    live.dispose(); joined.dispose();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
