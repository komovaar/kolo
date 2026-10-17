import { Attention } from '../features/workspace/attention.ts';
import type { WorkspaceRuntime } from '../core/runtime.ts';

// Mount once: the terminal and browser listeners share the page lifetime.
export function startWorkspace(runtime: WorkspaceRuntime) {
  runtime.views = { boot: runtime.el('.boot'), signin: runtime.el('.signin'), app: runtime.el('.app') };
  runtime.hosts = [];
  runtime.signedIn = false;
  runtime.authLost = false;
  runtime.me = { read_only: true };
  runtime.retryPending = null;
  runtime.contextAckPending = null;
  runtime.lastAgents = [];
  runtime.refreshRun = 0;
  runtime.authRun = 0;
  runtime.attention = new Attention(runtime.el('.attention-toggle'), runtime.agentInURL, (name) => {
    runtime.location.hash = `#/agent/${name}`;
  }, { window: runtime.window, document: runtime.document, localStorage: runtime.localStorage, Notification: runtime.window.Notification });
  runtime.addEventListener('pagehide', () => runtime.attention.reset());
  runtime.authChannel = null;
  try { runtime.authChannel = new runtime.BroadcastChannel('kolo-auth'); } catch (_) {}
  if (runtime.authChannel) runtime.authChannel.onmessage = (event) => {
    if (event.data === 'signout') runtime.signOut();
  };
  runtime.addEventListener('storage', (event) => {
    if (event.key === 'kolo-signout' && event.newValue) runtime.signOut();
  });
  runtime.el('.me-menu form').addEventListener('submit', () => {
    runtime.signOut();
    if (runtime.authChannel) runtime.authChannel.postMessage('signout');
    // Older browsers can still notify sibling tabs; storage may be blocked.
    try { runtime.localStorage.setItem('kolo-signout', `${Date.now()}-${Math.random()}`); } catch (_) {}
  });
  runtime.el('.boot-retry').onclick = runtime.retryWorkspace;
  runtime.el('.workspace-retry').onclick = runtime.retryWorkspace;
  runtime.renamingId = null;
  runtime.renameDraft = '';
  runtime.collapsed = {};
  runtime.collapsedProjects = new Set();
  runtime.el('.side .log-open').onclick = () => { runtime.setNavigation(false); runtime.location.hash = '#/log'; };
  runtime.el('.brand-home').onclick = () => { runtime.setNavigation(false); runtime.location.hash = ''; };
  runtime.createPending = false;
  runtime.window.KoloController = { focusSession(name) { runtime.location.hash = `#/agent/${name}`; }, createSession: runtime.createSession, closeCreate: runtime.closeCreate, openCreate: runtime.openCreate, kindGlyph: runtime.kindGlyph, programKind: runtime.programKind, programOf: runtime.programOf, sessionState: runtime.sessionState,
    prepareOverlay() { runtime.setNavigation(false); runtime.setAccountMenu(false); runtime.window.KoloUI.share.close(); },
    suspend() {
      ++runtime.authRun;
      ++runtime.refreshRun;
      runtime.signedIn = false;
      runtime.authLost = true;
      runtime.clearTimeout(runtime.reconnectTimer ?? undefined);
      runtime.reconnectTimer = null;
      runtime.term.options.disableStdin = true;
      const previous = runtime.socket;
      runtime.socket = null;
      previous?.close();
    },
  };
  runtime.el('.me').onclick = () => runtime.setAccountMenu(runtime.el('.me-menu').hidden);
  runtime.el('.me-wrap').onkeydown = (event) => {
    if (event.key === 'Escape' && !runtime.el('.me-menu').hidden) {
      event.preventDefault();
      event.stopPropagation();
      runtime.setAccountMenu(false);
      runtime.el('.me').focus();
    }
  };
  runtime.el('.me-wrap').addEventListener('focusout', (event) => {
    if (!runtime.el('.me-wrap').contains(event.relatedTarget as Node | null)) runtime.setAccountMenu(false);
  });
  runtime.document.addEventListener('click', (ev) => {
    if (!runtime.el('.me-wrap').contains(ev.target as Node | null)) runtime.setAccountMenu(false);
  });
  runtime.baseFont = 14;
  runtime.term = runtime.createTerminal();
  runtime.terminalOwner = null;
  runtime.screenReady = false;
  runtime.typist = null;
  runtime.socket = null;
  runtime.watching = null;
  runtime.reconnectTimer = null;
  runtime.zoom = 1;
  runtime.zoomRange = { least: 0.5, most: 4 };
  runtime.fitting = false;
  runtime.requestedSize = null;
  runtime.clipboardViewer = null;
  runtime.viewerID = null;
  runtime.activeViewer = null;
  runtime.viewportSize = null;
  runtime.watcher = new runtime.ResizeObserver(() => runtime.fit());
  runtime.watcher.observe(runtime.el('#term'));
  runtime.addEventListener('resize', runtime.fit);
  runtime.document.fonts.ready.then(runtime.fit);
  runtime.window.visualViewport?.addEventListener('resize', runtime.fit);
  runtime.el('.zoom .out').onclick = () => runtime.setZoom(runtime.zoom / 1.25);
  runtime.el('.zoom .in').onclick = () => runtime.setZoom(runtime.zoom * 1.25);
  runtime.el('.zoom .at').onclick = () => runtime.setZoom(1);
  runtime.el('.context-ack').onclick = runtime.acknowledgeContext;
  runtime.el('.watch .restart').onclick = () => {
    if (!runtime.canControl()) return;
    const name = runtime.agentInURL();
    if (name && runtime.lastAgents.find((a) => a.name === name)?.status === 'failed') {
      runtime.retrySession(name);
      return;
    }
    if (!runtime.confirm('Restart this agent? Its current work will be interrupted. Kolo will resume its conversation when this agent supports it.')) return;
    runtime.tell({ type: 'restart' });
  };
  runtime.el('.session-stop').onclick = () => {
    const name = runtime.agentInURL();
    if (name) runtime.stop(name);
  };
  runtime.logRun = 0;
  runtime.el('.log-retry').onclick = runtime.drawLog;
  runtime.sidebarMedia = runtime.matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px)');
  runtime.sidebarHandle = runtime.el('.side-resize');
  runtime.sidebarWidth = 240;
  try {
    const saved = Number(runtime.localStorage.getItem('kolo-sidebar-width'));
    if (Number.isFinite(saved) && saved > 0) runtime.sidebarWidth = saved;
  } catch (_) {}
  runtime.sidebarDrag = null;
  runtime.sidebarHandle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || runtime.sidebarMedia.matches) return;
    event.preventDefault();
    runtime.sidebarDrag = { id: event.pointerId, x: event.clientX, width: runtime.el('.side').getBoundingClientRect().width };
    runtime.sidebarHandle.setPointerCapture(event.pointerId);
    runtime.el('.app').classList.add('resizing');
  });
  runtime.sidebarHandle.addEventListener('pointermove', (event) => {
    if (!runtime.sidebarDrag || runtime.sidebarDrag.id !== event.pointerId) return;
    runtime.updateSidebarWidth(runtime.sidebarDrag.width + event.clientX - runtime.sidebarDrag.x, true);
  });
  runtime.sidebarHandle.addEventListener('pointerup', runtime.endSidebarDrag);
  runtime.sidebarHandle.addEventListener('pointercancel', runtime.endSidebarDrag);
  runtime.sidebarHandle.addEventListener('lostpointercapture', runtime.endSidebarDrag);
  runtime.sidebarHandle.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const width = runtime.el('.side').getBoundingClientRect().width;
    runtime.updateSidebarWidth(event.key === 'Home' ? 180 : event.key === 'End' ? 480 :
      width + (event.key === 'ArrowLeft' ? -10 : 10), true);
  });
  runtime.addEventListener('resize', () => {
    runtime.endSidebarDrag();
    runtime.updateSidebarWidth(runtime.sidebarWidth);
  });
  runtime.updateSidebarWidth(runtime.sidebarWidth);
  new runtime.ResizeObserver(() => runtime.updateSidebarWidth(runtime.sidebarWidth)).observe(runtime.el('.app'));
  runtime.el('.mobile-menu').onclick = () => runtime.setNavigation(runtime.el('.mobile-menu').getAttribute('aria-expanded') !== 'true');
  runtime.el('.nav-shade').onclick = () => runtime.setNavigation(false);
  runtime.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && runtime.el('.mobile-menu').getAttribute('aria-expanded') === 'true') {
      runtime.setNavigation(false);
      runtime.el('.mobile-menu').focus();
    }
  });
  runtime.matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px)').addEventListener('change', () => runtime.setNavigation(false));
  runtime.addEventListener('hashchange', runtime.route);
  runtime.route();
  setInterval(() => {
    if (!runtime.signedIn) return;
    runtime.refresh();
    // Only while the newest entry is in view. Entries arrive at the top, and
    // redrawing under somebody who has scrolled back moves what they are
    // reading out from under them.
    if (runtime.logInURL() && runtime.el('.log-rows').scrollTop === 0) runtime.drawLog();
  }, 3000);

}
