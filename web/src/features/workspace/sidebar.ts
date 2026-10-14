import type { WorkspaceRuntime, Agent, Control } from '../../core/runtime.ts';

export function startRename(runtime: WorkspaceRuntime, a: Agent) {
  if (!runtime.canControl()) return;
  runtime.renamingId = a.name;
  runtime.renameDraft = a.label || a.title || a.name;
  runtime.drawGroups(runtime.lastAgents);
  const input = runtime.el('.groups .rename');
  input.focus();
  input.select();
}

export function cancelRename(runtime: WorkspaceRuntime) {
  runtime.renamingId = null;
  runtime.drawGroups(runtime.lastAgents);
}

export async function commitRename(runtime: WorkspaceRuntime) {
  if (!runtime.canControl()) { runtime.cancelRename(); return; }
  const id = runtime.renamingId;
  const draft = runtime.renameDraft.trim();
  const current = runtime.lastAgents.find((a) => a.name === id);
  // Nothing worth a round trip: empty is a mis-click, unchanged is a blur
  // that wasn't really an edit.
  if (!id || !draft || (current && draft === (current.label || current.title || current.name))) {
    runtime.cancelRename();
    return;
  }
  runtime.renamingId = null;
  try {
    const resp = await runtime.fetch(`/v1/agents/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: draft }),
    });
    if (!resp.ok) runtime.alert((await resp.text()).trim() || `rename failed (${resp.status})`);
  } catch (_) {
    runtime.alert('Could not reach the hub. The agent was not renamed.');
  }
  await runtime.refresh();
}

export function drawGroups(runtime: WorkspaceRuntime, agents: Agent[]) {
  const container = runtime.el('.groups');
  const focused = container.contains(runtime.document.activeElement);
  const key = focused ? (runtime.document.activeElement as HTMLElement | null)?.dataset.focusKey : null;
  const scrollTop = container.scrollTop;
  runtime.renderGroups(agents);
  container.scrollTop = scrollTop;
  if (focused && key) {
    const target = [...container.querySelectorAll<Control>('[data-focus-key]')]
      .find((node) => node.dataset.focusKey === key && !node.disabled && node.getClientRects().length);
    (target || runtime.el('.brand-home')).focus({ preventScroll: true });
  }
}

export function renderGroups(runtime: WorkspaceRuntime, agents: Agent[]) {
  const open = runtime.agentInURL();
  const container = runtime.el('.groups');
  container.replaceChildren();
  let projectId = 0;

  const byHost = new Map<string, Agent[]>();
  for (const a of agents) {
    if (!byHost.has(a.host)) byHost.set(a.host, []);
    byHost.get(a.host)!.push(a);
  }
  // Every lending host gets a section, whether or not it has an agent on it
  // yet: a host that just connected and is waiting for its first agent is
  // a normal, common state, not one to hide. Order is the host list's own
  // order, stable across a refresh rather than jumping around with whatever
  // order agents happen to load in; an agent whose host has since dropped
  // still gets a group, so it is never silently lost from view.
  const order = runtime.hosts.map((h) => h.id);
  for (const id of byHost.keys()) if (!order.includes(id)) order.push(id);

  if (order.length === 0) {
    const empty = runtime.document.createElement('div');
    empty.className = 'no-hosts';
    empty.innerHTML = `<p>No machine is lending itself to this org yet.</p>
      <code>kolo host</code>
      <p class="fine">Run it on a machine to connect it here.</p>`;
    container.append(empty);
    return;
  }

  for (const host of order) {
    const members = byHost.get(host) || [];
    const hostInfo = runtime.hosts.find((item) => item.id === host);
    const group = runtime.document.createElement('div');
    group.className = 'group';

    const head = runtime.document.createElement('div');
    head.className = 'group-head';
    head.dataset.focusKey = JSON.stringify(['host', host]);
    head.setAttribute('role', 'button');
    head.tabIndex = 0;
    head.innerHTML = `
      <svg class="chevron" width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>
      <span class="chip"><svg width="10" height="10" viewBox="0 0 14 14"><rect x="1" y="1.5" width="12" height="8" rx="1.3" stroke="currentColor" stroke-width="1.3" fill="none"/><path d="M5 12.5h4M7 9.5v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></span>
      <span class="label"></span>
      <span class="spacer"></span>
      <button type="button" class="icon-btn add">
        <svg width="12" height="12" viewBox="0 0 13 13"><path d="M6.5 1v11M1 6.5h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>`;
    head.querySelector<Control>('.label')!.textContent = host;
    head.querySelector<Control>('.label')!.title = host;
    head.title = hostInfo ? host : `${host} · Machine disconnected`;
    head.querySelector<Control>('.add')!.dataset.focusKey = JSON.stringify(['add', host]);
    head.querySelector<Control>('.add')!.title = `New session on ${host}`;
    head.querySelector<Control>('.add')!.setAttribute('aria-label', `New session on ${host}`);
    head.querySelector<Control>('.add')!.hidden = !runtime.canControl();
    head.querySelector<Control>('.add')!.disabled = !hostInfo;
    if (hostInfo && hostInfo.error) {
      head.title = hostInfo.error;
      head.querySelector<Control>('.chip')!.classList.add('problem');
      const problem = runtime.document.createElement('span');
      problem.className = 'host-problem';
      problem.textContent = '!';
      problem.title = hostInfo.error;
      head.querySelector<Control>('.spacer')!.before(problem);
    }
    const isCollapsed = !!runtime.collapsed[host];
    head.setAttribute('aria-expanded', String(!isCollapsed));
    head.querySelector<Control>('.chevron')!.classList.toggle('open', !isCollapsed);
    head.onclick = () => {
      runtime.collapsed[host] = !runtime.collapsed[host];
      runtime.drawGroups(agents);
    };
    head.onkeydown = (ev) => {
      if (ev.target === head && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault(); head.click();
      }
    };
    head.querySelector<Control>('.add')!.onclick = (ev) => {
      ev.stopPropagation();
      runtime.openCreate(host);
    };

    const body = runtime.document.createElement('div');
    body.className = 'group-body' + (isCollapsed ? ' collapsed' : '');

    const projects = new Map<string, Agent[]>();
    for (const agent of members) {
      if (!projects.has(agent.dir)) projects.set(agent.dir, []);
      projects.get(agent.dir)!.push(agent);
    }
    for (const [directory, sessions] of projects) {
      const key = JSON.stringify([host, directory]);
      const project = runtime.document.createElement('section');
      project.className = 'project';
      const projectHead = runtime.document.createElement('button');
      projectHead.type = 'button';
      projectHead.className = 'project-head';
      projectHead.id = `project-${projectId++}`;
      projectHead.dataset.focusKey = JSON.stringify(['directory', host, directory]);
      projectHead.setAttribute('aria-expanded', String(!runtime.collapsedProjects.has(key)));
      projectHead.setAttribute('aria-label', `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'} in ${directory}`);
      projectHead.title = directory;
      projectHead.innerHTML = '<svg class="project-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="project-path"></span><span class="project-count" aria-hidden="true"></span>';
      projectHead.querySelector<Control>('.project-path')!.textContent = directory;
      projectHead.querySelector<Control>('.project-count')!.textContent = String(sessions.length);
      projectHead.onclick = () => {
        runtime.collapsedProjects.has(key) ? runtime.collapsedProjects.delete(key) : runtime.collapsedProjects.add(key);
        runtime.drawGroups(agents);
      };
      const projectBody = runtime.document.createElement('div');
      projectBody.className = 'project-sessions';
      projectBody.hidden = runtime.collapsedProjects.has(key);
      project.append(projectHead, projectBody);
      body.append(project);

      for (const a of sessions) {
        // A div, not a button: a real <button> can't legally contain the
        // .drop stop button nested inside it, so this carries the button role
        // and keyboard activation by hand instead.
        const row = runtime.document.createElement('div');
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.dataset.focusKey = JSON.stringify(['agent', a.host, a.name, a.created_at]);
        row.className = 'agent' + (a.name === open ? ' on' : '');
        row.setAttribute('aria-describedby', projectHead.id);
        if (a.name === open) row.setAttribute('aria-current', 'page');
        row.innerHTML = `
          <span class="row"></span>
          <span class="dir"></span>`;
        const rowInner = row.querySelector<Control>('.row')!;
        // Lifecycle comes from the host control connection; busy, idle and a
        // question waiting come from the live terminal screen.
        const state = runtime.sessionState(a, !!hostInfo);
        const busy = state.key === 'busy';
        if (busy) {
          const spinner = runtime.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          spinner.setAttribute('class', 'spinner');
          spinner.setAttribute('width', '13'); spinner.setAttribute('height', '13'); spinner.setAttribute('viewBox', '0 0 13 13');
          spinner.setAttribute('role', 'img');
          spinner.setAttribute('aria-label', state.label);
          const title = runtime.document.createElementNS('http://www.w3.org/2000/svg', 'title');
          spinner.innerHTML = `<circle class="track" cx="6.5" cy="6.5" r="5" fill="none" stroke-width="1.6"/>
            <circle class="arc" cx="6.5" cy="6.5" r="5" fill="none" stroke-width="1.6" stroke-linecap="round"/>`;
          title.textContent = state.label;
          spinner.prepend(title);
          rowInner.append(spinner);
        } else {
          const dot = runtime.document.createElement('span');
          dot.className = `dot ${state.key}`;
          dot.title = state.label;
          dot.setAttribute('role', 'img');
          dot.setAttribute('aria-label', state.label);
          rowInner.append(dot);
        }
        if (a.name === runtime.renamingId) {
          const input = runtime.document.createElement('input');
          input.className = 'rename';
          input.dataset.focusKey = row.dataset.focusKey;
          input.setAttribute('aria-label', 'Session name');
          input.value = runtime.renameDraft;
          input.oninput = (ev) => { runtime.renameDraft = input.value; };
          input.onkeydown = (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); runtime.commitRename(); }
            else if (ev.key === 'Escape') { ev.preventDefault(); runtime.cancelRename(); }
          };
          input.onblur = () => runtime.commitRename();
          input.onclick = (ev) => ev.stopPropagation();
          rowInner.append(input);
        } else {
          const name = runtime.document.createElement('span');
          name.className = 'name';
          name.textContent = a.label || a.title || a.name;
          name.title = `${name.textContent} · ${runtime.canControl() ? 'Double-click or press F2 to rename' : 'Read-only access'}`;
          name.ondblclick = (ev) => { ev.stopPropagation(); runtime.startRename(a); };
          rowInner.append(name);
        }
        const chip = runtime.document.createElement('span');
        chip.className = 'kind-chip';
        chip.title = runtime.programOf(a.command) || a.command;
        chip.append(runtime.kindIcon(a.command));
        rowInner.append(chip);
        const drop = runtime.document.createElement('button');
        drop.type = 'button';
        drop.hidden = !runtime.canControl();
        drop.disabled = !hostInfo;
        drop.className = 'drop';
        drop.dataset.focusKey = JSON.stringify(['stop', a.host, a.name, a.created_at]);
        drop.title = `Stop session ${a.label || a.title || a.name}`;
        drop.setAttribute('aria-label', drop.title);
        drop.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor"/></svg>';
        drop.onclick = (ev) => { ev.stopPropagation(); runtime.stop(a.name); };
        rowInner.append(drop);
        row.querySelector<Control>('.dir')!.textContent = a.dir;
        row.querySelector<Control>('.dir')!.title = a.dir;
        row.title = a.error ? `${state.label}: ${a.error}` : state.label;
        row.onclick = () => { runtime.setNavigation(false); runtime.location.hash = `#/agent/${a.name}`; };
        row.onkeydown = (ev) => {
          if (ev.target !== row) return;
          if (ev.key === 'F2' && runtime.canControl()) { ev.preventDefault(); runtime.startRename(a); return; }
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); runtime.setNavigation(false); runtime.location.hash = `#/agent/${a.name}`; }
        };
        projectBody.append(row);
      }
    }

    group.append(head, body);
    container.append(group);
  }
}
