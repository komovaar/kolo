// Enhancements use the existing session routing, access checks, and controls.
(() => {
  const app = el('.app');
  const scrim = el('.switch-scrim');
  const query = el('.switch-query');
  const results = el('.switch-results');
  function updateOverlayHeight() {
    document.documentElement.style.setProperty('--kolo-visual-height', `${window.visualViewport?.height || innerHeight}px`);
  }
  updateOverlayHeight();
  addEventListener('resize', updateOverlayHeight);
  window.visualViewport?.addEventListener('resize', updateOverlayHeight);
  let opener = null;
  let options = [];
  let selected = 0;
  let snapshot = '';
  let focusSession = null;
  const apple = /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcut = apple ? '⌘⇧Space' : 'Ctrl⇧Space';
  el('.switch-shortcut').textContent = shortcut;
  el('.switch-open').title = `Switch session (${shortcut})`;
  el('.switch-open').setAttribute('aria-keyshortcuts', apple ? 'Meta+Shift+Space' : 'Control+Shift+Space');

  const mobileSwitch = document.createElement('button');
  mobileSwitch.type = 'button';
  mobileSwitch.className = 'icon-btn mobile-switch';
  mobileSwitch.setAttribute('aria-label', 'Switch session');
  mobileSwitch.setAttribute('aria-haspopup', 'dialog');
  mobileSwitch.innerHTML = el('.switch-open svg').outerHTML;
  el('.mobile-nav').append(mobileSwitch);

  function closeSwitcher(restore = true) {
    scrim.hidden = true;
    app.inert = !el('.scrim').hidden;
    query.value = '';
    query.removeAttribute('aria-activedescendant');
    results.replaceChildren();
    options = [];
    snapshot = '';
    if (restore && signedIn) {
      if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
      else if (sidebarMedia.matches) el('.mobile-menu').focus();
      else el('.switch-open').focus();
    }
  }

  function select(index, scroll = false) {
    selected = Math.max(0, Math.min(options.length - 1, index));
    [...results.children].forEach((node, i) => node.setAttribute('aria-selected', String(i === selected)));
    const active = results.children[selected];
    if (active) {
      query.setAttribute('aria-activedescendant', active.id);
      if (scroll) active.scrollIntoView({ block: 'nearest' });
    } else query.removeAttribute('aria-activedescendant');
  }

  function activate(index) {
    const option = options[index];
    if (!option) return;
    closeSwitcher(false);
    option.run();
  }

  function render() {
    const filter = query.value.trim().toLocaleLowerCase();
    const next = JSON.stringify([filter, lastAgents, hosts, canControl(), agentInURL()]);
    if (next === snapshot) return;
    snapshot = next;
    const activeKey = options[selected]?.key;
    const matches = lastAgents.filter((agent) => [agent.name, agent.label, agent.title, agent.host, agent.command, agent.dir]
      .some((value) => String(value || '').toLocaleLowerCase().includes(filter)));
    options = matches.map((agent) => ({
      key: `session:${agent.name}`, agent, name: agent.label || agent.title || agent.name,
      run: () => {
        setNavigation(false);
        focusSession = agent.name;
        location.hash = `#/agent/${agent.name}`;
        el('.session-title').tabIndex = -1;
        el('.session-title').focus({ preventScroll: true });
        focusTerminal();
      },
    }));
    const actions = [
      { key: 'action:overview', name: 'Open workspace overview', icon: '.side-overview svg', run: () => {
        location.hash = '';
        requestAnimationFrame(() => el('.session-query').focus());
      } },
      { key: 'action:activity', name: 'Open activity log', icon: '.log-open svg', run: () => {
        location.hash = '#/log';
        const title = sidebarMedia.matches ? el('.mobile-title') : el('.log-head h2');
        title.tabIndex = -1;
        requestAnimationFrame(() => title.focus());
      } },
    ];
    if (canControl() && hosts.some((host) => host.allow?.length && host.dirs?.length)) {
      actions.unshift({ key: 'action:new', name: 'New session', icon: '.home-new svg', run: () => {
        (sidebarMedia.matches ? el('.mobile-menu') : el('.side-new')).focus();
        openCreate(null);
      } });
    }
    options.push(...actions.filter((action) => action.name.toLocaleLowerCase().includes(filter)));
    results.replaceChildren();
    options.forEach((option, i) => {
      const row = document.createElement('div');
      row.className = 'switch-option' + (option.agent ? '' : ' switch-action');
      row.id = `switch-option-${i}`;
      row.setAttribute('role', 'option');
      const icon = document.createElement('span');
      icon.className = 'kind-chip';
      icon.setAttribute('aria-hidden', 'true');
      icon.append(option.agent ? kindIcon(option.agent.command) : el(option.icon).cloneNode(true));
      const copy = document.createElement('span');
      copy.className = 'switch-copy';
      const name = document.createElement('span');
      name.className = 'switch-name';
      name.textContent = option.name;
      copy.append(name);
      row.append(icon, copy);
      if (option.agent) {
        const agent = option.agent;
        const meta = document.createElement('span');
        meta.className = 'switch-meta';
        meta.textContent = `${agent.host} · ${programOf(agent.command)} · ${agent.dir}`;
        copy.append(meta);
        const state = sessionState(agent, hosts.some((host) => host.id === agent.host));
        const status = document.createElement('span');
        status.className = 'overview-state';
        status.dataset.state = state.key;
        status.textContent = state.key === 'unknown' ? 'Activity unknown' : state.label;
        row.append(status);
        if (agent.name === agentInURL()) {
          const current = document.createElement('span');
          current.className = 'switch-current';
          current.textContent = 'Current';
          row.append(current);
        }
      }
      row.onmousedown = (event) => event.preventDefault();
      row.onclick = () => activate(i);
      results.append(row);
    });
    el('.switch-empty').hidden = options.length > 0;
    const previous = options.findIndex((option) => option.key === activeKey);
    select(previous >= 0 ? previous : 0);
  }

  function openSwitcher() {
    if (!signedIn || !el('.scrim').hidden) return;
    opener = document.activeElement;
    setNavigation(false);
    setAccountMenu(false);
    el('.session-share').open = false;
    scrim.hidden = false;
    app.inert = true;
    render();
    query.focus();
  }
  el('.switch-open').onclick = openSwitcher;
  mobileSwitch.onclick = openSwitcher;
  el('.switch-close').onclick = () => closeSwitcher();
  scrim.onclick = (event) => { if (event.target === scrim) closeSwitcher(); };
  query.oninput = () => { selected = 0; options = []; render(); };
  scrim.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeSwitcher(); }
    if (event.target === query && ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Enter') activate(selected);
      else if (options.length) select((selected + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length, true);
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      (event.target === query ? el('.switch-close') : query).focus();
    }
  });
  // Avoid browser developer-tool shortcuts and the shell's Ctrl+K binding.
  addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && !event.isComposing && event.code === 'Space') {
      if (!signedIn || !el('.scrim').hidden) return;
      event.preventDefault();
      event.stopPropagation();
      scrim.hidden ? openSwitcher() : closeSwitcher();
    }
  }, true);

  function syncControls() {
    const start = el('.side-new');
    start.hidden = !canControl();
    start.disabled = !hosts.some((host) => host.allow?.length && host.dirs?.length);
    start.title = start.disabled ? 'Connect a machine that shares programs and directories first.' : 'Start a shared agent or shell';
    if (!scrim.hidden) render();
  }
  el('.side-new').onclick = () => openCreate(null);
  // The existing refresh updates access on the overview action; observe that
  // control to keep enhancements in step without a second API polling loop.
  new MutationObserver(syncControls).observe(el('.home-new'), { attributes: true, attributeFilter: ['hidden', 'disabled'] });
  new MutationObserver(() => {
    syncControls();
    if (app.hidden) {
      closeSwitcher(false);
      el('.session-share').open = false;
      el('#session-url').value = '';
      el('.share-feedback').textContent = '';
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
  new MutationObserver(() => {
    connection.dataset.state = connection.textContent === 'Live connection' ? 'live' : 'pending';
    focusTerminal();
  }).observe(connection, { childList: true, characterData: true, subtree: true });
  // Follow the existing refresh and live state rendering without more timers.
  new MutationObserver(() => { if (!scrim.hidden) render(); })
    .observe(el('.groups'), { childList: true });

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

  const share = el('.session-share');
  const link = el('#session-url');
  const feedback = el('.share-feedback');
  let copying = false;
  share.querySelector('summary').addEventListener('click', () => {
    if (!share.open) link.value = `${location.origin}/${location.hash}`;
  });
  share.addEventListener('toggle', () => {
    feedback.textContent = '';
    if (share.open) {
      link.value = `${location.origin}/${location.hash}`;
      link.focus();
      link.select();
    }
  });
  link.onclick = () => link.select();
  el('.share-copy').onclick = async () => {
    if (copying) return;
    copying = true;
    const value = link.value;
    try {
      await navigator.clipboard.writeText(value);
      if (share.open && signedIn && link.value === value) {
        feedback.classList.remove('problem');
        feedback.textContent = 'Session link copied.';
      }
    } catch (_) {
      if (share.open && signedIn && link.value === value) {
        feedback.classList.add('problem');
        feedback.textContent = 'Select the link and copy it manually.';
        link.focus();
        link.select();
      }
    } finally { copying = false; }
  };
  addEventListener('click', (event) => { if (!share.contains(event.target)) share.open = false; });
  share.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); share.open = false; share.querySelector('summary').focus(); }
  });
  addEventListener('hashchange', () => { share.open = false; });
})();
