import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { creation, CreationDialog } from './creation';
import { overview, Overview } from './overview';
import { share, SessionShare } from './share';
import { switcher, SessionSwitcher } from './switcher';
import { WorkspaceBoundary } from './error-boundary';

// Components move into this root one workflow at a time. The terminal keeps
// its independent lifecycle and DOM; streaming output never enters React state.
const container = document.getElementById('react-root');
if (!container) throw new Error('Missing Kolo interface root');
window.KoloUI = { creation, overview, share, switcher };
const root = createRoot(container);
flushSync(() => root.render(<WorkspaceBoundary><CreationDialog /><Overview /><SessionShare /><SessionSwitcher /></WorkspaceBoundary>));

// The transitional controller starts only after React has mounted its owned
// regions. Keep these classic scripts in order while their components migrate.
async function loadScript(source: string) {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = source;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${source}`));
    document.body.append(script);
  });
}
try {
  for (const source of ['/assets/session-controller.js', '/assets/auth.js', '/assets/workspace.js']) await loadScript(source);
} catch {
  window.KoloStartup.fail();
}
