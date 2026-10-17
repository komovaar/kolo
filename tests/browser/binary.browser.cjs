const { installTerminalProbe } = require('./terminal-probe.cjs');
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
    await promisify(execFile)('go', ['build', '-o', binary, './cmd/kolo'], { cwd: path.join(__dirname, '../..') });
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
    await installTerminalProbe(page);
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
    await page.waitForFunction(() => location.hash.slice('#/agent/'.length) === 'binary-shell' && (document.querySelector('.session-connection').textContent === 'Live connection') &&
      document.querySelector('.session-connection').textContent === 'Live connection');
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('printf "terminal output: %s\\n" "$((17 * 19))"');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => Array.from({ length: window.testTerminal.buffer.active.length }, (_, i) =>
      window.testTerminal.buffer.active.getLine(i).translateToString()).join('\n').includes('terminal output: 323'));
    // Two tabs of the same member must still own separate view preferences
    // and clipboards. A passive tab cannot resize the real PTY.
    const second = await browser.newPage({ viewport: { width: 900, height: 650 },
      storageState: await page.context().storageState() });
    await installTerminalProbe(second);
    for (const client of [page, second]) {
      await client.addInitScript(() => {
        window.terminalCopies = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true,
          value: { writeText: async (text) => window.terminalCopies.push(text) } });
      });
    }
    await page.evaluate(() => {
      window.terminalCopies = [];
      Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { writeText: async (text) => window.terminalCopies.push(text) } });
    });
    await second.goto(`${origin}/#/agent/binary-shell`);
    await second.waitForFunction(() => document.querySelector('.session-connection').textContent === 'Live connection');
    const originalGrid = await page.evaluate(() => [window.testTerminal.cols, window.testTerminal.rows]);
    await second.locator('.zoom .in').click();
    await second.setViewportSize({ width: 1000, height: 700 });
    await second.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await page.evaluate(() => [window.testTerminal.cols, window.testTerminal.rows]), originalGrid,
      'a passive browser changed the app layout');
    await second.locator('.xterm-helper-textarea').focus();
    await second.keyboard.type("stty size; printf 'participant clipboard: \\342\\234\\223' | pbcopy");
    await second.keyboard.press('Enter');
    await second.waitForFunction(() => window.terminalCopies.length === 1);
    assert.deepEqual(await second.evaluate(() => window.terminalCopies), ['participant clipboard: ✓']);
    assert.deepEqual(await page.evaluate(() => window.terminalCopies), [], 'another tab received the app clipboard');
    const secondGrid = await second.evaluate(() => [window.testTerminal.cols, window.testTerminal.rows]);
    assert.ok(secondGrid[0] < originalGrid[0], 'typing did not adopt the second browser viewport');
    assert.deepEqual(await page.evaluate(() => [window.testTerminal.cols, window.testTerminal.rows]), secondGrid);
    await second.close();
    await page.reload();
    await page.waitForFunction(() => location.hash.slice('#/agent/'.length) === 'binary-shell' && (document.querySelector('.session-connection').textContent === 'Live connection'));
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
    await page.waitForFunction(() => !document.querySelector('.groups [aria-current=page]'));
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
