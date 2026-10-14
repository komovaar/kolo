import type { WorkspaceRuntime } from '../../core/runtime.ts';
// Workspace mechanics that remain independent of React rendering.
export function initializeWorkspaceControls(runtime: WorkspaceRuntime) {
  const app = runtime.el('.app');
  let focusSession: string | null = null;
  function updateOverlayHeight() {
    document.documentElement.style.setProperty('--kolo-visual-height', `${window.visualViewport?.height || innerHeight}px`);
  }
  updateOverlayHeight();
  addEventListener('resize', updateOverlayHeight);
  window.visualViewport?.addEventListener('resize', updateOverlayHeight);
  function syncControls() {
    const start = runtime.el('.side-new');
    start.hidden = !runtime.canControl();
    start.disabled = !runtime.hosts.some((host) => host.allow?.length && host.dirs?.length);
    start.title = start.disabled ? 'Connect a machine that shares programs and directories first.' : 'Start a shared agent or shell';
  }
  runtime.el('.side-new').onclick = () => runtime.openCreate(null);
  new MutationObserver(syncControls).observe(runtime.el('.home-new'), { attributes: true, attributeFilter: ['hidden', 'disabled'] });
  new MutationObserver(() => {
    syncControls();
    if (app.hidden) {
      window.KoloUI.switcher.close(false);
      window.KoloUI.share.close();
      focusSession = null;
    }
  }).observe(app, { attributes: true, attributeFilter: ['hidden'] });
  syncControls();
  const connection = runtime.el('.session-connection');
  function focusTerminal() {
    if (!focusSession || runtime.agentInURL() !== focusSession || runtime.watching !== focusSession || !runtime.screenReady) return;
    focusSession = null;
    runtime.term.focus();
  }
  window.KoloController.focusSession = (name) => {
    runtime.setNavigation(false);
    runtime.setAccountMenu(false);
    focusSession = name;
    location.hash = `#/agent/${name}`;
    runtime.el('.session-title').tabIndex = -1;
    runtime.el('.session-title').focus({ preventScroll: true });
    focusTerminal();
  };
  new MutationObserver(() => {
    connection.dataset.state = connection.textContent === 'Live connection' ? 'live' : 'pending';
    focusTerminal();
  }).observe(connection, { childList: true, characterData: true, subtree: true });
  const themeToggle = runtime.el('.theme-toggle');
  function themeLabel() {
    themeToggle.textContent = document.documentElement.dataset.theme === 'light' ? 'Use dark appearance' : 'Use light appearance';
  }
  themeToggle.onclick = () => {
    const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('kolo-theme', theme); } catch (_) {}
    themeLabel();
    runtime.setAccountMenu(false);
    runtime.el('.me').focus();
  };
  new MutationObserver(themeLabel).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  themeLabel();

  addEventListener('hashchange', () => window.KoloUI.share.close());
}
