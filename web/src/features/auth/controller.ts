import type { WorkspaceRuntime } from '../../core/runtime.ts';

export function canControl(runtime: WorkspaceRuntime) {
  return runtime.signedIn && !runtime.me.read_only;
}

export function applyAccess(runtime: WorkspaceRuntime) {
  const allowed = runtime.canControl();
  runtime.term.options.disableStdin = !allowed || !runtime.screenReady || !runtime.socket || runtime.socket.readyState !== runtime.WebSocket.OPEN;
  runtime.el('.home-new').hidden = !allowed;
  runtime.el('.watch .restart').hidden = !allowed;
  runtime.el('.session-stop').hidden = !allowed;
  const selected = runtime.lastAgents.find((a) => a.name === runtime.agentInURL());
  const failed = selected?.status === 'failed';
  runtime.el('.watch .restart').textContent = failed ? 'Retry' : 'restart';
  runtime.el('.watch .restart').disabled = !allowed || (runtime.retryPending && runtime.retryPending.name === selected?.name) ||
    (failed ? !runtime.hosts.some((h) => h.id === selected.host) : !runtime.screenReady || !runtime.socket || runtime.socket.readyState !== runtime.WebSocket.OPEN);
  if (!allowed) {
    runtime.renamingId = null;
    if (!runtime.el('.scrim').hidden) runtime.closeCreate();
  }
}

export function signOut(runtime: WorkspaceRuntime) {
  ++runtime.refreshRun;
  ++runtime.authRun;
  runtime.signedIn = false;
  runtime.authLost = true;
  runtime.close();
  runtime.retryPending = null;
  runtime.contextAckPending = null;
  runtime.el('.context-warning').hidden = true;
  runtime.el('.context-warning-text').textContent = '';
  runtime.me = { read_only: true };
  runtime.hosts = [];
  runtime.lastAgents = [];
  runtime.window.KoloUI.switcher.close(false);
  runtime.window.KoloUI.share.close();
  runtime.applyAccess();
  runtime.attention.reset();
  runtime.collapsedProjects.clear();
  runtime.window.KoloUI.creation.clear();
  runtime.el('.groups').replaceChildren();
  runtime.window.KoloUI.overview.clear();
  runtime.drawChoices();
  runtime.el('.workspace-message').hidden = true;
  runtime.el('.log-rows').replaceChildren();
  runtime.el('.log-message').textContent = '';
  runtime.el('.log-message').hidden = true;
  runtime.el('.log-retry').hidden = true;
  runtime.el('.session-context').textContent = '';
  runtime.el('.session-error').textContent = '';
  runtime.el('.session-error').hidden = true;
  runtime.el('.me-menu').hidden = true;
  runtime.el('.me').setAttribute('aria-expanded', 'false');
  runtime.el('.me .name').textContent = '';
  runtime.el('.me .initial').textContent = '';
  runtime.el('.workspace-label').textContent = '';
  runtime.el('.workspace-label').title = '';
  runtime.show('signin');
  runtime.el('.signin .problem').hidden = !runtime.location.search.includes('refused');
  runtime.el('#signin-token').focus();
}

export async function refresh(runtime: WorkspaceRuntime) {
  if (runtime.authLost) return null;
  const run = ++runtime.refreshRun;
  let resp;
  try {
    resp = await runtime.fetch('/v1/agents');
  } catch (_) {
    if (run === runtime.refreshRun && runtime.signedIn) runtime.el('.me .status').textContent = 'connection lost';
    if (run === runtime.refreshRun) {
      runtime.el('.workspace-message').hidden = !runtime.signedIn;
      runtime.el('.boot-message').textContent = 'Could not reach Kolo. Check your connection and try again.';
      runtime.el('.boot-retry').hidden = false;
    }
    return null;
  }
  // A slower request must not overwrite the result of one made after it.
  if (run !== runtime.refreshRun) return null;
  if (resp.status === 401) {
    runtime.signOut();
    return null;
  }
  if (!resp.ok) {
    runtime.el('.me .status').textContent = `hub error ${resp.status}`;
    runtime.el('.workspace-message').hidden = !runtime.signedIn;
    runtime.el('.boot-message').textContent = `Kolo is unavailable (${resp.status}). Try connecting again.`;
    runtime.el('.boot-retry').hidden = false;
    return null;
  }
  let data;
  try {
    data = await resp.json();
  } catch (_) {
    if (run !== runtime.refreshRun) return null;
    runtime.el('.me .status').textContent = 'unreadable response';
    runtime.el('.workspace-message').hidden = !runtime.signedIn;
    runtime.el('.boot-message').textContent = 'Kolo returned an unreadable response. Try connecting again.';
    runtime.el('.boot-retry').hidden = false;
    return null;
  }
  if (run !== runtime.refreshRun) return null;
  runtime.signedIn = true;
  runtime.show('app');
  runtime.el('.workspace-message').hidden = true;
  runtime.el('.me .status').textContent = data.you.read_only ? 'read-only · online' : 'online';
  runtime.el('.me .name').textContent = data.you.name;
  runtime.el('.mobile-title').textContent = data.org || 'Kolo';
  runtime.el('.workspace-label').textContent = data.org || 'Workspace';
  runtime.el('.workspace-label').title = data.org || 'Workspace';
  runtime.el('.me .initial').textContent = (data.you.name.trim().slice(0, 1) || '?').toUpperCase();
  runtime.me = data.you;
  runtime.hosts = data.hosts;
  runtime.lastAgents = data.agents || [];
  runtime.applyAccess();
  runtime.attention.update(runtime.lastAgents);
  if (!runtime.renamingId) runtime.drawGroups(runtime.lastAgents);
  runtime.drawHome();
  runtime.drawSession();
  runtime.reconcileWatch();
  runtime.drawChoices();
  return data;
}
