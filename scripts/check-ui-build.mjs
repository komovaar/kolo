// Check tracked assets against a fresh build, including missing/extra files.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const directory = 'internal/hub/ui';
function snapshot() {
  const files = [];
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) walk(file);
      else files.push([relative(directory, file), readFileSync(file)]);
    }
  }
  walk(directory);
  return new Map(files.sort(([a], [b]) => a.localeCompare(b, 'en')));
}
const before = snapshot();
execFileSync('npm', ['run', 'build:ui'], { stdio: 'inherit' });
const after = snapshot();
if (before.size !== after.size || [...after].some(([name, data]) => !before.get(name)?.equals(data))) {
  console.error('Compiled UI does not match its source. Run npm run build:ui and commit the assets.');
  process.exitCode = 1;
}
