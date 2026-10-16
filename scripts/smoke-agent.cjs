// Opt-in checks against a real, authenticated Codex TUI. Never run in CI.
// KOLO_SMOKE_COMMAND='codex --no-daemon -s read-only -a on-request'
// KOLO_SMOKE_BINARY=/path/to/kolo node scripts/smoke-agent.cjs
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { installTerminalProbe } = require('../tests/browser/terminal-probe.cjs');

const command = process.env.KOLO_SMOKE_COMMAND;
const binary = process.env.KOLO_SMOKE_BINARY;
if (!command || !binary) {
  console.error('Set KOLO_SMOKE_COMMAND and KOLO_SMOKE_BINARY. This uses the CLI\'s existing authentication.');
  process.exit(2);
}

async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kolo-live-smoke-'));
  const project = path.join(dir, 'project');
  const org = path.join(dir, 'org.json');
  const state = path.join(dir, 'agents.json');
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'README.md'), '# Disposable Kolo compatibility check\n');
  const report = { started: new Date().toISOString(), platform: process.platform, command,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), checks: [] };
  let hub, browser, origin, page, teammate, observer;
  const keysSent = new WeakMap();
  const statesSeen = new WeakMap();
  let output = '', stderr = '';
  const redact = (text) => String(text).replace(/kolo_[A-Za-z0-9_-]+/g, '[redacted]');
  const screen = (tab) => tab.evaluate(() => {
    const buffer = window.testTerminal?.buffer.active;
    return buffer ? Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i).translateToString()).join('\n') : '';
  });
  async function step(name, action) {
    process.stdout.write(`${name}: `);
    try {
      const detail = await action();
      report.checks.push({ name, status: 'passed', ...(detail ? { detail } : {}) });
      console.log('passed');
    } catch (error) {
      report.checks.push({ name, status: 'failed', error: redact(error.message) });
      console.log('FAILED');
      throw error;
    }
  }
  async function live(tab) {
    await tab.waitForFunction(() => document.querySelector('.session-connection')?.textContent === 'Live connection');
    await tab.waitForFunction(() => !!window.testTerminal);
  }
  async function send(tab, text) {
    await tab.waitForFunction(() => document.querySelector('.session-head .session-state')?.dataset.state === 'idle', null, { timeout: 90000 });
    const sent = keysSent.get(tab);
    const offset = sent.length;
    await tab.locator('.xterm-helper-textarea').focus();
    await tab.keyboard.type(text, { delay: 5 });
    report.lastInput = { expected: text, sent: sent.slice(offset).join('') };
    await tab.waitForFunction((draft) => {
      const buffer = window.testTerminal?.buffer.active;
      const text = buffer && Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i).translateToString()).join('\n');
      return text && text.replace(/\s/g, '').includes(draft.replace(/\s/g, ''));
    }, text, { timeout: 15000 });
    await tab.keyboard.press('Enter');
  }
  async function contains(tab, text, timeout = 90000) {
    await tab.waitForFunction((needle) => {
      const buffer = window.testTerminal?.buffer.active;
      return buffer && Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i).translateToString()).join('\n').includes(needle);
    }, text, { timeout });
  }
  async function snapshot(name) {
    if (!page) return;
    await fs.writeFile(path.join(dir, `${name}.screen.txt`), await screen(page), { mode: 0o600 });
    await page.screenshot({ path: path.join(dir, `${name}.png`) });
  }
  async function join(invite, name) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const tab = await context.newPage();
    const keys = [];
    const states = new Set();
    keysSent.set(tab, keys);
    statesSeen.set(tab, states);
    tab.on('websocket', (socket) => {
      socket.on('framesent', ({ payload }) => {
        try { const frame = JSON.parse(String(payload)); if (frame.type === 'keys') keys.push(frame.keys); } catch (_) {}
      });
      socket.on('framereceived', ({ payload }) => {
        try { const frame = JSON.parse(String(payload)); if (frame.type === 'state') states.add(frame.state); } catch (_) {}
      });
    });
    await installTerminalProbe(tab);
    await tab.goto(invite);
    await tab.getByLabel('Your name').fill(name);
    await tab.getByRole('button', { name: 'Join workspace' }).click();
    await tab.locator('.home').waitFor({ state: 'visible' });
    return tab;
  }
  try {
    hub = spawn(binary, ['up', '-addr', '127.0.0.1:0', '-name', 'Live compatibility check',
      '-org', org, '-state', state, '-kinds', path.join(dir, 'kinds.json'),
      '-dir', project, '-allow', command], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
    hub.stdout.on('data', (chunk) => { output += chunk; });
    hub.stderr.on('data', (chunk) => { stderr += chunk; });
    const invite = await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Test hub did not become ready')), 15000);
      hub.once('exit', (code) => { clearTimeout(deadline); reject(new Error(`Test hub exited (${code})`)); });
      hub.stdout.on('data', () => {
        const found = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/join#(kolo_[A-Za-z0-9_-]+)/);
        if (found) { clearTimeout(deadline); origin = `http://127.0.0.1:${found[1]}`; resolve(`${origin}/join#${found[2]}`); }
      });
    });
    browser = await chromium.launch({ headless: true });
    report.browser = browser.version();
    await step('two independent members join', async () => {
      page = await join(invite, 'Smoke host');
      teammate = await join(invite, 'Smoke teammate');
      const [a, b] = await Promise.all([page.request.get(`${origin}/v1/agents`), teammate.request.get(`${origin}/v1/agents`)]);
      assert.notEqual((await a.json()).you.id, (await b.json()).you.id);
    });
    await step('create real agent from browser', async () => {
      await page.locator('.home-new').click();
      await page.locator('#new-name').fill('live-agent');
      await page.getByRole('button', { name: 'Start session', exact: true }).click();
      await live(page);
      await teammate.goto(`${origin}/#/agent/live-agent`);
      await live(teammate);
      await snapshot('startup');
    });
    await step('agent becomes ready', async () => {
      // The scratch directory contains no user code. Answer only its trust prompt.
      const trust = await page.waitForFunction(() => {
        const buffer = window.testTerminal?.buffer.active;
        const text = buffer && Array.from({ length: buffer.length }, (_, i) => buffer.getLine(i).translateToString()).join('\n');
        return text && (/Do you trust|trust the contents|trust this folder/i.test(text) ? 'trust'
          : /OpenAI Codex \(v/.test(text) && /\? for shortcuts/.test(text) ? 'ready' : false);
      }, null, { timeout: 45000 });
      if (await trust.jsonValue() === 'trust') {
        await page.locator('.xterm-helper-textarea').focus();
        await page.keyboard.press('Enter');
      }
      await contains(page, '? for shortcuts', 45000);
      report.agentVersion = (await screen(page)).match(/OpenAI Codex \(v([^)]*)\)/)?.[1];
      await snapshot('ready');
    });
    const memory = 40000 + Math.floor(Math.random() * 10000);
    await step('first member prompts the real agent', async () => {
      await send(page, `Remember the smoke memory token ${memory} for this conversation. Calculate 17 multiplied by 19. Reply only with the result. Do not use tools.`);
      await contains(page, '323');
      await contains(teammate, '323');
      await page.waitForFunction(() => document.querySelector('.session-head .session-state')?.dataset.state === 'idle', null, { timeout: 45000 });
      assert.ok(statesSeen.get(page).has('busy'), 'Kolo must detect the real agent working');
      await snapshot('first-response');
    });
    await step('second member takes over the same conversation', async () => {
      await send(teammate, 'Add 1000 to the smoke memory token from the previous message. Reply only with the result. Do not use tools.');
      await contains(page, String(memory + 1000));
      await contains(teammate, String(memory + 1000));
    });
    await step('browser reconnect retains the running conversation', async () => {
      await teammate.reload();
      await live(teammate);
      await send(teammate, 'What is 11 multiplied by 13? Reply only with the result. Do not use tools.');
      await contains(teammate, '143');
    });
    await step('restart resumes the exact conversation', async () => {
      await page.waitForFunction(() => document.querySelector('.session-head .session-state')?.dataset.state === 'idle', null, { timeout: 90000 });
      const before = JSON.parse(await fs.readFile(state, 'utf8'));
      const previousTerminal = await page.evaluateHandle(() => window.testTerminal);
      await snapshot('before-restart');
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: /^restart$/i }).click();
      await page.waitForFunction((previous) => window.testTerminal !== previous, previousTerminal);
      await previousTerminal.dispose();
      await live(page);
      await contains(page, '? for shortcuts', 45000);
      await send(page, 'Add 2000 to the smoke memory token I asked you to remember. Reply only with the result. Do not use tools.');
      await contains(page, String(memory + 2000));
      const agents = await (await page.request.get(`${origin}/v1/agents`)).json();
      assert.equal(agents.agents[0].context_resets?.length || 0, 0, 'restart must not silently reset the conversation');
      assert.ok(JSON.stringify(before).includes('live-agent'));
      await snapshot('resumed');
    });
    await step('teammate sees and answers a real permission request', async () => {
      const proof = path.join(dir, 'permission-proof.txt');
      await send(page, `Run exactly this shell command: printf approved > ${proof} . The sandbox is read-only, so request approval for this one write instead of attempting alternatives. After it succeeds reply PERMISSION_COMPLETE.`);
      await contains(teammate, 'Would you like to run', 90000);
      await contains(teammate, proof);
      await snapshot('permission');
      const status = await (await page.request.get(`${origin}/v1/agents`)).json();
      assert.equal(status.agents[0].screen_state, 'dialog', 'the agent list must detect the permission request');
      await teammate.locator('.xterm-helper-textarea').focus();
      await teammate.keyboard.press('Enter');
      const deadline = Date.now() + 45000;
      while (true) {
        try { if (await fs.readFile(proof, 'utf8') === 'approved') break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (Date.now() >= deadline) throw new Error('The approved write did not create its disposable proof file');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      await page.waitForFunction(() => document.querySelector('.session-head .session-state')?.dataset.state === 'idle', null, { timeout: 45000 });
      assert.equal(await fs.readFile(proof, 'utf8'), 'approved');
    });
    await step('read-only observer can watch and cannot mutate', async () => {
      const invitation = execFileSync(binary, ['invite', '-org', org, '-hub', origin,
        '-id', 'smoke-observer', '-read-only'], { encoding: 'utf8' });
      observer = await join(invitation.match(/http:\/\/\S+\/join#kolo_[A-Za-z0-9_-]+/)[0], 'Smoke observer');
      await observer.goto(`${origin}/#/agent/live-agent`);
      await live(observer);
      assert.equal((await observer.request.delete(`${origin}/v1/agents/live-agent`)).status(), 403);
      assert.equal(await observer.locator('.session-access').textContent(), 'Read-only');
      await contains(observer, 'PERMISSION_COMPLETE');
    });
    await step('revoking a member removes existing browser access', async () => {
      const member = (await (await teammate.request.get(`${origin}/v1/agents`)).json()).you;
      execFileSync(binary, ['who', '-org', org, '-remove', member.id], { encoding: 'utf8' });
      await teammate.waitForFunction(() => !document.querySelector('.signin')?.hidden, null, { timeout: 15000 });
      assert.equal((await teammate.request.get(`${origin}/v1/agents`)).status(), 401);
      assert.equal((await screen(teammate)).trim(), '');
      assert.equal(await teammate.evaluate(() => window.testTerminal.options.disableStdin), true);
      assert.equal(await teammate.locator('.app').isHidden(), true);
    });
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.error = redact(error.message);
    await snapshot('failure').catch(() => {});
    process.exitCode = 1;
  } finally {
    if (page && origin) await page.request.delete(`${origin}/v1/agents/live-agent`).catch(() => {});
    await browser?.close();
    if (hub && hub.exitCode === null) await new Promise((resolve) => {
      const deadline = setTimeout(() => hub.kill('SIGKILL'), 5000);
      hub.once('exit', () => { clearTimeout(deadline); resolve(); });
      hub.kill('SIGINT');
    });
    await fs.writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    await fs.writeFile(path.join(dir, 'host.log'), redact(stderr), { mode: 0o600 });
    console.log(`Report: ${path.join(dir, 'report.json')}`);
    if (report.error) console.error(report.error);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
