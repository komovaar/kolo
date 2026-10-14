import type { WorkspaceRuntime } from '../../core/runtime.ts';

export function show(runtime: WorkspaceRuntime, name: keyof WorkspaceRuntime["views"]) {
  for (const [key, node] of Object.entries(runtime.views)) node.hidden = key !== name;
}

export function agentInURL(runtime: WorkspaceRuntime) {
  const m = runtime.location.hash.match(/^#\/agent\/([a-z0-9-]+)$/);
  return m && m[1];
}

export function logInURL(runtime: WorkspaceRuntime) {
  return runtime.location.hash === '#/log';
}

export function updateMobileTitle(runtime: WorkspaceRuntime) {
  const selected = runtime.agentInURL();
  const active = runtime.lastAgents.find((agent) => agent.name === selected);
  runtime.el('.mobile-title').textContent = selected ? (active?.label || active?.title || selected)
    : runtime.logInURL() ? 'Activity' : runtime.el('.workspace-label').textContent || 'Kolo';
}

export async function retryWorkspace(runtime: WorkspaceRuntime) {
  runtime.el('.boot-message').textContent = 'Connecting to Kolo…';
  runtime.el('.boot-retry').disabled = true;
  runtime.el('.workspace-retry').disabled = true;
  try { await runtime.route(); }
  finally {
    runtime.el('.boot-retry').disabled = false;
    runtime.el('.workspace-retry').disabled = false;
  }
}

export function setAccountMenu(runtime: WorkspaceRuntime, open: boolean) {
  runtime.el('.me-menu').hidden = !open;
  runtime.el('.me').setAttribute('aria-expanded', String(open));
}

export function updateSidebarWidth(runtime: WorkspaceRuntime, width: number, save = false) {
  if (!runtime.el('.app').clientWidth) return;
  const max = Math.min(480, Math.floor(runtime.el('.app').clientWidth / 2));
  const clamped = Math.max(180, Math.min(max, width));
  runtime.el('.app').style.setProperty('--sidebar-width', `${clamped}px`);
  runtime.sidebarHandle.setAttribute('aria-valuemin', '180');
  runtime.sidebarHandle.setAttribute('aria-valuemax', String(max));
  runtime.sidebarHandle.setAttribute('aria-valuenow', String(Math.round(clamped)));
  if (save) {
    runtime.sidebarWidth = clamped;
    try { runtime.localStorage.setItem('kolo-sidebar-width', String(clamped)); } catch (_) {}
  }
}

export function endSidebarDrag(runtime: WorkspaceRuntime) {
  runtime.sidebarDrag = null;
  runtime.el('.app').classList.remove('resizing');
}

export function setNavigation(runtime: WorkspaceRuntime, open: boolean) {
  const mobile = runtime.matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px)').matches;
  const focusInSidebar = runtime.el('.side').contains(runtime.document.activeElement);
  runtime.el('.app').classList.toggle('nav-open', mobile && open);
  runtime.el('.mobile-menu').setAttribute('aria-expanded', String(mobile && open));
  runtime.el('.side').inert = mobile && !open;
  runtime.el('main').inert = mobile && open;
  if (mobile && open) {
    const selected = runtime.el('.agent.on');
    (selected?.getClientRects().length ? selected : runtime.el('.side-overview')).focus();
  }
  else if (mobile && focusInSidebar) runtime.el('.mobile-menu').focus();
}

export async function route(runtime: WorkspaceRuntime) {
  runtime.setNavigation(false);
  runtime.attention.renderTitle(runtime.lastAgents);
  const name = runtime.agentInURL();
  const log = runtime.logInURL();
  runtime.updateMobileTitle();
  if (!name && !log) runtime.el('.side-overview').setAttribute('aria-current', 'page');
  else runtime.el('.side-overview').removeAttribute('aria-current');
  if (log) runtime.el('.log-open').setAttribute('aria-current', 'page');
  else runtime.el('.log-open').removeAttribute('aria-current');
  if (runtime.watching !== name) runtime.close();
  // The screen is put up before the list is fetched, so opening an agent does
  // not wait on a round trip that has nothing to do with it.
  runtime.el('.watch').hidden = !name;
  runtime.el('.log').hidden = !log;
  runtime.el('.home').hidden = !!name || log;
  runtime.drawSession();
  const data = await runtime.refresh();
  if (!data || name !== runtime.agentInURL() || log !== runtime.logInURL()) return;
  if (name) runtime.reconcileWatch();
  else runtime.close();
  // After the list rather than beside it, so the first draw already knows the
  // labels its rows are named by.
  if (log) runtime.drawLog();
}
