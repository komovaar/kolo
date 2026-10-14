import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { createStore } from '../../core/store';
import type { WorkspaceData } from '../../core/types';
import { KindIcon } from './creation';

const empty: WorkspaceData = { hosts: [], agents: [], allowed: false };
export const workspaceStore = createStore(empty);
const store = workspaceStore;
let snapshot = '';
let clearFilters: (() => void) | undefined;
const activityOptions = [
  ['attention', 'Needs attention'], ['dialog', 'Waiting for input'],
  ['busy', 'Working'], ['idle', 'Ready'], ['starting', 'Starting'],
  ['failed', 'Failed'], ['disconnected', 'Machine disconnected'], ['unknown', 'Activity unknown'],
];
export const overview = {
  update(data: WorkspaceData) {
    const next = JSON.stringify(data);
    if (next === snapshot) return;
    snapshot = next;
    const focused = document.activeElement as HTMLElement | null;
    const session = focused?.classList.contains('session-link') ? focused.dataset.session : null;
    store.set(structuredClone(data));
    if (session && !focused?.isConnected) {
      const search = document.querySelector<HTMLInputElement>('.session-query');
      if (search?.getClientRects().length) search.focus();
      else document.querySelector<HTMLElement>('.machines-section > summary')?.focus();
    }
  },
  clear() { snapshot = ''; store.set(empty); clearFilters?.(); },
};

