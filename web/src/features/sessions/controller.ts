import type { WorkspaceRuntime, Agent, Control } from '../../core/runtime.ts';

export function drawHome(runtime: WorkspaceRuntime) {
  runtime.updateMobileTitle();
  runtime.window.KoloUI.overview.update({ hosts: runtime.hosts, agents: runtime.lastAgents, allowed: runtime.canControl() });
}

export function sessionState(runtime: WorkspaceRuntime, agent: Agent | null | undefined, connected = true) {
  if (!agent) return { key: 'unknown', label: 'Session unavailable' };
  if (!connected) return { key: 'disconnected', label: 'Machine disconnected' };
  if (agent.status === 'failed') return { key: 'failed', label: 'Failed' };
  if (agent.status === 'starting') return { key: 'starting', label: 'Starting' };
  if (agent.status !== 'running') return { key: 'unknown', label: agent.status || 'Status unavailable' };
  switch (agent.screen_state) {
    case 'busy': return { key: 'busy', label: 'Working' };
    case 'dialog': return { key: 'dialog', label: 'Waiting for input' };
    case 'idle': return { key: 'idle', label: 'Ready' };
    default: return { key: 'unknown', label: 'Running · activity unknown' };
  }
}

export function drawSession(runtime: WorkspaceRuntime) {
  const name = runtime.agentInURL();
  const agent = runtime.lastAgents.find((a) => a.name === name);
  const state = runtime.sessionState(agent, !!agent && runtime.hosts.some((h) => h.id === agent.host));
  runtime.el('.session-title').textContent = agent ? (agent.label || agent.title || agent.name) : name || 'Session';
  runtime.el('.session-title').title = runtime.el('.session-title').textContent;
  runtime.el('.session-context').textContent = agent
    ? `${agent.host} · ${agent.command} · ${agent.dir}` : 'Waiting for session details';
  runtime.el('.session-context').title = runtime.el('.session-context').textContent;
  runtime.el('.session-head .session-state').textContent = state.label;
  runtime.el('.session-head .session-state').dataset.state = state.key;
  runtime.el('.session-head .session-state').title = agent?.error ||
    (agent?.status === 'running' && state.key === 'unknown' ? 'Activity is unknown; typing still works.' : '');
  runtime.el('.session-access').textContent = runtime.canControl() ? 'Control access' : 'Read-only access';
  runtime.el('.session-stop').disabled = !agent || !runtime.canControl() || !runtime.hosts.some((h) => h.id === agent.host);
  runtime.el('.session-error').textContent = agent?.error || (agent?.status === 'failed' ? 'The program could not stay running.' : '');
  runtime.el('.session-error').hidden = !runtime.el('.session-error').textContent;
  const reset = agent?.context_resets?.find((r) => !r.acknowledged);
  runtime.el('.context-warning').hidden = !reset;
  runtime.el('.context-warning-text').textContent = reset
    ? 'Conversation reset: Kolo could not safely resume the previous conversation and started fresh.' +
      (reset.previous_session ? ` Previous conversation: ${reset.previous_session}.` : '') +
      ' Restarting does not recover the previous conversation automatically.' : '';
  runtime.el('.context-ack').hidden = !runtime.canControl();
  runtime.el('.context-ack').disabled = !!runtime.contextAckPending || !agent || !runtime.hosts.some((h) => h.id === agent.host);
  runtime.applyAccess();
}

export function drawChoices(runtime: WorkspaceRuntime) {
  runtime.window.KoloUI.creation.update(runtime.hosts, runtime.canControl());
}

export function openCreate(runtime: WorkspaceRuntime, hostPref: string | null) {
  if (!runtime.canControl()) return;
  runtime.setNavigation(false);
  runtime.drawChoices();
  runtime.window.KoloUI.creation.open(hostPref);
  runtime.el('.app').inert = true;
}

export function closeCreate(runtime: WorkspaceRuntime) {
  runtime.el('.app').inert = false;
  runtime.window.KoloUI.creation.close();
}

