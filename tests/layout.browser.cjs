const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

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
    const file = path.join(root, req.url === '/' ? 'index.html' : req.url);
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    try { res.end(fs.readFileSync(file)); }
    catch { res.statusCode = 404; res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});

async function openSession(viewport, agents = fixture.agents, readOnly = false) {
  const mobile = viewport.width <= 760 || viewport.height <= 500;
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1 });
  if (agents !== fixture.agents || readOnly) await page.route('**/v1/agents', (route) => route.fulfill({ json: { ...fixture, agents, you: { ...fixture.you, read_only: readOnly } } }));
  const errors = [], resizeRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('**/v1/watch/**', (ws) => {
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
    });
    paint(120, 40);
  });
  await page.goto(`${url}/#/agent/layout`);
  await page.waitForFunction(() => document.querySelector('.session-connection').textContent === 'Live connection');
  await page.evaluate(() => document.fonts.ready);
  return { page, errors, resizeRequests };
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
    await page.locator('.side .new').click();
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
