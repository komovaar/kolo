const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium, firefox } = require('playwright');

const root = path.join(__dirname, '../internal/hub/ui');
const fixture = {
  org: 'Layout review', you: { name: 'Reviewer', read_only: false },
  hosts: [{ id: 'devbox', dirs: ['/work/api'], allow: ['codex', 'claude', 'opencode'] }],
  agents: [{ name: 'layout', host: 'devbox', command: 'codex', dir: '/work/api',
    status: 'running', created_at: '2026-10-12T00:00:00Z' }],
};
let server, browser, url;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url.startsWith('/v1/agents')) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(fixture));
    }
    const pathname = req.url.split('?')[0];
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    try { res.end(fs.readFileSync(file)); }
    catch { res.statusCode = 404; res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  const engine = process.env.KOLO_BROWSER === 'firefox' ? firefox : chromium;
  browser = await engine.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function openSession(viewport, agents = fixture.agents, readOnly = false) {
  const mobile = viewport.width <= 760 || viewport.height <= 500;
  const page = await browser.newPage({ viewport, isMobile: mobile && browser.browserType().name() === 'chromium', hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1 });
  if (agents !== fixture.agents || readOnly) await page.route('**/v1/agents', (route) => route.fulfill({ json: { ...fixture, agents, you: { ...fixture.you, read_only: readOnly } } }));
  const errors = [], resizeRequests = [], keys = [];
  let sendState, stream;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('**/v1/watch/**', (ws) => {
    stream = ws;
    sendState = (state) => ws.send(JSON.stringify({ type: 'state', state }));
    function paint(cols, rows) {
      ws.send(JSON.stringify({ type: 'size', cols, rows }));
      ws.send(Buffer.from('\x1b[2J\x1b[Htop left' +
        `\x1b[1;${cols - 8}Htop right` +
        Array.from({ length: Math.max(0, rows - 4) }, (_, i) =>
          `\x1b[${i + 3};1H${'Readable terminal text: commands, output, and conversation. '.repeat(10).slice(0, cols - 1)}`).join('') +
        `\x1b[${rows};1Hbottom left\x1b[${rows};${cols - 11}Hbottom right`));
    }
    ws.onMessage((data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'resize') { resizeRequests.push(msg); paint(msg.cols, msg.rows); }
      if (msg.type === 'keys') keys.push(msg.keys);
    });
    paint(120, 40);
  });
  await page.goto(`${url}/#/agent/${agents[0]?.name || "layout"}`);
  await page.waitForFunction(() => document.querySelector('.session-connection').textContent === 'Live connection');
  await page.evaluate(() => document.fonts.ready);
  return { page, errors, resizeRequests, keys, sendState: (state) => sendState(state),
    sendOutput: (output) => stream.send(Buffer.from(output)),
    sendMessage: (message) => stream.send(JSON.stringify(message)),
    closeStream: () => stream.close({ code: 1012, reason: 'Machine reconnecting' }),
  };
}

async function assertFits(page) {
  // Wait for ResizeObserver and xterm rendering to settle, including after a
  // viewport or zoom change. Check painted bounds, not untransformed layout.
  await page.waitForFunction(() => {
    const frame = document.querySelector('#term').getBoundingClientRect();
    const grid = document.querySelector('.xterm-screen').getBoundingClientRect();
    return frame.height > 60 && frame.bottom <= innerHeight + 1 && grid.width > 0 && grid.height > 0 &&
      grid.left >= frame.left - 1 && grid.top >= frame.top - 1 &&
      grid.right <= frame.right + 1 && grid.bottom <= frame.bottom + 1 &&
      frame.width - grid.width < grid.width / term.cols + 1 &&
      frame.height - grid.height < grid.height / term.rows + 1;
  });
  const metrics = await page.evaluate(() => {
    const frame = document.querySelector('#term').getBoundingClientRect();
    const grid = document.querySelector('.xterm-screen').getBoundingClientRect();
    return { frame: { width: frame.width, height: frame.height, bottom: frame.bottom },
      grid: { width: grid.width, height: grid.height }, viewportHeight: innerHeight,
      cols: term.cols, rows: term.rows,
      transform: getComputedStyle(term.element).transform,
      fontSize: term.options.fontSize };
  });
  assert.ok(metrics.frame.bottom <= metrics.viewportHeight + 1, 'terminal is below the viewport');
  assert.ok(metrics.frame.width - metrics.grid.width < metrics.grid.width / metrics.cols + 1 &&
    metrics.frame.height - metrics.grid.height < metrics.grid.height / metrics.rows + 1, 'fit leaves more than one cell of unused space in both directions');
  assert.equal(metrics.transform, 'none', 'canvas text must render without CSS resampling');
  assert.ok(metrics.fontSize > 0);
  assert.ok(metrics.cols >= 2);
  assert.ok(metrics.rows >= 2);
  assert.equal(metrics.fontSize, 14);
}

