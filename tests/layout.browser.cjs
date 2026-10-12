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

async function openSession(viewport, agents = fixture.agents) {
  const mobile = viewport.width <= 760 || viewport.height <= 500;
  const page = await browser.newPage({ viewport, isMobile: mobile, hasTouch: mobile,
    deviceScaleFactor: mobile ? 2 : 1 });
  if (agents !== fixture.agents) await page.route('**/v1/agents', (route) => route.fulfill({ json: { ...fixture, agents } }));
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.routeWebSocket('**/v1/watch/**', (ws) => {
    ws.send(JSON.stringify({ type: 'size', cols: 120, rows: 40 }));
    ws.send(Buffer.from('\x1b[2J\x1b[Htop left\x1b[1;112Htop right' +
      Array.from({ length: 36 }, (_, i) => `\x1b[${i + 3};1H${'Readable terminal text: commands, output, and conversation. '.repeat(2)}`).join('') +
      '\x1b[40;1Hbottom left\x1b[40;108Hbottom right'));
  });
  await page.goto(`${url}/#/agent/layout`);
  await page.waitForFunction(() => document.querySelector('.session-connection').textContent === 'Live connection');
  await page.evaluate(() => document.fonts.ready);
  return { page, errors };
}

async function assertFits(page) {
  // Wait for ResizeObserver and xterm rendering to settle, including after a
  // viewport or zoom change. Check painted bounds, not untransformed layout.
  await page.waitForFunction(() => {
    const frame = document.querySelector('#term').getBoundingClientRect();
    const grid = document.querySelector('.xterm-screen').getBoundingClientRect();
    return frame.height > 60 && frame.bottom <= innerHeight + 1 && grid.width > 0 && grid.height > 0 &&
      grid.left >= frame.left - 1 && grid.top >= frame.top - 1 &&
      grid.right <= frame.right + 1 && grid.bottom <= frame.bottom + 1;
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
  assert.ok(metrics.frame.width - metrics.grid.width < 120 ||
    metrics.frame.height - metrics.grid.height < 40, 'fit leaves more than one cell of unused space in both directions');
  assert.equal(metrics.transform, 'none', 'canvas text must render without CSS resampling');
  assert.ok(metrics.fontSize > 0);
  assert.equal(metrics.cols, 120);
  assert.equal(metrics.rows, 40);
}

for (const viewport of [
  { width: 2048, height: 1040 }, { width: 1440, height: 900 }, { width: 1024, height: 768 },
  { width: 390, height: 844 }, { width: 320, height: 568 },
  { width: 390, height: 400 }, { width: 844, height: 390 },
]) {
  test(`shared grid stays entirely visible at ${viewport.width}×${viewport.height}`, async () => {
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

test('phone navigation closes on selection, and zoomed terminals can pan and return to fit', async () => {
  const { page, errors } = await openSession({ width: 390, height: 844 });
  try {
    await assertFits(page);
    await page.getByRole('button', { name: 'Sessions', exact: true }).click();
    assert.equal(await page.locator('.side').isVisible(), true);
    assert.equal(await page.locator('main').evaluate((e) => e.inert), true);
    await page.locator('.agent .name').click();
    assert.equal(await page.locator('.side').isVisible(), false);
    assert.equal(await page.locator('main').evaluate((e) => e.inert), false);
    for (let i = 0; i < 3; i++) await page.locator('.zoom .in').click();
    await page.waitForFunction(() => document.querySelector('#term').scrollWidth > document.querySelector('#term').clientWidth);
    await page.locator('#term').evaluate((e) => { e.scrollLeft = e.scrollWidth; });
    assert.ok(await page.locator('#term').evaluate((e) => e.scrollLeft > 0));
    assert.equal(await page.locator('.xterm').evaluate((e) => getComputedStyle(e).transform), 'none');
    await page.locator('.zoom .at').click();
    await assertFits(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await assertFits(page);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('supported agents display bundled vendor icons in the sidebar and creation picker', async () => {
  const { page, errors } = await openSession({ width: 1440, height: 900 });
  try {
    await page.locator('.agent .kind-chip img').waitFor();
    assert.ok(await page.locator('.agent .kind-chip img').evaluate((image) => image.complete && image.naturalWidth > 0));
    await page.locator('.side .new').click();
    for (const program of ['codex', 'claude', 'opencode']) {
      const image = page.locator(`.kind-picker img[src="/assets/agents/${program}.png"]`);
      await image.waitFor();
      await page.waitForFunction((program) => {
        const image = document.querySelector(`.kind-picker img[src="/assets/agents/${program}.png"]`);
        return image.complete && image.naturalWidth > 0;
      }, program);
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
