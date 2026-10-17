import type { WorkspaceRuntime, Control } from '../core/runtime.ts';
import { installClipboard } from './clipboard.ts';

export function createTerminal(runtime: WorkspaceRuntime) {
  const next = new runtime.Terminal({
    // Keystrokes go to the agent as they are pressed. Whoever types last is
    // the typist the others see, once the initial screen has been restored.
    disableStdin: true,
    cursorBlink: true,
    // What the agent says is what the machine says, so it is said in the
    // brand's mono. The stack behind it is what draws until the file arrives.
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: runtime.baseFont,
    customGlyphs: true,
    scrollback: 5000,
    theme: { background: '#101314', foreground: '#E7E9E4',
             cursor: '#A0C4B1', selectionBackground: '#284336', brightBlack: '#8B949A' },
  });
  const stage = runtime.document.createElement('div');
  stage.className = 'terminal-stage';
  runtime.el('#term').append(stage);
  next.open(stage);
  runtime.KoloTerminalQueries.hostReplies(next);
  installClipboard(runtime, next);

  // The DOM renderer sets block glyphs in whatever font the browser picks,
  // leaving seams between quadrants. The canvas renderer draws them itself.
  try {
    next.loadAddon(new runtime.CanvasAddon.CanvasAddon());
  } catch (e) {
    console.warn('canvas renderer unavailable, falling back to the DOM', e);
  }
  // xterm has encoded arrows and pastes as the running program requested.
  next.onData((keys) => {
    if (next !== runtime.term || !runtime.socket) return;
    if (!runtime.screenReady || !runtime.canControl()) return;
    if (runtime.activeViewer !== runtime.viewerID) runtime.requestedSize = null;
    runtime.activeViewer = runtime.viewerID;
    runtime.fit();
    runtime.tell({ type: 'keys', keys, ...runtime.viewportSize });
  });
  return next;
}

export function room(runtime: WorkspaceRuntime) {
  const viewport = runtime.window.visualViewport;
  if (viewport && runtime.matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px)').matches) runtime.el('.app').style.height = `${viewport.height}px`;
  else runtime.el('.app').style.height = '';
  const box = runtime.el('#term').getBoundingClientRect();
  return { w: Math.floor(box.width), h: Math.floor(box.height) };
}

