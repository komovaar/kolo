const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../internal/hub/ui/index.html'), 'utf8');
const source = ['sessionState', 'describe', 'programOf', 'programKind'].map((name) =>
  html.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))[0]).join('\n');
const page = vm.createContext({ canControl: () => true });
vm.runInContext(source, page);

test('lifecycle and connectivity take precedence over stale terminal activity', () => {
  const agent = { status: 'failed', screen_state: 'busy' };
  assert.equal(page.sessionState(agent).label, 'Failed');
  assert.equal(page.sessionState({ ...agent, status: 'starting' }).label, 'Starting');
  assert.equal(page.sessionState({ ...agent, status: 'running' }, false).label, 'Machine disconnected');
  assert.equal(page.sessionState(null).label, 'Session unavailable');
});

test('unknown activity does not claim that a running session is ready or working', () => {
  for (const screen_state of [undefined, 'unknown', 'future-state']) {
    assert.equal(page.sessionState({ status: 'running', screen_state }).label, 'Running · activity unknown');
  }
  assert.equal(page.sessionState({ status: 'running', screen_state: 'dialog' }).label, 'Waiting for input');
});

test('input guidance respects read-only access and unknown activity', () => {
  page.canControl = () => true;
  assert.match(page.describe('dialog'), /Type in the terminal/);
  page.canControl = () => false;
  assert.match(page.describe('dialog'), /member with control access/);
  assert.match(page.describe('idle'), /read-only/);
  assert.match(page.describe('unknown'), /Activity detection is unavailable/);
});

test('shells and arbitrary commands are not presented as AI agents', () => {
  assert.equal(page.programKind('/bin/bash -l'), 'Shell');
  assert.equal(page.programKind('C:\\tools\\pwsh.exe'), 'Shell');
  assert.equal(page.programKind('claude --model opus'), 'AI agent');
  assert.equal(page.programKind('codex'), 'AI agent');
  assert.equal(page.programKind('npm run dev'), 'Command');
  assert.equal(page.programKind(null), 'Command');
});
