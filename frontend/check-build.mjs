// Check tracked assets against a fresh build, including missing/extra files.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = 'internal/hub/ui/assets/react';
function snapshot() {
  return new Map(readdirSync(directory).sort().map((name) =>
    [name, readFileSync(join(directory, name))]));
}
const before = snapshot();
execFileSync('npm', ['run', 'build:ui'], { stdio: 'inherit' });
const after = snapshot();
if (before.size !== after.size || [...after].some(([name, data]) => !before.get(name)?.equals(data))) {
  console.error('Compiled UI does not match its source. Run npm run build:ui and commit the assets.');
  process.exitCode = 1;
}