export async function createSession(runtime: WorkspaceRuntime, ev: { preventDefault(): void; target: HTMLFormElement }) {
  ev.preventDefault();
  if (!runtime.canControl()) return;
  const submit = ev.target.querySelector<Control>('button[type=submit]')!;
  if (submit.disabled || runtime.createPending) return;
  runtime.createPending = true;
  if (runtime.document.activeElement === submit) runtime.el('.dialog').focus();
  const form = new runtime.FormData(ev.target);
  const value = (key: string) => String(form.get(key) ?? '');
  const lendingAny = !runtime.el('input[name=command]').hidden;
  const command = lendingAny ? value('command') : runtime.window.KoloUI.creation.command;
  const request = {
    name: value('name').trim() || runtime.automaticSessionName(command, value('dir')), host: value('host'),
    dir: value('dir'), command,
  };
  const run = runtime.authRun;
  const body = JSON.stringify(request);
  runtime.window.KoloUI.creation.setPending(true);
  try {
    const resp = await runtime.fetch('/v1/agents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    if (run !== runtime.authRun || !runtime.signedIn) return;
    if (!resp.ok) {
      runtime.say('.dialog-note', (await resp.text()).trim() || `create failed (${resp.status})`, true);
      return;
    }
    const made = await resp.json();
    if (run !== runtime.authRun || !runtime.signedIn) return;
    runtime.closeCreate();
    await runtime.refresh();
    if (run === runtime.authRun && runtime.signedIn) runtime.location.hash = `#/agent/${made.name}`;
  } catch (_) {
    if (run !== runtime.authRun || !runtime.signedIn) return;
    const data = await runtime.refresh();
    if (run !== runtime.authRun || !runtime.signedIn) return;
    const found = data?.agents?.find((a) => a.name === request.name && a.host === request.host &&
      a.dir === request.dir && a.command === request.command);
    if (found) {
      runtime.closeCreate();
      runtime.location.hash = `#/agent/${found.name}`;
    } else {
      runtime.say('.dialog-note', 'Could not confirm whether the session was created. Check the session list before trying again.', true);
    }
  } finally {
    runtime.createPending = false;
    runtime.window.KoloUI.creation.setPending(false);
    runtime.drawChoices();
    if (!runtime.el('.scrim').hidden) runtime.el('form.create button[type=submit]')?.focus();
  }
}

export async function stop(runtime: WorkspaceRuntime, name: string) {
  if (!runtime.canControl()) return;
  if (!runtime.confirm(`Stop session ${name}? This ends its running process and removes the session for everyone.`)) return;
  try {
    const resp = await runtime.fetch(`/v1/agents/${name}`, { method: 'DELETE' });
    if (!resp.ok) {
      runtime.alert((await resp.text()).trim() || `stop failed (${resp.status})`);
      return;
    }
    if (runtime.agentInURL() === name) runtime.location.hash = '';
    await runtime.refresh();
  } catch (_) {
    runtime.alert('Could not reach the hub. The agent may still be running.');
  }
}

export function say(runtime: WorkspaceRuntime, sel: string, message: string, problem?: boolean) {
  if (sel === '.dialog-note') { runtime.window.KoloUI.creation.message(message, problem); return; }
  const note = runtime.el(sel);
  note.textContent = message;
  note.classList.toggle('problem', !!problem);
}

export async function acknowledgeContext(runtime: WorkspaceRuntime) {
  if (!runtime.canControl() || runtime.contextAckPending) return;
  const name = runtime.agentInURL();
  const agent = runtime.lastAgents.find((a) => a.name === name);
  const reset = agent?.context_resets?.find((r) => !r.acknowledged);
  if (!reset || !name) return;
  const attempt = { name, id: reset.id, run: runtime.authRun };
  runtime.contextAckPending = attempt;
  runtime.drawSession();
  try {
    const resp = await runtime.fetch(`/v1/agents/${encodeURIComponent(name)}/context/ack`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: reset.id }),
    });
    if (attempt.run !== runtime.authRun || name !== runtime.agentInURL()) return;
    if (resp.status === 401) { runtime.signOut(); return; }
    if (!resp.ok) {
      const problem = await resp.text();
      if (attempt.run === runtime.authRun && name === runtime.agentInURL()) runtime.say('.watch .note', problem, true);
      return;
    }
    // The endpoint waits for durable host confirmation. Polling supplies the
    // updated record; a newer reset cannot be hidden by this request.
    await runtime.refresh();
  } catch (_) {
    if (attempt.run === runtime.authRun && name === runtime.agentInURL()) runtime.say('.watch .note', 'Could not acknowledge the reset. Try again.', true);
  } finally {
    if (runtime.contextAckPending === attempt) runtime.contextAckPending = null;
    if (attempt.run === runtime.authRun && name === runtime.agentInURL()) runtime.drawSession();
  }
}

export async function retrySession(runtime: WorkspaceRuntime, name: string) {
  if (!runtime.canControl() || runtime.retryPending?.name === name) return;
  const agent = runtime.lastAgents.find((a) => a.name === name);
  if (!agent || agent.status !== 'failed') return;
  const run = runtime.authRun;
  const attempt = { name, run };
  runtime.retryPending = attempt;
  runtime.applyAccess();
  try {
    const resp = await runtime.fetch(`/v1/agents/${encodeURIComponent(name)}/retry`, { method: 'POST' });
    if (run !== runtime.authRun || name !== runtime.agentInURL()) return;
    if (resp.status === 401) { runtime.signOut(); return; }
    if (!resp.ok) {
      const problem = await resp.text();
      if (run === runtime.authRun && name === runtime.agentInURL()) runtime.say('.watch .note', problem, true);
      return;
    }
    agent.status = 'starting';
    agent.error = '';
    runtime.drawSession();
    runtime.reconcileWatch();
    await runtime.refresh();
  } catch (_) {
    if (run === runtime.authRun && name === runtime.agentInURL()) runtime.say('.watch .note', 'Could not reach the hub. Try again.', true);
  } finally {
    if (runtime.retryPending === attempt) runtime.retryPending = null;
    runtime.applyAccess();
  }
}