export function fit(runtime: WorkspaceRuntime) {
  if (runtime.fitting) return;
  const drawn = runtime.term.element, grid = drawn && drawn.querySelector<Control>('.xterm-screen')!;
  const box = runtime.room();
  if (!grid || !grid.offsetWidth || !grid.offsetHeight || !box.w || !box.h) return;
  runtime.fitting = true;
  try {
    // Measure this window at its own preferred font, independent of the
    // shared grid. Only the browser typing may resize the real PTY.
    runtime.term.options.fontSize = runtime.baseFont * runtime.zoom;
    const cellWidth = grid.offsetWidth / runtime.term.cols;
    const cellHeight = grid.offsetHeight / runtime.term.rows;
    const cols = Math.max(2, Math.min(500, Math.floor(box.w / cellWidth)));
    const rows = Math.max(2, Math.min(200, Math.floor(box.h / cellHeight)));
    runtime.viewportSize = { cols, rows };
    const driving = !!runtime.viewerID && runtime.activeViewer === runtime.viewerID && runtime.canControl();
    if (driving) {
      const size = `${cols}x${rows}`;
      if (runtime.screenReady && runtime.socket?.readyState === runtime.WebSocket.OPEN && runtime.requestedSize !== size) {
        runtime.requestedSize = size;
        runtime.socket.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    } else {
      let low = 1, high = 64;
      for (let i = 0; i < 10; i++) {
        const candidate = (low + high) / 2;
        runtime.term.options.fontSize = candidate;
        if (grid.offsetWidth <= box.w && grid.offsetHeight <= box.h) low = candidate;
        else high = candidate;
      }
      runtime.term.options.fontSize = low * runtime.zoom;
    }
    const width = grid.offsetWidth, height = grid.offsetHeight;
    const stage = drawn.parentElement!;
    stage.style.width = `${Math.max(box.w, width)}px`;
    stage.style.height = `${Math.max(box.h, height)}px`;
    drawn.style.width = `${width}px`;
    drawn.style.height = `${height}px`;
    drawn.style.left = '0px';
    drawn.style.top = '0px';
    const frame = runtime.el('#term');
    frame.classList.toggle('roam', runtime.zoom > 1 || width > box.w || height > box.h);
    if (runtime.zoom <= 1) { frame.scrollLeft = 0; frame.scrollTop = 0; }
    runtime.sayZoom();
  } finally { runtime.fitting = false; }
}

export function setZoom(runtime: WorkspaceRuntime, to: number) {
  runtime.zoom = Math.max(runtime.zoomRange.least, Math.min(to, runtime.zoomRange.most));
  runtime.fit();
}

export function sayZoom(runtime: WorkspaceRuntime) {
  runtime.el('.zoom .at').textContent = runtime.zoom === 1 ? 'fit' : `${Math.round(runtime.zoom * 100)}%`;
  runtime.el('.zoom').classList.toggle('moved', runtime.zoom !== 1);
}

export function canWatch(runtime: WorkspaceRuntime, name: string) {
  const agent = runtime.lastAgents.find((a) => a.name === name);
  return runtime.signedIn && !!agent && runtime.hosts.some((h) => h.id === agent.host) &&
    (agent.status === 'running' || agent.status === 'starting');
}

export function reconcileWatch(runtime: WorkspaceRuntime) {
  const name = runtime.agentInURL();
  if (!runtime.signedIn || !name) return;
  if (!runtime.canWatch(name)) {
    runtime.close();
    const agent = runtime.lastAgents.find((a) => a.name === name);
    runtime.el('.session-connection').textContent = agent?.status === 'failed' ? 'Session failed' : 'Session unavailable';
    runtime.say('.watch .note', agent?.status === 'failed'
      ? (runtime.canControl() ? 'Fix the problem on the machine, then choose Retry.' : 'A member with control access can retry this session.')
      : 'The machine is disconnected or this session has been removed.');
    runtime.applyAccess();
    return;
  }
  if (runtime.watching !== name) runtime.watch(name);
  else if ((!runtime.socket || runtime.socket.readyState === runtime.WebSocket.CLOSED) && !runtime.reconnectTimer) runtime.connect(name);
}

export function watch(runtime: WorkspaceRuntime, name: string) {
  runtime.close();
  runtime.watching = name;
  runtime.connect(name);
}

export function resetTerminal(runtime: WorkspaceRuntime) {
  // reset() does not drain xterm's write buffer or its UTF-8/escape parser.
  // Replacing the instance keeps in-flight bytes on the detached old screen.
  const focused = runtime.watching && runtime.term.element.contains(runtime.document.activeElement);
  runtime.term.dispose();
  runtime.el('#term').replaceChildren();
  runtime.term = runtime.createTerminal();
  runtime.terminalOwner = null;
  runtime.screenReady = false;
  runtime.requestedSize = null;
  runtime.clipboardViewer = null;
  runtime.viewerID = null;
  runtime.activeViewer = null;
  runtime.viewportSize = null;
  runtime.applyAccess();
  runtime.fit();
  if (focused) runtime.term.focus();
}

export function close(runtime: WorkspaceRuntime) {
  runtime.clearTimeout(runtime.reconnectTimer ?? undefined);
  runtime.reconnectTimer = null;
  runtime.watching = null;
  runtime.el('.session-connection').textContent = 'Disconnected';
  runtime.typist = null; runtime.keyboardChanged();
  runtime.el('.watch .restart').disabled = true;
  if (runtime.socket) { const was = runtime.socket; runtime.socket = null; was.close(); }
  if (runtime.terminalOwner) runtime.resetTerminal();
}

export function connect(runtime: WorkspaceRuntime, name: string) {
  if (!runtime.signedIn || runtime.watching !== name || !runtime.canWatch(name)) return;
  if (runtime.terminalOwner) runtime.resetTerminal();
  runtime.el('.session-connection').textContent = 'Connecting…';
  const scheme = runtime.location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new runtime.WebSocket(`${scheme}://${runtime.location.host}/v1/watch/${name}`);
  ws.binaryType = 'arraybuffer';
  runtime.socket = ws;
  runtime.terminalOwner = ws;
  const view = runtime.term;
  let snapshotReceived = false;

  // Every handler checks it is still the current socket: a superseded one still
  // reports its own close, which would land after the replacement opened.
  ws.onopen = () => {
    if (ws !== runtime.socket) return;
    runtime.el('.session-connection').textContent = 'Restoring screen…';
    runtime.say('.watch .note', '');
  };

  ws.onmessage = (ev) => {
    if (ws !== runtime.socket) return;
    if (typeof ev.data !== 'string') {
      const first = !snapshotReceived;
      snapshotReceived = true;
      view.write(new Uint8Array(ev.data), first ? () => {
        if (ws !== runtime.socket || view !== runtime.term || ws.readyState !== runtime.WebSocket.OPEN) return;
        runtime.screenReady = true;
        runtime.applyAccess();
        runtime.fit();
        runtime.el('.session-connection').textContent = 'Live connection';
      } : undefined);
      return;
    }
    const msg = JSON.parse(ev.data);
    switch (msg.type) {
      case 'input':
        runtime.clipboardViewer = msg.viewer;
        break;
      case 'viewer':
        runtime.viewerID = msg.id;
        break;
      // Apply the host's authoritative PTY dimensions before its repaint.
      case 'size':
        view.resize(msg.cols, msg.rows);
        runtime.fit();
        break;
      case 'state':
        runtime.say('.watch .note', msg.state === 'dialog' ? runtime.describe(msg.state) : '');
        const agent = runtime.lastAgents.find((a) => a.name === name);
        if (agent) agent.screen_state = msg.state;
        runtime.attention.update(runtime.lastAgents);
        if (!runtime.renamingId) runtime.drawGroups(runtime.lastAgents);
        runtime.drawSession();
        runtime.drawHome();
        break;
      case 'interrupted':
        runtime.say('.watch .note', `${msg.from} stopped the agent`);
        break;
      // Who typed last. Announced on the screen everybody is watching, so it
      // arrives in step with what the agent does.
      case 'keyboard':
        runtime.typist = msg.who || null;
        runtime.activeViewer = msg.viewer || null;
        runtime.requestedSize = null;
        runtime.fit();
        runtime.keyboardChanged();
        break;
      // Both arrive just before the screen goes, so they are the last thing
      // anyone watching is told about the process they were watching.
      case 'restarted':
        runtime.say('.watch .note', `${msg.from} restarted the agent`);
        break;
      case 'fresh':
        runtime.say('.watch .note', `${msg.from} started the agent fresh. Its conversation is gone`);
        break;
      case 'refused':
        runtime.say('.watch .note', msg.text, true);
        break;
    }
  };

  // Falling behind, an agent restarting, and one not started yet all end the
  // same way: reconnect, and the next repaint resyncs.
  ws.onclose = () => {
    if (ws !== runtime.socket) return;
    runtime.screenReady = false;
    runtime.applyAccess();
    runtime.typist = null; runtime.keyboardChanged();
    runtime.el('.watch .restart').disabled = true;
    runtime.el('.session-connection').textContent = 'Reconnecting…';
    runtime.say('.watch .note', 'Screen disconnected. Input is unavailable while Kolo reconnects.');
    runtime.reconnectTimer = runtime.setTimeout(() => {
      runtime.reconnectTimer = null;
      if (runtime.signedIn && runtime.watching === name && ws === runtime.socket) runtime.connect(name);
    }, 1000);
    runtime.refresh();
  };
  ws.onerror = () => ws.close();
}

export function describe(runtime: WorkspaceRuntime, state: string) {
  switch (state) {
    case 'idle': return runtime.canControl() ? 'Ready for input.' : 'Ready. You have read-only access.';
    case 'busy': return 'Working. Follow progress in the terminal.';
    // Kolo says that a question is up, never what it is: reading the question is
    // what the screen in front of you is for, and answering it is what typing
    // is for.
    case 'dialog': return runtime.canControl() ? 'Waiting for input. Type in the terminal to answer.'
      : 'Waiting for a member with control access to answer.';
    default: return 'Live terminal. Activity detection is unavailable for this screen.';
  }
}

export function keyboardChanged(runtime: WorkspaceRuntime) {
  const bar = runtime.el('.typist');
  bar.hidden = !runtime.typist;
  bar.textContent = runtime.typist ? (runtime.typist === runtime.me.name ? 'Last input: you' : `Last input: ${runtime.typist}`) : '';
  bar.title = bar.textContent;
}

export function tell(runtime: WorkspaceRuntime, what: { type: string; keys?: string; cols?: number; rows?: number }) {
  if (!runtime.canControl()) {
    runtime.say('.watch .note', 'read-only access: you can watch this agent');
    return false;
  }
  if (!runtime.socket || runtime.socket.readyState !== runtime.WebSocket.OPEN) {
    runtime.say('.watch .note', 'not connected', true);
    return false;
  }
  if (what.type === 'keys' && !runtime.screenReady) {
    runtime.say('.watch .note', 'Waiting for the screen to finish restoring.');
    return false;
  }
  runtime.socket.send(JSON.stringify(what));
  return true;
}
