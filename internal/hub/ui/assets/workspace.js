// Workspace mechanics that remain independent of React rendering.
(() => {
  const app = el('.app');
  let focusSession = null;
  function updateOverlayHeight() {
    document.documentElement.style.setProperty('--kolo-visual-height', `${window.visualViewport?.height || innerHeight}px`);
  }
  updateOverlayHeight();
  addEventListener('resize', updateOverlayHeight);
  window.visualViewport?.addEventListener('resize', updateOverlayHeight);
  function syncControls() {
    const start = el('.side-new');
    start.hidden = !canControl();
    start.disabled = !hosts.some((host) => host.allow?.length && host.dirs?.length);
    start.title = start.disabled ? 'Connect a machine that shares programs and directories first.' : 'Start a shared agent or shell';
  }
  el('.side-new').onclick = () => openCreate(null);
  new MutationObserver(syncControls).observe(el('.home-new'), { attributes: true, attributeFilter: ['hidden', 'disabled'] });
  new MutationObserver(() => {
    syncControls();
    if (app.hidden) {
      window.KoloUI.switcher.close(false);
      window.KoloUI.share.close();
      focusSession = null;
    }
  }).observe(app, { attributes: true, attributeFilter: ['hidden'] });
  syncControls();
  const connection = el('.session-connection');
  function focusTerminal() {
    if (!focusSession || agentInURL() !== focusSession || watching !== focusSession || !screenReady) return;
    focusSession = null;
    term.focus();
  }
  window.KoloController.focusSession = (name) => {
    setNavigation(false);
    setAccountMenu(false);
    focusSession = name;
    location.hash = `#/agent/${name}`;
    el('.session-title').tabIndex = -1;
    el('.session-title').focus({ preventScroll: true });
    focusTerminal();
  };
  new MutationObserver(() => {
    connection.dataset.state = connection.textContent === 'Live connection' ? 'live' : 'pending';
    focusTerminal();
  }).observe(connection, { childList: true, characterData: true, subtree: true });
  const themeToggle = el('.theme-toggle');
  function themeLabel() {
    themeToggle.textContent = document.documentElement.dataset.theme === 'light' ? 'Use dark appearance' : 'Use light appearance';
  }
  themeToggle.onclick = () => {
    const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('kolo-theme', theme); } catch (_) {}
    themeLabel();
    setAccountMenu(false);
    el('.me').focus();
  };
  new MutationObserver(themeLabel).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  themeLabel();

  addEventListener('hashchange', () => window.KoloUI.share.close());
})();
