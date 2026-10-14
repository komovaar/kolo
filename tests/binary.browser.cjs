// Exercise the released architecture: a binary in an empty directory serves
// its embedded React UI, API, and a real PTY without a frontend server.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, rm, mkdir } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { chromium, firefox } = require('playwright');

test('standalone binary serves React, joins members, and controls a real terminal', { timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'kolo-browser-binary-'));
  const binary = path.join(directory, 'kolo');
  let hub, browser, page, origin;
  try {
    await promisify(execFile)('go', ['build', '-o', binary, './cmd/kolo'], { cwd: path.join(__dirname, '..') });
    hub = spawn(binary, ['up', '-addr', '127.0.0.1:0', '-name', 'Binary review',
      '-org', path.join(directory, 'org.json'), '-state', path.join(directory, 'agents.json'),
      '-dir', directory, '-allow', 'sh'], { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
    // Do not log the invite or credentials. Resolve only after both are ready.
    const invite = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Test hub did not start')), 15000);
      hub.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Test hub exited (${code})`)); });
      hub.stderr.resume();
      hub.stdout.on('data', (chunk) => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/join#(kolo_[A-Za-z0-9_-]+)/);
        if (match) { clearTimeout(timeout); origin = `http://127.0.0.1:${match[1]}`; resolve(match[2]); }
      });
    });
    const engine = process.env.KOLO_BROWSER === 'firefox' ? firefox : chromium;
    browser = await engine.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [], external = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== origin) external.push(new URL(request.url()).origin);
    });
    await page.goto(`${origin}/join#${invite}`);
    await page.getByLabel('Your name').fill('Binary reviewer');
    await page.getByRole('button', { name: 'Join workspace' }).click();
    await page.locator('.home').waitFor({ state: 'visible' });
    await page.locator('.home-new').click();
    await page.locator('#new-name').fill('binary-shell');
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    await page.waitForFunction(() => watching === 'binary-shell' && screenReady &&
      document.querySelector('.session-connection').textContent === 'Live connection');
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('printf "terminal output: %s\\n" "$((17 * 19))"');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Array.from({ length: term.buffer.active.length }, (_, i) =>
      term.buffer.active.getLine(i).translateToString()).join('\n').includes('terminal output: 323'));
    await page.reload();
    await page.waitForFunction(() => watching === 'binary-shell' && screenReady);
    await page.locator('.switch-open').click();
    await page.getByRole('combobox').fill('binary-shell');
    assert.equal(await page.getByRole('option').count(), 1);
    await page.keyboard.press('Escape');
    await page.getByLabel('Share session', { exact: true }).click();
    assert.equal(await page.getByLabel('Session link', { exact: true }).inputValue(), `${origin}/#/agent/binary-shell`);
    await page.keyboard.press('Escape');
    if (process.env.KOLO_SCREENSHOT_DIR) {
      await mkdir(process.env.KOLO_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.KOLO_SCREENSHOT_DIR, 'standalone-binary.png') });
    }
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByLabel('Stop session', { exact: true }).click();
    await page.waitForFunction(() => !lastAgents.some((agent) => agent.name === 'binary-shell'));
    assert.deepEqual(errors, []);
    assert.deepEqual(external, [], 'all UI assets must come from the embedded server');
  } finally {
    // A failed assertion must not leave the persistent session daemon behind.
    if (page && origin) await page.request.delete(`${origin}/v1/agents/binary-shell`).catch(() => {});
    await browser?.close();
    if (hub && hub.exitCode === null) await new Promise((resolve) => {
      const timeout = setTimeout(() => hub.kill('SIGKILL'), 5000);
      hub.once('exit', () => { clearTimeout(timeout); resolve(); });
      hub.kill('SIGINT');
    });
    await rm(directory, { recursive: true, force: true });
  }
});
