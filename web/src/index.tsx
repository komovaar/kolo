import { browserRuntime } from './app/environment';
import { bindControllers } from './app/bind';
import { startWorkspace } from './app/bootstrap';
import { initializeAuthForms } from './features/auth/forms';
import { initializeWorkspaceControls } from './features/workspace/controls';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { creation, CreationDialog } from './features/sessions/creation';
import { overview, Overview } from './features/sessions/overview';
import { share, SessionShare } from './features/sessions/share';
import { switcher, SessionSwitcher } from './features/sessions/switcher';
import { WorkspaceBoundary } from './core/error-boundary';

// Components move into this root one workflow at a time. The terminal keeps
// its independent lifecycle and DOM; streaming output never enters React state.
const container = document.getElementById('react-root');
if (!container) throw new Error('Missing Kolo interface root');
window.KoloUI = { creation, overview, share, switcher };
const root = createRoot(container);
flushSync(() => root.render(<WorkspaceBoundary><CreationDialog /><Overview /><SessionShare /><SessionSwitcher /></WorkspaceBoundary>));

try {
  const runtime = bindControllers(browserRuntime());
  startWorkspace(runtime);
  initializeAuthForms();
  initializeWorkspaceControls(runtime);
} catch {
  window.KoloStartup.fail();
}
