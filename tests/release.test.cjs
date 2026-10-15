const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kolo-release-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Exercise the real shell installer with local HTTP responses and real archives.
// Unexpected requests fail instead of escaping to the network.
function installer(t, { version = 'nightly', stable = true, corrupt = false, listed = true } = {}) {
  const dir = directory(t);
  const bin = path.join(dir, 'bin');
  const output = path.join(dir, 'installed');
  const source = path.join(dir, 'source');
  for (const folder of [bin, output, source]) fs.mkdirSync(folder);
  const executable = path.join(source, 'kolo');
  fs.writeFileSync(executable, '#!/bin/sh\nprintf "fixture kolo\\n"\n', { mode: 0o755 });
  const archive = path.join(dir, 'archive.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', source, 'kolo']);
  const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const archiveName = `kolo_${version}_linux_amd64.tar.gz`;
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), `${digest}  ${listed ? archiveName : 'another-archive.tar.gz'}\n`);
  if (corrupt) fs.appendFileSync(archive, 'tampered');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ version, stable, archiveName }));
  fs.writeFileSync(path.join(bin, 'uname'), '#!/bin/sh\ncase "$1" in -s) echo Linux;; -m) echo x86_64;; *) exit 1;; esac\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const dir = process.env.KOLO_INSTALL_FIXTURE;
const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
const args = process.argv.slice(2);
const address = args.find((arg) => arg.startsWith('https://'));
fs.appendFileSync(path.join(dir, 'requests'), address + '\\n');
const url = new URL(address);
const prefix = '/komovaar/kolo';
if (url.hostname === 'github.com' && url.pathname === prefix + '/releases/latest') {
  if (config.stable) console.log('Location: https://github.com' + prefix + '/releases/tag/' + config.version + '\\r');
  process.exit(config.stable ? 0 : 22);
}
if (url.hostname === 'api.github.com' && url.pathname === '/repos' + prefix + '/releases/latest') {
  if (config.stable) console.log(JSON.stringify({ tag_name: config.version }));
  process.exit(config.stable ? 0 : 22);
}
const base = prefix + '/releases/download/' + config.version + '/';
let file;
if (url.hostname === 'github.com' && url.pathname === base + config.archiveName) file = 'archive.tar.gz';
if (url.hostname === 'github.com' && url.pathname === base + 'SHA256SUMS') file = 'SHA256SUMS';
if (!file) { console.error('Unexpected fixture request: ' + address); process.exit(1); }
fs.copyFileSync(path.join(dir, file), args[args.indexOf('-o') + 1]);
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    KOLO_INSTALL_DIR: output, KOLO_INSTALL_FIXTURE: dir };
  delete env.KOLO_VERSION;
  return {
    output, dir,
    run(explicit = true) {
      return spawnSync('sh', [path.join(root, 'install')], {
        env: explicit ? { ...env, KOLO_VERSION: version } : env, encoding: 'utf8',
      });
    },
    requests() { return fs.readFileSync(path.join(dir, 'requests'), 'utf8'); },
  };
}

test('explicit nightly installs and runs a checked archive without latest-release lookup', (t) => {
  const fixture = installer(t, { stable: false });
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(execFileSync(path.join(fixture.output, 'kolo'), { encoding: 'utf8' }), 'fixture kolo\n');
  assert.doesNotMatch(fixture.requests(), /releases\/latest/);
});

test('an explicit alpha tag installs without needing a non-prerelease release', (t) => {
  const fixture = installer(t, { version: 'v0.2.0-alpha.1', stable: false });
  const result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(fixture.requests(), /releases\/download\/v0\.2\.0-alpha\.1\//);
  assert.doesNotMatch(fixture.requests(), /releases\/latest/);
});

test('default installation follows the latest version-release redirect', (t) => {
  const fixture = installer(t, { version: 'v0.2.0' });
  const result = fixture.run(false);
  assert.equal(result.status, 0, result.stderr);
  assert.match(fixture.requests(), /releases\/latest/);
  assert.match(fixture.requests(), /releases\/download\/v0\.2\.0\//);
});

test('no version release explains how to select alpha and never silently installs nightly', (t) => {
  const fixture = installer(t, { stable: false });
  const result = fixture.run(false);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /KOLO_VERSION=nightly/);
  assert.doesNotMatch(fixture.requests(), /releases\/download/);
  assert.equal(fs.existsSync(path.join(fixture.output, 'kolo')), false);
});

for (const [name, options, message] of [
  ['tampered archive', { corrupt: true }, /checksum mismatch/],
  ['archive missing from checksums', { listed: false }, /not listed/],
]) {
  test(`${name} cannot replace an existing installation`, (t) => {
    const fixture = installer(t, options);
    const executable = path.join(fixture.output, 'kolo');
    fs.writeFileSync(executable, 'keep existing installation');
    const result = fixture.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, message);
    assert.equal(fs.readFileSync(executable, 'utf8'), 'keep existing installation');
  });
}

test('release references resolve lightweight and annotated tags to their commits', (t) => {
  const dir = directory(t);
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('-c', 'user.name=Release test', '-c', 'user.email=release@example.invalid',
    '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-qm', 'fixture');
  const sha = git('rev-parse', 'HEAD');
  git('tag', 'v0.2.0');
  git('-c', 'user.name=Release test', '-c', 'user.email=release@example.invalid',
    'tag', '-a', 'v0.3.0-alpha.1', '-m', 'alpha');
  git('tag', 'v0.3.0+build-one');
  const resolve = (tag) => spawnSync('bash', [path.join(root, 'scripts/release-ref.sh'), tag],
    { cwd: dir, encoding: 'utf8' });
  for (const [tag, prerelease] of [['v0.2.0', false], ['v0.3.0-alpha.1', true], ['v0.3.0+build-one', false]]) {
    const result = resolve(tag);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `tag=${tag}\nsha=${sha}\nprerelease=${prerelease}\n`);
  }
  for (const tag of ['main', 'v0.9.0', 'v0.2.0\nsha=forged', 'v0.2.0; echo injected']) {
    const result = resolve(tag);
    assert.notEqual(result.status, 0, tag);
    assert.equal(result.stdout, '', tag);
  }
});
