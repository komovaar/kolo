import type { WorkspaceRuntime, ActivityEntry } from '../../core/runtime.ts';

export async function drawLog(runtime: WorkspaceRuntime) {
  const run = runtime.authRun;
  const request = ++runtime.logRun;
  const current = () => run === runtime.authRun && runtime.signedIn && request === runtime.logRun;
  try {
    const resp = await runtime.fetch('/v1/log');
    if (!current()) return;
    if (resp.status === 401) { runtime.signOut(); return; }
    if (!resp.ok) throw new Error('Activity request failed');
    const data = await resp.json();
    if (!current()) return;
    if (!Array.isArray(data.entries)) throw new Error('Unreadable activity response');
    const entries = data.entries;
    const message = runtime.el('.log-message');
    message.textContent = data.persistent === false
      ? 'New activity is only kept in memory and may be lost when the hub restarts.' : '';
    message.hidden = !message.textContent;
    runtime.el('.log-retry').hidden = true;

    const rows = runtime.el('.log-rows');
    rows.replaceChildren();
    if (entries.length === 0) {
      const empty = runtime.document.createElement('p');
      empty.className = 'log-empty';
      empty.textContent = 'Nothing yet. What people do here is written down as they do it.';
      rows.append(empty);
      return;
    }
    for (let i = entries.length - 1; i >= 0; i--) rows.append(runtime.entryRow(entries[i]));
  } catch (_) {
    if (!current()) return;
    runtime.el('.log-message').textContent = 'Could not load activity. Previously loaded entries may be out of date. Try loading it again.';
    runtime.el('.log-message').hidden = false;
    runtime.el('.log-retry').hidden = false;
  }
}

export function entryRow(runtime: WorkspaceRuntime, e: ActivityEntry) {
  const row = runtime.document.createElement('div');
  row.className = 'entry';
  row.dataset.action = e.what;
  const put = (cls: string, text: string) => {
    const available = cls === 'on' && runtime.lastAgents.some((agent) => agent.name === e.agent);
    const span = runtime.document.createElement(available ? 'a' : 'span');
    span.className = cls;
    span.textContent = text;
    span.title = String(text || '');
    if (available) span.setAttribute('href', `#/agent/${e.agent}`);
    row.append(span);
  };

  put('at', runtime.when(e.at));
  const who = e.who && e.who.name;
  if (!who) row.classList.add('nobody');
  put('who', who || 'nobody');
  put('what', runtime.didWhat(e.what));
  put('on', runtime.labelOf(e.agent));
  if (e.text) put('said', e.text + (e.truncated ? ' … [truncated]' : ''));
  return row;
}

export function didWhat(runtime: WorkspaceRuntime, what: string) {
  switch (what) {
    case 'created': return 'created';
    case 'said': return 'said';
    case 'interrupted': return 'interrupted';
    case 'restarted': return 'restarted';
    case 'retried': return 'retried';
    case 'fresh': return 'started fresh';
    case 'context_reset': return 'reset the conversation';
    case 'context_acknowledged': return 'acknowledged a conversation reset';
    case 'relabeled': return 'renamed';
    case 'stopped': return 'stopped';
    case 'failed': return 'failed';
    case 'gone': return 'went away';
    default: return what;
  }
}

export function when(runtime: WorkspaceRuntime, at: string) {
  const d = new Date(at);
  if (isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

export function labelOf(runtime: WorkspaceRuntime, name: string) {
  const a = runtime.lastAgents.find((x) => x.name === name);
  return (a && (a.label || a.title)) || name;
}