export function Overview() {
  const { agents, hosts, allowed } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [query, setQuery] = useState('');
  const [machine, setMachine] = useState('');
  const [activity, setActivity] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const machines = useRef<HTMLDetailsElement>(null);
  const resetFilters = () => { setQuery(''); setMachine(''); setActivity(''); };
  clearFilters = resetFilters;
  useLayoutEffect(() => { if (!hosts.length && machines.current) machines.current.open = true; }, [hosts.length]);
  const filter = query.trim().toLocaleLowerCase();
  const stateOf = (agent: typeof agents[number]) => window.KoloController.sessionState(agent, hosts.some((host) => host.id === agent.host));
  const hasFilters = !!(filter || machine || activity);
  const machineOptions = [...new Set([...hosts.map((host) => host.id), ...agents.map((agent) => agent.host), ...(machine ? [machine] : [])])].sort((a, b) => a.localeCompare(b, 'en'));
  const matches = agents.filter((agent) => {
    const state = stateOf(agent).key;
    return (!machine || agent.host === machine) &&
      (!activity || (activity === 'attention' ? ['dialog', 'failed', 'disconnected'].includes(state) : state === activity)) &&
      [agent.name, agent.label, agent.title, agent.host, agent.dir, agent.command]
        .some((value) => String(value || '').toLocaleLowerCase().includes(filter));
  });
  const waiting = agents.filter((agent) => stateOf(agent).key === 'dialog').length;
  const ready = hosts.some((host) => host.allow?.length && host.dirs?.length);
  return createPortal(<div className="home-content">
    <div className="home-intro"><div className="home-identity"><h1>Sessions</h1><p className="home-summary">{agents.length ? `${agents.length} ${agents.length === 1 ? 'session' : 'sessions'}${waiting ? ` · ${waiting} waiting for input` : ''}` : 'Start an agent or shell to work together.'}</p><p className="home-guide sr-only">{allowed ? 'Open a session to follow its progress or work together.' : 'Read-only access. Open a session to follow your team’s progress.'}</p></div>
      <button type="button" className="go primary home-new" hidden={!allowed} disabled={!ready} title={!ready ? 'Connect a machine that shares programs and directories first.' : ''} onClick={() => window.KoloController.openCreate(null)}><svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>New session</button>
    </div>
    <div className="session-toolbar" hidden={!agents.length && !hasFilters}>
      <label className="session-search"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" fill="none" /><path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg><input ref={search} type="search" className="session-query" aria-label="Search sessions" placeholder="Search sessions…" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <select className="session-filter" aria-label="Filter by machine" value={machine} onChange={(event) => setMachine(event.target.value)}><option value="">All machines</option>{machineOptions.map((id) => <option key={id} value={id}>{id}</option>)}</select>
      <select className="session-filter" aria-label="Filter by activity" value={activity} onChange={(event) => setActivity(event.target.value)}><option value="">All activity</option>{activityOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <div className="session-filter-feedback" hidden={!hasFilters}><span className="session-results" role="status">{matches.length} of {agents.length} shown</span><button className="go filter-reset" type="button" onClick={() => { resetFilters(); search.current?.focus(); }}>Reset filters</button></div>
    </div>
    <section className="home-section sessions-section" aria-labelledby="sessions-title">
      <h2 id="sessions-title" className="sr-only">Workspace sessions</h2>
      <div className="session-list-head" aria-hidden="true" hidden={!matches.length}><span>Session</span><span className="program-label">Program</span><span className="directory-label"><span className="session-inline-machine">Machine / </span>Directory</span><span className="machine-label">Machine</span><span>Activity</span></div>
      <div className="session-list" aria-label="Workspace sessions">{matches.map((agent) => {
        const state = stateOf(agent);
        const name = agent.label || agent.title || agent.name;
        return <a key={agent.name} className="session-link" href={`#/agent/${agent.name}`} data-session={agent.name}>
          <span className="session-cell"><span className="session-name" title={name}>{name}</span></span>
          <span className="session-program" title={agent.command}><span className="kind-chip"><KindIcon command={agent.command} /></span><span className="session-program-name">{window.KoloController.programOf(agent.command)}</span></span>
          <span className="session-directory" title={`${agent.host} · ${agent.dir}`}><span className="session-inline-machine">{agent.host} · </span>{agent.dir}</span>
          <span className="session-machine" title={agent.host}>{agent.host}</span><span className="overview-state" data-state={state.key} title={agent.error || state.label}>{state.key === 'unknown' ? 'Activity unknown' : state.label}</span>
        </a>;
      })}</div>
      <div className="sessions-empty" hidden={!!matches.length}><h3 className="sessions-empty-title">{hasFilters ? 'No matching sessions' : 'No sessions yet'}</h3>
        <p className="sessions-empty-detail">{hasFilters ? 'Change your search or filters to find another session.' : !hosts.length ? 'Connect a machine below, then start your first session.' : allowed ? 'Start a new session on a connected machine. Your team can join as soon as it starts.' : 'Your team’s sessions will appear here when a member with control access starts one.'}</p>
        <button className="go secondary search-clear" type="button" hidden={!filter || !!machine || !!activity} onClick={() => { setQuery(''); search.current?.focus(); }}>Clear search</button>
      </div>
    </section>
    <details ref={machines} className="home-section machines-section" aria-labelledby="machines-title" open>
      <summary className="section-heading"><h2 id="machines-title">Connected machines</h2><span className="machine-count">{hosts.length} connected</span><svg className="machine-disclosure" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4" strokeLinecap="round" strokeLinejoin="round" /></svg></summary>
      <div className="host-cards" hidden={!hosts.length}>{hosts.map((host) => {
        const count = agents.filter((agent) => agent.host === host.id).length;
        return <article key={host.id} className="host-card"><div className="host-detail"><h3>{host.id}</h3><p>{host.allow?.includes('*') ? 'Allows any command' : host.allow?.length ? `Available: ${host.allow.join(', ')}` : 'No commands shared'}</p>{host.error && <p className="host-error">{host.error}</p>}</div><p className="host-count">{count} {count === 1 ? 'session' : 'sessions'}</p>
          {allowed && <button type="button" className="go" aria-label={`New session on ${host.id}`} disabled={!host.allow?.length || !host.dirs?.length} onClick={() => window.KoloController.openCreate(host.id)}>New session</button>}
        </article>;
      })}</div>
      <div className="home-setup" hidden={!!hosts.length}><p>No machines are connected yet. Connect a machine to make its agents and directories available here.</p><code>kolo host</code><p>Run this on a machine already configured for your organization.</p></div>
    </details>
  </div>, document.querySelector('.home')!);
}