test('live activity immediately updates the sidebar indicator and its label', async () => {
  const { page, errors, sendState } = await openSession({ width: 1440, height: 900 });
  try {
    for (const [state, label, selector] of [
      ['busy', 'Working', '.spinner'],
      ['dialog', 'Waiting for input', '.dot.dialog'],
      ['idle', 'Ready', '.dot.idle'],
      ['unknown', 'Running · activity unknown', '.dot.unknown'],
    ]) {
      sendState(state);
      await page.waitForFunction(({ selector, label }) =>
        document.querySelector(`.agent ${selector}`)?.getAttribute('aria-label') === label,
      { selector, label }, { timeout: 1000 });
      assert.equal(await page.locator('.session-head .session-state').textContent(), label);
      assert.equal(await page.locator('.agent .session-state').count(), 0);
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('disconnected machines do not display a stale waiting indicator', async () => {
  const { page } = await openSession({ width: 1440, height: 900 });
  try {
    await page.route('**/v1/agents', (route) => route.fulfill({ json: {
      ...fixture, hosts: [], agents: [{ ...fixture.agents[0], screen_state: 'dialog' }],
    } }));
    await page.evaluate(() => refresh());
    assert.equal(await page.locator('.agent .dot').getAttribute('aria-label'), 'Machine disconnected');
    assert.equal(await page.locator('.agent .dot.dialog').count(), 0);
  } finally { await page.close(); }
});

test('Codex titles appear in navigation and manual labels take precedence', async () => {
  for (const label of ['', 'My custom name']) {
    const title = 'Resize sidebar with mouse';
    const { page, errors } = await openSession({ width: 1440, height: 900 },
      [{ ...fixture.agents[0], title, label }]);
    try {
      const expected = label || title;
      assert.equal(await page.locator('.session-title').textContent(), expected);
      assert.equal(await page.locator('.agent .name').textContent(), expected);
      assert.equal(await page.locator('.agent .drop').getAttribute('aria-label'), `Stop session ${expected}`);
      assert.ok((await page.title()).startsWith(expected));
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});

test('sidebar dragging clamps, persists, and refits the terminal', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  try {
    const handle = page.locator('.side-resize');
    const initialWidth = (await page.locator('.side').boundingBox()).width;
    const bounds = await handle.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 100);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 100, bounds.y + 100, { steps: 5 });
    await page.mouse.up();
    assert.equal((await page.locator('.side').boundingBox()).width, initialWidth + 100);
    await assertFits(page);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.session-connection').textContent === 'Live connection');
    assert.equal((await page.locator('.side').boundingBox()).width, initialWidth + 100);
    await handle.focus();
    await page.keyboard.press('End');
    assert.equal((await page.locator('.side').boundingBox()).width, 480);
    await page.keyboard.press('Home');
    assert.equal((await page.locator('.side').boundingBox()).width, 180);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.mobile-menu').click();
    assert.equal(await handle.isVisible(), false);
    assert.equal((await page.locator('.side').boundingBox()).width, 320);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

for (const viewport of [
  { width: 2048, height: 1040 }, { width: 1440, height: 900 }, { width: 1024, height: 768 },
  { width: 390, height: 844 }, { width: 320, height: 568 },
  { width: 390, height: 400 }, { width: 844, height: 390 },
]) {
  test(`PTY grid fills the available space at ${viewport.width}×${viewport.height}`, async () => {
    const { page, errors } = await openSession(viewport);
    try {
      await assertFits(page);
      if (viewport.width < 760 || viewport.height < 500) {
        assert.equal(await page.locator('.side').isVisible(), false);
        assert.ok(await page.locator('.zoom .in').isVisible());
        const toolbar = await page.locator('.zoom').boundingBox();
        const terminal = await page.locator('#term').boundingBox();
        assert.ok(toolbar.y >= terminal.y + terminal.height - 1, 'zoom controls obscure terminal output');
        const termHeight = await page.locator('#term').evaluate((e) => e.clientHeight);
        assert.ok(termHeight > viewport.height / 2, 'navigation consumed the terminal space');
      }
      if (process.env.KOLO_SCREENSHOT_DIR) {
        fs.mkdirSync(process.env.KOLO_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.KOLO_SCREENSHOT_DIR,
          `layout-${viewport.width}-${viewport.height}.png`) });
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

test('phone navigation closes on selection, and zoom reflows the PTY and returns to fit', async () => {
  const { page, errors } = await openSession({ width: 390, height: 844 });
  try {
    await assertFits(page);
    await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    assert.equal(await page.locator('.side').isVisible(), true);
    assert.equal(await page.locator('main').evaluate((e) => e.inert), true);
    await page.locator('.agent .name').click();
    assert.equal(await page.locator('.side').isVisible(), false);
    assert.equal(await page.locator('main').evaluate((e) => e.inert), false);
    const originalCols = await page.evaluate(() => term.cols);
    await page.locator('.zoom .in').click();
    await page.waitForFunction((cols) => term.cols < cols, originalCols);
    assert.equal(await page.locator('.xterm').evaluate((e) => getComputedStyle(e).transform), 'none');
    await page.locator('.zoom .at').click();
    await assertFits(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await assertFits(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('agent marks share a monochrome vector style without icon backgrounds', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  try {
    await page.locator('.agent .kind-chip svg').waitFor();
    await page.locator('.group-head .add').first().click();
    for (const program of ['codex', 'claude', 'opencode']) {
      const icon = page.locator(`.kind-picker svg[data-agent="${program}"]`);
      await icon.waitFor();
      const style = await icon.evaluate((svg) => ({
        width: svg.getBoundingClientRect().width, height: svg.getBoundingClientRect().height,
        background: getComputedStyle(svg.parentElement).backgroundColor,
        paths: [...svg.querySelectorAll('path')].map((path) => path.getAttribute('fill')),
      }));
      assert.equal(style.width, 20);
      assert.equal(style.height, 20);
      assert.equal(style.background, 'rgba(0, 0, 0, 0)');
      assert.ok(style.paths.length > 0);
      assert.ok(style.paths.every((fill) => fill === 'currentColor'));
      await icon.locator('..').locator('..').click();
      assert.equal(await icon.locator('..').evaluate((chip) => getComputedStyle(chip).backgroundColor), 'rgba(0, 0, 0, 0)');
    }
    if (process.env.KOLO_SCREENSHOT_DIR) {
      await page.screenshot({ path: path.join(process.env.KOLO_SCREENSHOT_DIR, 'agent-icons.png') });
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('long paths and recovery warnings leave terminal space above a phone keyboard', async () => {
  const { page, errors } = await openSession({ width: 390, height: 400 }, [{
    ...fixture.agents[0], dir: '/work/' + 'long-project-directory/'.repeat(8),
    context_resets: [{ id: 'reset', previous_session: 'previous-conversation', acknowledged: false }],
  }]);
  try {
    await assertFits(page);
    const header = await page.locator('.session-head').boundingBox();
    assert.ok(header.height < 120, 'recovery warning consumed the viewport');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});


test('desktop resizing increases the agent grid without shrinking or scaling text', async () => {
  const { page, resizeRequests } = await openSession({ width: 1024, height: 768 });
  try {
    await assertFits(page);
    const before = await page.evaluate(() => ({ cols: term.cols, rows: term.rows }));
    await page.setViewportSize({ width: 2048, height: 1040 });
    await assertFits(page);
    const after = await page.evaluate(() => ({ cols: term.cols, rows: term.rows }));
    assert.ok(after.cols > before.cols);
    assert.ok(after.rows > before.rows);
    // Size replies must not provoke a negotiation loop.
    assert.ok(resizeRequests.length < 10);
  } finally { await page.close(); }
});

test('read-only viewers fit and pan the shared grid without sending resize requests', async () => {
  const { page, errors, resizeRequests } = await openSession({ width: 390, height: 844 }, fixture.agents, true);
  try {
    await page.waitForFunction(() => {
      const frame = document.querySelector('#term').getBoundingClientRect();
      const grid = document.querySelector('.xterm-screen').getBoundingClientRect();
      return grid.right <= frame.right + 1 && grid.bottom <= frame.bottom + 1;
    });
    for (let i = 0; i < 3; i++) await page.locator('.zoom .in').click();
    await page.waitForFunction(() => document.querySelector('#term').scrollWidth > document.querySelector('#term').clientWidth);
    assert.deepEqual(await page.evaluate(() => [term.cols, term.rows]), [120, 40]);
    assert.deepEqual(resizeRequests, []);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('creation accepts a typed folder and generates a name when left blank', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  let request;
  try {
    const icon = await page.locator('.agent .kind-chip').boundingBox();
    const name = await page.locator('.agent .name').boundingBox();
    assert.ok(icon.x < name.x, 'agent icon should lead the name');
    await page.route('**/v1/agents', (route) => {
      if (route.request().method() === 'POST') {
        request = route.request().postDataJSON();
        return route.fulfill({ status: 403, body: 'This folder must be shared by the host.' });
      }
      return route.fulfill({ json: fixture });
    });
    await page.locator('.group-head .add').first().click();
    await page.locator('input[name=dir]').fill('/work/another-project');
    await page.locator('#new-name').focus();
    const focus = await page.locator('#new-name').evaluate((node) => ({
      color: getComputedStyle(node).outlineColor,
      background: getComputedStyle(node).backgroundColor,
      width: getComputedStyle(node).outlineWidth,
    }));
    assert.equal(focus.width, '2px');
    assert.ok(contrastRatio(focus.color, focus.background) >= 3, 'focus ring needs visible contrast');
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.dialog-note').textContent.includes('must be shared'));
    assert.equal(request.dir, '/work/another-project');
    assert.match(request.name, /^another-project-codex-[a-f0-9]{8}$/);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

const workspaceAgents = [
  { ...fixture.agents[0], name: 'api-review', label: 'Review API changes', screen_state: 'dialog' },
  { ...fixture.agents[0], name: 'web-build', command: 'claude', dir: '/work/web', title: 'Build the settings page', screen_state: 'busy' },
  { ...fixture.agents[0], name: 'shell', command: 'bash', label: 'Development shell', screen_state: 'idle' },
  { ...fixture.agents[0], name: 'failed', command: 'opencode', label: 'Investigate failing tests', status: 'failed', error: 'Program exited with code 1.' },
];

async function saveReview(page, name) {
  if (!process.env.KOLO_SCREENSHOT_DIR) return;
  fs.mkdirSync(process.env.KOLO_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.KOLO_SCREENSHOT_DIR, `${name}.png`) });
}

function contrastRatio(foreground, background) {
  const luminance = (rgb) => rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const width of [2048, 1440, 768, 390, 320]) {
  test(`workspace search, statuses, and navigation work at ${width}px`, async () => {
    const { page, errors } = await openSession({ width, height: 900 }, workspaceAgents);
    try {
      await page.evaluate(() => { location.hash = ''; });
      await page.locator('.home').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.session-link').count(), 4);
      assert.match(await page.locator('.home-summary').textContent(), /4 sessions · 1 waiting for input/);
      assert.deepEqual(await page.locator('.overview-state').allTextContents(), ['Waiting for input', 'Working', 'Ready', 'Failed']);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const content = await page.locator('.home-content').boundingBox();
      const pane = await page.locator('.home').boundingBox();
      assert.ok(Math.abs(content.width - pane.width) < 1, 'overview must fill the workspace width');
      await saveReview(page, `workspace-${width}`);
      const search = page.getByRole('searchbox', { name: 'Search sessions' });
      await search.fill('/work/web');
      assert.equal(await page.locator('.session-link').count(), 1);
      assert.equal(await page.locator('.session-name').textContent(), 'Build the settings page');
      await search.fill('nothing matches');
      assert.equal(await page.locator('.session-link').count(), 0);
      assert.equal(await page.locator('.sessions-empty-title').textContent(), 'No matching sessions');
      await page.getByRole('button', { name: 'Clear search' }).click();
      assert.equal(await search.inputValue(), '');
      assert.equal(await search.evaluate((e) => e === document.activeElement), true);
      await page.locator('.session-link').first().focus();
      await page.keyboard.press('Enter');
      await page.waitForURL('**/#/agent/api-review');
      await page.waitForFunction(() => document.querySelector('.session-title').textContent === 'Review API changes');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

for (const width of [1440, 390, 320]) {
  test(`overview filters combine search, machine, and activity at ${width}px`, async () => {
    const agents = [...workspaceAgents, { ...fixture.agents[0], name: 'offline', host: 'offline-box', label: 'Offline shell', command: 'bash', screen_state: 'idle' }];
    const { page, errors } = await openSession({ width, height: 900 }, agents, true);
    try {
      if (width <= 760) await page.locator('.mobile-menu').click();
      await page.locator('.side-overview').click();
      const machine = page.getByRole('combobox', { name: 'Filter by machine' });
      const activity = page.getByRole('combobox', { name: 'Filter by activity' });
      await activity.selectOption('attention');
      assert.equal(await page.locator('.session-link').count(), 3);
      await machine.selectOption('devbox');
      assert.equal(await page.locator('.session-link').count(), 2);
      await page.getByRole('searchbox', { name: 'Search sessions' }).fill('opencode');
      assert.equal(await page.locator('.session-name').textContent(), 'Investigate failing tests');
      assert.equal(await page.locator('.session-results').textContent(), '1 of 5 shown');
      await saveReview(page, `overview-filtered-${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByRole('button', { name: 'Reset filters' }).click();
      assert.equal(await page.locator('.session-link').count(), 5);
      assert.equal(await machine.inputValue(), '');
      assert.equal(await activity.inputValue(), '');
      assert.equal(await page.locator('.session-query').evaluate((node) => node === document.activeElement), true);
      await machine.selectOption('offline-box');
      await activity.selectOption('disconnected');
      assert.equal(await page.locator('.session-name').textContent(), 'Offline shell');
      assert.equal(await page.locator('.home-new').isVisible(), false);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

test('overview polling retains filters and recovers focus when activity changes', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 }, workspaceAgents);
  try {
    await page.locator('.brand-home').click();
    await page.getByRole('combobox', { name: 'Filter by machine' }).selectOption('devbox');
    await page.getByRole('combobox', { name: 'Filter by activity' }).selectOption('dialog');
    await page.locator('.session-link').focus();
    await page.route('**/v1/agents', (route) => route.fulfill({ json: {
      ...fixture, agents: workspaceAgents.map((agent) => ({ ...agent, screen_state: 'busy' })),
    } }));
    await page.evaluate(() => refresh());
    assert.equal(await page.locator('.session-link').count(), 0);
    assert.equal(await page.locator('.sessions-empty-title').textContent(), 'No matching sessions');
    assert.equal(await page.locator('.session-query').evaluate((node) => node === document.activeElement), true);
    await page.route('**/v1/agents', (route) => route.fulfill({ json: { ...fixture, hosts: [], agents: workspaceAgents } }));
    await page.evaluate(() => refresh());
    assert.equal(await page.getByRole('combobox', { name: 'Filter by machine' }).inputValue(), 'devbox');
    await page.getByRole('combobox', { name: 'Filter by activity' }).selectOption('disconnected');
    assert.equal(await page.locator('.session-link').count(), 4);
    await page.route('**/v1/agents', (route) => route.fulfill({ json: { ...fixture, hosts: [], agents: [] } }));
    await page.evaluate(() => refresh());
    assert.equal(await page.getByRole('combobox', { name: 'Filter by machine' }).inputValue(), 'devbox');
    await page.route('**/v1/agents', (route) => route.fulfill({ status: 401 }));
    await page.evaluate(() => refresh());
    await page.locator('.signin').waitFor({ state: 'visible' });
    assert.equal(await page.locator('select[aria-label="Filter by machine"]').inputValue(), '');
    assert.equal(await page.locator('select[aria-label="Filter by activity"]').inputValue(), '');
    assert.equal(await page.locator('select[aria-label="Filter by machine"] option').count(), 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('workspace polling preserves focused session and exposes disconnected machines', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 }, workspaceAgents);
  try {
    await page.evaluate(() => { location.hash = ''; });
    await page.locator('.session-link').first().focus();
    await page.route('**/v1/agents', (route) => route.fulfill({ json: {
      ...fixture, hosts: [], agents: workspaceAgents.map((a) => ({ ...a, label: a.label + ' updated' })),
    } }));
    await page.evaluate(() => refresh());
    assert.equal(await page.evaluate(() => document.activeElement.dataset.session), 'api-review');
    assert.ok((await page.locator('.overview-state').allTextContents()).every((s) => s === 'Machine disconnected'));
    assert.equal(await page.locator('.home-new').isDisabled(), true);
    assert.equal(await page.locator('.home-setup').isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('machine disclosure stays collapsed while polling and opens for connection recovery', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  try {
    await page.locator('.side-overview').click();
    await page.locator('.home').waitFor({ state: 'visible' });
    const summary = page.locator('.machines-section > summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.host-cards').isVisible(), false);
    await page.evaluate(() => refresh());
    assert.equal(await page.locator('.host-cards').isVisible(), false);
    assert.equal(await summary.evaluate((node) => node === document.activeElement), true);
    await page.route('**/v1/agents', (route) => route.fulfill({ json: { ...fixture, hosts: [] } }));
    await page.evaluate(() => refresh());
    assert.equal(await page.locator('.home-setup').isVisible(), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('empty workspace guidance respects machine availability and read-only access', async () => {
  for (const readOnly of [false, true]) {
    const { page, errors } = await openSession({ width: 390, height: 844 }, fixture.agents, readOnly);
    try {
      await page.evaluate(() => { location.hash = ''; });
      await page.locator('.session-link').focus();
      await page.route('**/v1/agents', (route) => route.fulfill({ json: {
        ...fixture, agents: [], you: { ...fixture.you, read_only: readOnly },
      } }));
      await page.evaluate(() => refresh());
      await page.locator('.sessions-empty').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.session-toolbar').isVisible(), false);
      assert.equal(await page.locator('.machines-section > summary').evaluate((node) => node === document.activeElement), true);
      assert.equal(await page.locator('.home-new').isVisible(), !readOnly);
      assert.match(await page.locator('.sessions-empty-detail').textContent(), readOnly ? /member with control access/ : /Start a new session/);
      await saveReview(page, readOnly ? 'workspace-readonly-empty' : 'workspace-empty');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});

test('initial connection errors provide a keyboard accessible retry', async () => {
  const page = await browser.newPage();
  try {
    await page.route('**/v1/agents', (route) => route.fulfill({ status: 503 }));
    await page.goto(url);
    assert.equal(await page.locator('.boot').isVisible(), true);
    assert.match(await page.locator('.boot-message').textContent(), /unavailable \(503\)/);
    await saveReview(page, 'workspace-connection-error');
    await page.route('**/v1/agents', (route) => route.fulfill({ json: { ...fixture, agents: [] } }));
    await page.getByRole('button', { name: 'Try again' }).focus();
    await page.keyboard.press('Enter');
    await page.locator('.app').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.boot').isVisible(), false);
    assert.equal(await page.locator('.workspace-message').isVisible(), false);
  } finally { await page.close(); }
});

test('refresh failure preserves session details and reconnect clears the warning', async () => {
  const { page, errors } = await openSession({ width: 390, height: 844 });
  try {
    await page.route('**/v1/agents', (route) => route.abort());
    await page.evaluate(() => refresh());
    assert.equal(await page.locator('.workspace-message').isVisible(), true);
    assert.equal(await page.locator('.session-title').textContent(), 'layout');
    await page.route('**/v1/agents', (route) => route.fulfill({ json: fixture }));
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await page.locator('.workspace-message').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('creation shows pending feedback and an actionable server error', async () => {
  const { page, errors } = await openSession({ width: 390, height: 844 });
  let release;
  try {
    await page.route('**/v1/agents', async (route) => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: fixture });
      await new Promise((resolve) => { release = resolve; });
      await route.fulfill({ status: 409, body: 'That session name is already in use. Choose another name.' });
    });
    await page.evaluate(() => { location.hash = ''; });
    await page.locator('.home-new').click();
    await saveReview(page, 'session-create-mobile');
    await page.getByRole('button', { name: 'Start session' }).click();
    await page.getByRole('button', { name: 'Starting…', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Starting…', exact: true }).isDisabled(), true);
    assert.equal(await page.getByLabel('Directory', { exact: true }).isDisabled(), true);
    release();
    await page.waitForFunction(() => document.querySelector('.dialog-note').textContent.includes('Choose another name'));
    assert.equal(await page.getByRole('button', { name: 'Start session' }).isDisabled(), false);
    await saveReview(page, 'session-create-error-mobile');
    await page.keyboard.press('Escape');
    await page.locator('.scrim').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.home-new').evaluate((e) => e === document.activeElement), true);
    assert.deepEqual(errors, []);
  } finally { release?.(); await page.close(); }
});

test('sign-in and join forms have labels, fit phones, and reject malformed invites', async () => {
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.route('**/v1/agents', (route) => route.fulfill({ status: 401 }));
    await page.goto(url);
    await page.locator('.signin').waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Access token').evaluate((e) => e === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await saveReview(page, 'signin-mobile');
    await page.route('**/join*', (route) => route.fulfill({ contentType: 'text/html', body:
      fs.readFileSync(path.join(root, 'join.html'), 'utf8').replace('{{.Org}}', 'Product engineering'),
    }));
    await page.goto(`${url}/join#kolo_example`);
    assert.equal(await page.getByLabel('Your name').isVisible(), true);
    assert.equal(await page.getByLabel('Your name').evaluate((e) => e === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await saveReview(page, 'join-mobile');
    await page.goto(`${url}/join#%E0%A4%A`);
    await page.reload();
    assert.equal(await page.locator('.nolink').isVisible(), true);
    assert.equal(await page.locator('.ask').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('account menu and session rename are keyboard accessible', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  try {
    await page.locator('.me').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.me').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.me-menu').evaluate((e) => e.contains(document.activeElement)), true);
    await page.keyboard.press('Escape');
    await page.locator('.me-menu').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.me').evaluate((e) => e === document.activeElement), true);
    await page.locator('.agent').focus();
    await page.keyboard.press('F2');
    const name = page.getByRole('textbox', { name: 'Session name', exact: true });
    await name.waitFor();
    await page.waitForFunction(() => document.activeElement.classList.contains('rename'));
    await page.keyboard.press('Escape');
    await name.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.agent .name').textContent(), 'layout');
    assert.equal(await page.locator('.agent').evaluate((e) => e === document.activeElement), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('session creation success opens the new shared terminal', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  let made;
  try {
    await page.route('**/v1/agents', (route) => {
      if (route.request().method() === 'POST') {
        made = { ...route.request().postDataJSON(), status: 'running', screen_state: 'idle' };
        return route.fulfill({ status: 201, json: made });
      }
      return route.fulfill({ json: { ...fixture, agents: made ? [...fixture.agents, made] : fixture.agents } });
    });
    await page.locator('.group-head .add').click();
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.scrim').hidden && location.hash !== '#/agent/layout');
    await page.waitForFunction((name) => watching === name && screenReady && document.querySelector('.session-connection').textContent === 'Live connection', made.name);
    assert.equal(await page.locator('.session-title').textContent(), made.name);
    assert.equal(await page.evaluate(() => term.options.disableStdin), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('explorer navigation switches terminals with a compact header and bottom controls', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 }, workspaceAgents);
  try {
    const session = page.locator('.agent').filter({ has: page.locator('.name', { hasText: 'Build the settings page' }) });
    await session.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => location.hash === '#/agent/web-build' && document.querySelector('.session-title').textContent === 'Build the settings page');
    assert.equal(await page.locator('.agent.on .name').textContent(), 'Build the settings page');
    assert.equal(await page.locator('.session-title').isVisible(), true);
    const frame = await page.locator('#term').boundingBox();
    const controls = await page.locator('.watch-bar').boundingBox();
    const header = await page.locator('.session-head').boundingBox();
    assert.ok(header.height <= 56, 'two-line session header should remain compact');
    const title = await page.locator('.session-title').boundingBox();
    const context = await page.locator('.session-context').boundingBox();
    assert.ok(context.y >= title.y + title.height - 1, 'technical context should sit below the session name');
    assert.ok(controls.y >= frame.y + frame.height - 1, 'status controls overlap the terminal');
    const screen = await page.locator('.screen').evaluate((node) => ({
      margin: getComputedStyle(node).margin, radius: getComputedStyle(node).borderRadius,
    }));
    assert.equal(screen.margin, '0px');
    assert.equal(screen.radius, '0px');
    await page.locator('.side-overview').click();
    await page.locator('.home').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.side-overview').getAttribute('aria-current'), 'page');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('directory groups preserve keyboard focus and collapsed state during polling', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 }, workspaceAgents);
  try {
    assert.equal(await page.locator('.project').count(), 2);
    const project = page.getByRole('button', { name: '3 sessions in /work/api', exact: true });
    await project.focus();
    await page.keyboard.press('Enter');
    assert.equal(await project.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.agent.on').isVisible(), false);
    await page.evaluate(() => refresh());
    assert.equal(await project.getAttribute('aria-expanded'), 'false');
    assert.equal(await project.evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.agent.on').isVisible(), true);
    const state = await page.locator('.agent.on .dot').boundingBox();
    const panel = await page.locator('.side').boundingBox();
    assert.ok(state.x + state.width <= panel.x + panel.width, 'activity must stay inside the explorer');
    await page.locator('.agent.on').focus();
    await page.keyboard.press('F2');
    await page.getByRole('textbox', { name: 'Session name', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.agent.on').evaluate((node) => node === document.activeElement), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('session switcher keeps shell shortcuts available and focuses the next live terminal', async () => {
  const { page, errors, keys } = await openSession({ width: 1440, height: 900 }, workspaceAgents);
  try {
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Control+k');
    await page.waitForFunction(() => document.querySelector('.switch-scrim').hidden);
    await page.keyboard.press('Control+Shift+Space');
    const query = page.getByRole('combobox', { name: 'Find a session or action' });
    await query.waitFor();
    assert.equal(await query.evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.locator('.app').evaluate((node) => node.inert), true);
    assert.equal(await page.locator('.switch-open').getAttribute('aria-keyshortcuts'), 'Control+Shift+Space');
    assert.deepEqual(keys, ['\u000b']);
    await page.keyboard.press('Control+Shift+Space');
    assert.equal(await page.locator('.switch-scrim').isVisible(), false);
    assert.equal(await page.locator('.xterm-helper-textarea').evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press('Control+Shift+Space');
    await query.fill('/work/web');
    assert.equal(await page.getByRole('option').count(), 1);
    await saveReview(page, 'session-switcher-search');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => agentInURL() === 'web-build' && screenReady && document.activeElement.classList.contains('xterm-helper-textarea'));
    assert.equal(await page.locator('.switch-scrim').isVisible(), false);
    assert.equal(await page.locator('.app').evaluate((node) => node.inert), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('session switcher handles navigation, no matches, polling, and focus restoration', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 }, workspaceAgents);
  try {
    const trigger = page.getByRole('button', { name: 'Switch session', exact: true }).filter({ visible: true });
    await trigger.click();
    const query = page.getByRole('combobox');
    await page.keyboard.press('ArrowDown');
    assert.match(await page.locator('[role=option][aria-selected=true]').textContent(), /Build the settings page/);
    await page.route('**/v1/agents', (route) => route.fulfill({ json: {
      ...fixture, agents: workspaceAgents.map((agent) => ({ ...agent, label: `${agent.label || agent.title || agent.name} updated` })),
    } }));
    await page.evaluate(() => refresh());
    assert.match(await page.locator('[role=option][aria-selected=true]').textContent(), /Build the settings page updated/);
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'Close session switcher' }).evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await query.evaluate((node) => node === document.activeElement), true);
    await query.fill('no such session');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.switch-empty').isVisible(), true);
    assert.equal(await query.getAttribute('aria-activedescendant'), null);
    await query.fill('');
    await saveReview(page, 'session-switcher-desktop');
    await page.keyboard.press('Escape');
    assert.equal(await trigger.evaluate((node) => node === document.activeElement), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

for (const width of [390, 320]) {
  test(`mobile session switching and sharing keep navigation accessible at ${width}px`, async () => {
    const { page, errors } = await openSession({ width, height: 568 }, workspaceAgents);
    try {
      await page.locator('.mobile-switch').click();
      await saveReview(page, `session-switcher-${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.mobile-switch').evaluate((node) => node === document.activeElement), true);
      await page.getByRole('button', { name: 'Sessions', exact: true }).click();
      assert.equal(await page.locator('.agent.on').evaluate((node) => node === document.activeElement), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.mobile-menu').evaluate((node) => node === document.activeElement), true);
      await page.getByLabel('Share session', { exact: true }).click();
      await page.getByLabel('Session link', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Session link', { exact: true }).inputValue(), `${url}/#/agent/api-review`);
      await saveReview(page, `session-share-${width}`);
      const panel = await page.locator('.share-panel').boundingBox();
      assert.ok(panel.x >= 0 && panel.x + panel.width <= width);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement === document.querySelector('.session-share button'));
      assert.equal(await page.getByLabel('Share session', { exact: true }).evaluate((node) => node === document.activeElement), true);
      assert.equal(await page.locator('.session-access').isVisible(), true);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

test('switcher actions respect changing permissions and clear session data on sign-out', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 }, workspaceAgents);
  try {
    await page.locator('.side-new').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.side-new').evaluate((node) => node === document.activeElement), true);
    await page.locator('.switch-open').click();
    await page.getByRole('combobox').fill('new session');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.scrim').isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.side-new').evaluate((node) => node === document.activeElement), true);
    await page.locator('.switch-open').click();
    await page.route('**/v1/agents', (route) => route.fulfill({ json: {
      ...fixture, agents: workspaceAgents, you: { ...fixture.you, read_only: true },
    } }));
    await page.evaluate(() => refresh());
    assert.equal(await page.locator('.side-new').isVisible(), false);
    await page.getByRole('combobox').fill('new session');
    assert.equal(await page.getByRole('option').count(), 0);
    await page.getByRole('combobox').fill('');
    await page.route('**/v1/agents', (route) => route.fulfill({ status: 401 }));
    await page.evaluate(() => refresh());
    await page.locator('.signin').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.switch-scrim').isVisible(), false);
    assert.equal(await page.locator('.switch-name').count(), 0);
    assert.equal(await page.getByLabel('Access token').evaluate((node) => node === document.activeElement), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('session sharing copies a member link and provides a manual fallback', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  try {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (value) => { window.copiedSessionLink = value; },
      } });
    });
    await page.getByLabel('Share session', { exact: true }).click();
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.share-feedback').textContent === 'Session link copied.');
    assert.equal(await page.evaluate(() => window.copiedSessionLink), `${url}/#/agent/layout`);
    assert.match(await page.locator('#share-help').textContent(), /New teammates need an invite/);
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('denied'); }; });
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.share-feedback').textContent.includes('manually'));
    assert.equal(await page.getByLabel('Session link', { exact: true }).evaluate((node) => node === document.activeElement && node.selectionEnd === node.value.length), true);
    await page.locator('.brand-home').click();
    assert.equal(await page.getByLabel('Share session', { exact: true }).getAttribute('aria-expanded'), 'false');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('failed React download offers a working reload instead of an endless loading screen', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  try {
    await page.route('**/assets/react/workspace.js', (route) => route.abort());
    await page.reload();
    await page.getByRole('button', { name: 'Try again' }).waitFor();
    assert.match(await page.locator('.boot-message').textContent(), /Reload/);
    await page.unroute('**/assets/react/workspace.js');
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.waitForFunction(() => document.querySelector('.session-connection').textContent === 'Live connection');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('a React rendering failure shows recovery and gates terminal input', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  try {
    await page.evaluate(() => {
      window.KoloController.sessionState = () => { throw new Error('Review rendering failure'); };
      window.KoloUI.overview.update({ hosts: [], agents: [{ name: 'broken' }], allowed: false });
    });
    await page.getByRole('button', { name: 'Try again' }).waitFor();
    assert.equal(await page.locator('.app').isVisible(), false);
    assert.equal(await page.evaluate(() => term.options.disableStdin), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('React creation preserves draft values and focused controls during polling', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  try {
    await page.locator('.side-new').click();
    await page.getByLabel('Directory', { exact: true }).fill('/work/custom-project');
    await page.locator('#new-name').fill('custom-session');
    await page.locator('.kind-choice').first().focus();
    await page.evaluate(() => { window.focusedProgram = document.activeElement; });
    await page.route('**/v1/agents', (route) => route.fulfill({ json: { ...fixture, hosts: [{ ...fixture.hosts[0], dirs: ['/work/api', '/work/web'] }] } }));
    await page.evaluate(() => refresh());
    assert.equal(await page.getByLabel('Directory', { exact: true }).inputValue(), '/work/custom-project');
    assert.equal(await page.locator('#new-name').inputValue(), 'custom-session');
    assert.equal(await page.evaluate(() => document.activeElement === window.focusedProgram), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.getByLabel('Close new session dialog').evaluate((node) => node === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.getByRole('button', { name: 'Start session', exact: true }).evaluate((node) => node === document.activeElement), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('late clipboard completion cannot overwrite feedback for a different session', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 }, workspaceAgents);
  try {
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => new Promise((resolve) => { window.finishCopy = resolve; }) } });
    });
    await page.getByLabel('Share session', { exact: true }).click();
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Copy', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.locator('.agent').filter({ hasText: 'Build the settings page' }).click();
    await page.waitForURL('**/#/agent/web-build');
    await page.getByLabel('Share session', { exact: true }).click();
    await page.evaluate(async () => { window.finishCopy(); await Promise.resolve(); await Promise.resolve(); });
    assert.equal(await page.getByLabel('Session link', { exact: true }).inputValue(), `${url}/#/agent/web-build`);
    assert.equal(await page.locator('.share-feedback').textContent(), '');
    assert.equal(await page.getByRole('button', { name: 'Copy', exact: true }).isDisabled(), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('authentication loss during creation clears the dialog and ignores its late response', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  let release, lost = false;
  try {
    await page.route('**/v1/agents', async (route) => {
      if (route.request().method() !== 'POST') return lost ? route.fulfill({ status: 401 }) : route.fulfill({ json: fixture });
      await new Promise((resolve) => { release = resolve; });
      return route.fulfill({ status: 201, json: { name: 'private-session' } });
    });
    await page.locator('.side-new').click();
    await page.getByRole('button', { name: 'Start session', exact: true }).click();
    await page.getByRole('button', { name: 'Starting…', exact: true }).waitFor();
    lost = true;
    await page.evaluate(() => refresh());
    await page.getByLabel('Access token').waitFor();
    release();
    await page.waitForFunction(() => !createPending);
    assert.equal(await page.locator('.scrim').isVisible(), false);
    assert.equal(await page.locator('.kind-choice').count(), 0);
    assert.equal(await page.getByLabel('Access token').evaluate((node) => node === document.activeElement), true);
    assert.notEqual(await page.evaluate(() => location.hash), '#/agent/private-session');
    assert.deepEqual(errors, []);
  } finally { release?.(); await page.close(); }
});

test('tab icons follow the browser preference independently of Kolo appearance', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  const icon = await browser.newPage();
  try {
    const source = await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href');
    await icon.goto(url + source);
    for (const colorScheme of ['light', 'dark', 'light']) {
      await page.emulateMedia({ colorScheme });
      await icon.emulateMedia({ colorScheme });
      await page.evaluate((scheme) => { document.documentElement.dataset.theme = scheme === 'dark' ? 'light' : 'dark'; }, colorScheme);
      const value = colorScheme === 'dark' ? 255 : 0;
      await icon.waitForFunction((value) => getComputedStyle(document.querySelector('path')).fill === `rgb(${value}, ${value}, ${value})`, value);
      const fallbacks = await page.evaluate(() => [...document.querySelectorAll('link[rel="icon"][type="image/png"]')]
        .filter((link) => matchMedia(link.media).matches).map((link) => link.href));
      assert.equal(fallbacks.length, 2);
      for (const source of fallbacks) {
        const pixels = await page.evaluate(async ({ source, value }) => {
          const image = new Image(); image.src = source; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
          const rgba = context.getImageData(0, 0, image.width, image.height).data;
          let painted = 0, wrong = 0;
          for (let i = 0; i < rgba.length; i += 4) {
            if (!rgba[i + 3]) continue;
            painted++;
            if (rgba[i] !== value || rgba[i + 1] !== value || rgba[i + 2] !== value) wrong++;
          }
          return { painted, wrong };
        }, { source, value });
        assert.ok(pixels.painted > 0);
        assert.equal(pixels.wrong, 0);
      }
    }
    assert.deepEqual(errors, []);
  } finally { await icon.close(); await page.close(); }
});

test('light appearance persists across entry pages with readable selected controls', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  try {
    await page.locator('.me').click();
    await page.getByRole('button', { name: 'Use light appearance' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await assertFits(page);
    const style = await page.locator('.agent.on .name').evaluate((node) => ({
      color: getComputedStyle(node).color,
      background: getComputedStyle(node.closest('.agent')).backgroundColor,
    }));
    assert.ok(contrastRatio(style.color, style.background) >= 4.5, 'selected text must stay readable');
    await saveReview(page, 'terminal-light');
    await page.locator('.brand-home').click();
    await page.locator('.home').waitFor({ state: 'visible' });
    await saveReview(page, 'workspace-light');
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    await page.route('**/join*', (route) => route.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(root, 'join.html'), 'utf8').replace('{{.Org}}', 'Product engineering') }));
    await page.goto(`${url}/join#kolo_example`);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
    await saveReview(page, 'join-light');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

for (const width of [1440, 390]) {
  test(`terminal recovery and collaboration keep controls readable at ${width}px`, async () => {
    const agents = [
      { ...workspaceAgents[0], label: 'Review API authentication and session permissions', screen_state: 'busy' },
      ...workspaceAgents.slice(1),
      ...Array.from({ length: 20 }, (_, i) => ({ ...fixture.agents[0], name: `review-${i}`, label: `Review service ${i + 1}`, screen_state: 'idle' })),
    ];
    const { page, errors, keys, sendState, sendOutput, sendMessage, closeStream } = await openSession({ width, height: 900 }, agents);
    const paint = () => sendOutput('\x1b[2J\x1b[H' + [
      '\x1b[90m/work/api  ·  codex\x1b[0m', '',
      'Review API authentication and session permissions', '',
      '\x1b[90mReading route handlers and access checks…\x1b[0m', '',
      '\x1b[32m$\x1b[0m git diff --stat',
      ' internal/hub/server.go       | 12 ++++++------',
      ' internal/hub/access_test.go  | 24 ++++++++++++++++++++++++',
      ' 2 files changed, 30 insertions(+), 6 deletions(-)', '',
      '\x1b[32m$\x1b[0m go test ./internal/hub',
      'ok  github.com/whosgotch/kolo/internal/hub  0.709s', '',
      'Access checks cover control and read-only members.',
      'The terminal connection stays open after a refused action.', '',
      '\x1b[90mReviewing the remaining changes…\x1b[0m',
    ].join('\r\n'));
    try {
      await assertFits(page);
      sendState('busy');
      paint();
      sendMessage({ type: 'keyboard', who: 'Mira' });
      await page.waitForFunction(() => document.querySelector('.typist').textContent === 'Last input: Mira');
      await assertFits(page);
      paint();
      await saveReview(page, `terminal-crafted-${width}`);
      closeStream();
      await page.waitForFunction(() => document.querySelector('.session-connection').textContent === 'Reconnecting…');
      assert.equal(await page.evaluate(() => term.options.disableStdin), true);
      assert.equal(await page.locator('.watch .restart').isDisabled(), true);
      assert.equal(await page.locator('.typist').isVisible(), false);
      await saveReview(page, `terminal-reconnecting-${width}`);
      await page.waitForFunction(() => document.querySelector('.session-connection').textContent === 'Live connection');
      assert.equal(await page.evaluate(() => term.options.disableStdin), false);
      await page.locator('.xterm-helper-textarea').focus();
      await page.keyboard.type('git status');
      await page.keyboard.press('Enter');
      assert.equal(keys.join(''), 'git status\r');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

for (const width of [1440, 390]) {
  test(`activity links only available sessions and retains readable rows at ${width}px`, async () => {
    const { page, errors } = await openSession({ width, height: 900 }, workspaceAgents);
    try {
      await page.route('**/v1/log', (route) => route.fulfill({ json: { persistent: true, entries: [
        { at: new Date().toISOString(), who: { name: 'Mira' }, what: 'created', agent: 'api-review' },
        { at: new Date().toISOString(), who: { name: 'Reviewer' }, what: 'said', agent: 'api-review', text: 'go test ./internal/hub' },
        { at: new Date().toISOString(), who: { name: 'Mira' }, what: 'stopped', agent: 'retired-session' },
      ] } }));
      await page.evaluate(() => { location.hash = '#/log'; });
      await page.locator('.entry').first().waitFor();
      assert.equal(await page.locator('.entry a.on').count(), 2);
      assert.equal(await page.locator('.entry span.on').count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await saveReview(page, `activity-crafted-${width}`);
      const link = page.locator('.entry a.on').first();
      await link.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => agentInURL() === 'api-review' && screenReady);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}

for (const width of [320, 390]) {
  test(`session controls remain reachable in a short ${width}px viewport`, async () => {
    const { page, errors } = await openSession({ width, height: 800 }, workspaceAgents);
    try {
      await page.locator('.mobile-switch').click();
      await page.setViewportSize({ width, height: 350 });
      await page.waitForFunction(() => document.querySelector('.switch-dialog').getBoundingClientRect().bottom <= innerHeight + 1);
      const dialog = await page.locator('.switch-dialog').boundingBox();
      assert.ok(dialog.y >= 0 && dialog.y + dialog.height <= 351);
      assert.equal(await page.getByRole('combobox').evaluate((node) => node === document.activeElement), true);
      await saveReview(page, `switcher-short-${width}`);
      await page.getByRole('combobox').fill('new session');
      await page.keyboard.press('Enter');
      await page.getByLabel('Directory', { exact: true }).fill('/work/api');
      await page.getByRole('button', { name: 'Start session', exact: true }).scrollIntoViewIfNeeded();
      const submit = await page.getByRole('button', { name: 'Start session', exact: true }).boundingBox();
      assert.ok(submit.y >= 0 && submit.y + submit.height <= 351);
      assert.equal(await page.getByLabel('Directory', { exact: true }).evaluate((node) => getComputedStyle(node).fontSize), '16px');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.mobile-menu').evaluate((node) => node === document.activeElement), true);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
}
