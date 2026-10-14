// One page, two views: the door, and the org's agents. Which agent is open
// comes from the URL, so opening one and reloading lands back on it.
const el = (sel) => document.querySelector(sel);
const views = { boot: el('.boot'), signin: el('.signin'), app: el('.app') };

function show(name) {
  for (const [key, node] of Object.entries(views)) node.hidden = key !== name;
}

function agentInURL() {
  const m = location.hash.match(/^#\/agent\/([a-z0-9-]+)$/);
  return m && m[1];
}

function logInURL() {
  return location.hash === '#/log';
}

// programOf mirrors the hub's own Program(): the first word of a command
// line, basename only.
function programOf(command) {
  const first = (command || '').trim().split(/\s+/)[0] || '';
  return first.split(/[\\/]/).pop();
}

// Known programs use their monochrome vendor marks. Other commands use a
// terminal glyph, so their icon describes the workspace rather than a random
// shape derived from the command name.
const KNOWN_MARKS = {
  codex: { viewBox: '0 0 24 24', inner: '<path fill="currentColor" fill-rule="evenodd" d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z"></path>' },
  claude: { viewBox: '0 0 24 24', inner: '<path fill="currentColor" d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/>' },
  opencode: { viewBox: '0 0 24 24', inner: '<path fill="currentColor" fill-rule="evenodd" d="M16 6H8v12h8V6zm4 16H4V2h16v20z"></path>' },
  // Gemini: simple-icons "googlegemini", viewBox 0 0 24 24.
  gemini: { viewBox: '0 0 24 24', inner: '<path fill="currentColor" d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/>' },
  // Cursor: simple-icons "cursor", viewBox 0 0 24 24. Two possible binary
  // names cover the same mark.
  cursor: { viewBox: '0 0 24 24', inner: '<path fill="currentColor" d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"/>' },
  // GitHub Copilot: simple-icons "githubcopilot", viewBox 0 0 24 24.
  copilot: { viewBox: '0 0 24 24', inner: '<path fill="currentColor" d="M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z"/>' },
  // Qwen (Code): simple-icons "qwen", viewBox 0 0 24 24.
  qwen: { viewBox: '0 0 24 24', inner: '<path fill="currentColor" d="M23.919 14.545 20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06Zm1.306 19.801-6.205-.002 1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z"/>' },
  // Windsurf: simple-icons "windsurf", viewBox 0 0 24 24.
  windsurf: { viewBox: '0 0 24 24', inner: '<path fill="currentColor" d="M23.55 5.067c-1.2038-.002-2.1806.973-2.1806 2.1765v4.8676c0 .972-.8035 1.7594-1.7597 1.7594-.568 0-1.1352-.286-1.4718-.7659l-4.9713-7.1003c-.4125-.5896-1.0837-.941-1.8103-.941-1.1334 0-2.1533.9635-2.1533 2.153v4.8957c0 .972-.7969 1.7594-1.7596 1.7594-.57 0-1.1363-.286-1.4728-.7658L.4076 5.1598C.2822 4.9798 0 5.0688 0 5.2882v4.2452c0 .2147.0656.4228.1884.599l5.4748 7.8183c.3234.462.8006.8052 1.3509.9298 1.3771.313 2.6446-.747 2.6446-2.0977v-4.893c0-.972.7875-1.7593 1.7596-1.7593h.003a1.798 1.798 0 0 1 1.4718.7658l4.9723 7.0994c.4135.5905 1.05.941 1.8093.941 1.1587 0 2.1515-.9645 2.1515-2.153v-4.8948c0-.972.7875-1.7594 1.7596-1.7594h.194a.22.22 0 0 0 .2204-.2202v-4.622a.22.22 0 0 0-.2203-.2203Z"/>' },
  // Replit (Agent): simple-icons "replit", viewBox 0 0 24 24.
  replit: { viewBox: '0 0 24 24', inner: '<path fill="currentColor" d="M2 1.5A1.5 1.5 0 0 1 3.5 0h7A1.5 1.5 0 0 1 12 1.5V8H3.5A1.5 1.5 0 0 1 2 6.5ZM12 8h8.5A1.5 1.5 0 0 1 22 9.5v5a1.5 1.5 0 0 1-1.5 1.5H12ZM2 17.5A1.5 1.5 0 0 1 3.5 16H12v6.5a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 2 22.5Z"/>' },
};
// A second name for the same mark: different tools ship under more than
// one binary name for the same product.
KNOWN_MARKS['cursor-agent'] = KNOWN_MARKS.cursor;
function kindGlyph(command) {
  const p = programOf(command).toLowerCase().replace(/\.exe$/, '');
  return KNOWN_MARKS[p] || {
    viewBox: '0 0 16 16',
    inner: '<path d="m3 4 3 3-3 3M8 11h5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  };
}

function kindIcon(command) {
  const mark = kindGlyph(command);
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('width', '20');
  icon.setAttribute('height', '20');
  icon.setAttribute('viewBox', mark.viewBox);
  icon.setAttribute('data-agent', programOf(command).toLowerCase());
  icon.innerHTML = mark.inner;
  return icon;
}

let hosts = [];
let signedIn = false;
let authLost = false;
let me = { read_only: true };

function canControl() {
  return signedIn && !me.read_only;
}

let retryPending = null;
let contextAckPending = null;

function applyAccess() {
  const allowed = canControl();
  term.options.disableStdin = !allowed || !screenReady || !socket || socket.readyState !== WebSocket.OPEN;
  el('.home-new').hidden = !allowed;
  el('.watch .restart').hidden = !allowed;
  el('.session-stop').hidden = !allowed;
  const selected = lastAgents.find((a) => a.name === agentInURL());
  const failed = selected?.status === 'failed';
  el('.watch .restart').textContent = failed ? 'Retry' : 'restart';
  el('.watch .restart').disabled = !allowed || (retryPending && retryPending.name === selected?.name) ||
    (failed ? !hosts.some((h) => h.id === selected.host) : !screenReady || !socket || socket.readyState !== WebSocket.OPEN);
  if (!allowed) {
    renamingId = null;
    if (!el('.scrim').hidden) closeCreate();
  }
}
// The agents from the last successful refresh, kept so a rename can redraw
// the side without waiting on a round trip that has nothing to do with it.
let lastAgents = [];
let refreshRun = 0;
let authRun = 0;
const attention = new KoloAttention(el('.attention-toggle'), agentInURL, (name) => {
  location.hash = `#/agent/${name}`;
});
addEventListener('pagehide', () => attention.reset());
let authChannel = null;
try { authChannel = new BroadcastChannel('kolo-auth'); } catch (_) {}
if (authChannel) authChannel.onmessage = (event) => {
  if (event.data === 'signout') signOut();
};
addEventListener('storage', (event) => {
  if (event.key === 'kolo-signout' && event.newValue) signOut();
});
el('.me-menu form').addEventListener('submit', () => {
  signOut();
  if (authChannel) authChannel.postMessage('signout');
  // Older browsers can still notify sibling tabs; storage may be blocked.
  try { localStorage.setItem('kolo-signout', `${Date.now()}-${Math.random()}`); } catch (_) {}
});

function signOut() {
  ++refreshRun;
  ++authRun;
  signedIn = false;
  authLost = true;
  close();
  retryPending = null;
  contextAckPending = null;
  el('.context-warning').hidden = true;
  el('.context-warning-text').textContent = '';
  me = { read_only: true };
  hosts = [];
  lastAgents = [];
  window.KoloUI.switcher.close(false);
  window.KoloUI.share.close();
  applyAccess();
  attention.reset();
  collapsedProjects.clear();
  window.KoloUI.creation.clear();
  el('.groups').replaceChildren();
  window.KoloUI.overview.clear();
  drawChoices();
  el('.workspace-message').hidden = true;
  el('.log-rows').replaceChildren();
  el('.log-message').textContent = '';
  el('.log-message').hidden = true;
  el('.log-retry').hidden = true;
  el('.session-context').textContent = '';
  el('.session-error').textContent = '';
  el('.session-error').hidden = true;
  el('.me-menu').hidden = true;
  el('.me').setAttribute('aria-expanded', 'false');
  el('.me .name').textContent = '';
  el('.me .initial').textContent = '';
  el('.workspace-label').textContent = '';
  el('.workspace-label').title = '';
  show('signin');
  el('.signin .problem').hidden = !location.search.includes('refused');
  el('#signin-token').focus();
}

async function refresh() {
  if (authLost) return null;
  const run = ++refreshRun;
  let resp;
  try {
    resp = await fetch('/v1/agents');
  } catch (_) {
    if (run === refreshRun && signedIn) el('.me .status').textContent = 'connection lost';
    if (run === refreshRun) {
      el('.workspace-message').hidden = !signedIn;
      el('.boot-message').textContent = 'Could not reach Kolo. Check your connection and try again.';
      el('.boot-retry').hidden = false;
    }
    return null;
  }
  // A slower request must not overwrite the result of one made after it.
  if (run !== refreshRun) return null;
  if (resp.status === 401) {
    signOut();
    return null;
  }
  if (!resp.ok) {
    el('.me .status').textContent = `hub error ${resp.status}`;
    el('.workspace-message').hidden = !signedIn;
    el('.boot-message').textContent = `Kolo is unavailable (${resp.status}). Try connecting again.`;
    el('.boot-retry').hidden = false;
    return null;
  }
  let data;
  try {
    data = await resp.json();
  } catch (_) {
    if (run !== refreshRun) return null;
    el('.me .status').textContent = 'unreadable response';
    el('.workspace-message').hidden = !signedIn;
    el('.boot-message').textContent = 'Kolo returned an unreadable response. Try connecting again.';
    el('.boot-retry').hidden = false;
    return null;
  }
  if (run !== refreshRun) return null;
  signedIn = true;
  show('app');
  el('.workspace-message').hidden = true;
  el('.me .status').textContent = data.you.read_only ? 'read-only · online' : 'online';
  el('.me .name').textContent = data.you.name;
  el('.mobile-title').textContent = data.org || 'Kolo';
  el('.workspace-label').textContent = data.org || 'Workspace';
  el('.workspace-label').title = data.org || 'Workspace';
  el('.me .initial').textContent = (data.you.name.trim().slice(0, 1) || '?').toUpperCase();
  me = data.you;
  hosts = data.hosts;
  lastAgents = data.agents || [];
  applyAccess();
  attention.update(lastAgents);
  if (!renamingId) drawGroups(lastAgents);
  drawHome();
  drawSession();
  reconcileWatch();
  drawChoices();
  return data;
}

function drawHome() {
  updateMobileTitle();
  window.KoloUI.overview.update({ hosts, agents: lastAgents, allowed: canControl() });
}

function updateMobileTitle() {
  const selected = agentInURL();
  const active = lastAgents.find((agent) => agent.name === selected);
  el('.mobile-title').textContent = selected ? (active?.label || active?.title || selected)
    : logInURL() ? 'Activity' : el('.workspace-label').textContent || 'Kolo';
}

async function retryWorkspace() {
  el('.boot-message').textContent = 'Connecting to Kolo…';
  el('.boot-retry').disabled = true;
  el('.workspace-retry').disabled = true;
  try { await route(); }
  finally {
    el('.boot-retry').disabled = false;
    el('.workspace-retry').disabled = false;
  }
}
el('.boot-retry').onclick = retryWorkspace;
el('.workspace-retry').onclick = retryWorkspace;

function sessionState(agent, connected = true) {
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

function drawSession() {
  const name = agentInURL();
  const agent = lastAgents.find((a) => a.name === name);
  const state = sessionState(agent, !!agent && hosts.some((h) => h.id === agent.host));
  el('.session-title').textContent = agent ? (agent.label || agent.title || agent.name) : name || 'Session';
  el('.session-title').title = el('.session-title').textContent;
  el('.session-context').textContent = agent
    ? `${agent.host} · ${agent.command} · ${agent.dir}` : 'Waiting for session details';
  el('.session-context').title = el('.session-context').textContent;
  el('.session-head .session-state').textContent = state.label;
  el('.session-head .session-state').dataset.state = state.key;
  el('.session-head .session-state').title = agent?.error ||
    (agent?.status === 'running' && state.key === 'unknown' ? 'Activity is unknown; typing still works.' : '');
  el('.session-access').textContent = canControl() ? 'Control access' : 'Read-only access';
  el('.session-stop').disabled = !agent || !canControl() || !hosts.some((h) => h.id === agent.host);
  el('.session-error').textContent = agent?.error || (agent?.status === 'failed' ? 'The program could not stay running.' : '');
  el('.session-error').hidden = !el('.session-error').textContent;
  const reset = agent?.context_resets?.find((r) => !r.acknowledged);
  el('.context-warning').hidden = !reset;
  el('.context-warning-text').textContent = reset
    ? 'Conversation reset: Kolo could not safely resume the previous conversation and started fresh.' +
      (reset.previous_session ? ` Previous conversation: ${reset.previous_session}.` : '') +
      ' Restarting does not recover the previous conversation automatically.' : '';
  el('.context-ack').hidden = !canControl();
  el('.context-ack').disabled = !!contextAckPending || !agent || !hosts.some((h) => h.id === agent.host);
  applyAccess();
}

// Which agent's name is being edited, and what it currently reads, kept at
// module level, not per-row state, since drawGroups rebuilds the whole side
// from scratch on every refresh and has to know to draw an input instead of
// a name for exactly one row.
let renamingId = null;
let renameDraft = '';

function startRename(a) {
  if (!canControl()) return;
  renamingId = a.name;
  renameDraft = a.label || a.title || a.name;
  drawGroups(lastAgents);
  const input = el('.groups .rename');
  input.focus();
  input.select();
}

function cancelRename() {
  renamingId = null;
  drawGroups(lastAgents);
}

async function commitRename() {
  if (!canControl()) { cancelRename(); return; }
  const id = renamingId;
  const draft = renameDraft.trim();
  const current = lastAgents.find((a) => a.name === id);
  // Nothing worth a round trip: empty is a mis-click, unchanged is a blur
  // that wasn't really an edit.
  if (!id || !draft || (current && draft === (current.label || current.title || current.name))) {
    cancelRename();
    return;
  }
  renamingId = null;
  try {
    const resp = await fetch(`/v1/agents/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: draft }),
    });
    if (!resp.ok) alert((await resp.text()).trim() || `rename failed (${resp.status})`);
  } catch (_) {
    alert('Could not reach the hub. The agent was not renamed.');
  }
  await refresh();
}

// drawGroups redraws the side: one collapsible group per host lending
// itself, its agents nested under it, rather than the host repeated as
// text on every row.
const collapsed = {};
const collapsedProjects = new Set();
function drawGroups(agents) {
  const container = el('.groups');
  const focused = container.contains(document.activeElement);
  const key = focused ? document.activeElement.dataset.focusKey : null;
  const scrollTop = container.scrollTop;
  renderGroups(agents);
  container.scrollTop = scrollTop;
  if (focused && key) {
    const target = [...container.querySelectorAll('[data-focus-key]')]
      .find((node) => node.dataset.focusKey === key && !node.disabled && node.getClientRects().length);
    (target || el('.brand-home')).focus({ preventScroll: true });
  }
}

function renderGroups(agents) {
  const open = agentInURL();
  const container = el('.groups');
  container.replaceChildren();
  let projectId = 0;

  const byHost = new Map();
  for (const a of agents) {
    if (!byHost.has(a.host)) byHost.set(a.host, []);
    byHost.get(a.host).push(a);
  }
  // Every lending host gets a section, whether or not it has an agent on it
  // yet: a host that just connected and is waiting for its first agent is
  // a normal, common state, not one to hide. Order is the host list's own
  // order, stable across a refresh rather than jumping around with whatever
  // order agents happen to load in; an agent whose host has since dropped
  // still gets a group, so it is never silently lost from view.
  const order = hosts.map((h) => h.id);
  for (const id of byHost.keys()) if (!order.includes(id)) order.push(id);

  if (order.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'no-hosts';
    empty.innerHTML = `<p>No machine is lending itself to this org yet.</p>
      <code>kolo host</code>
      <p class="fine">Run it on a machine to connect it here.</p>`;
    container.append(empty);
    return;
  }

  for (const host of order) {
    const members = byHost.get(host) || [];
    const hostInfo = hosts.find((item) => item.id === host);
    const group = document.createElement('div');
    group.className = 'group';

    const head = document.createElement('div');
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
    head.querySelector('.label').textContent = host;
    head.querySelector('.label').title = host;
    head.title = hostInfo ? host : `${host} · Machine disconnected`;
    head.querySelector('.add').dataset.focusKey = JSON.stringify(['add', host]);
    head.querySelector('.add').title = `New session on ${host}`;
    head.querySelector('.add').setAttribute('aria-label', `New session on ${host}`);
    head.querySelector('.add').hidden = !canControl();
    head.querySelector('.add').disabled = !hostInfo;
    if (hostInfo && hostInfo.error) {
      head.title = hostInfo.error;
      head.querySelector('.chip').classList.add('problem');
      const problem = document.createElement('span');
      problem.className = 'host-problem';
      problem.textContent = '!';
      problem.title = hostInfo.error;
      head.querySelector('.spacer').before(problem);
    }
    const isCollapsed = !!collapsed[host];
    head.setAttribute('aria-expanded', String(!isCollapsed));
    head.querySelector('.chevron').classList.toggle('open', !isCollapsed);
    head.onclick = () => {
      collapsed[host] = !collapsed[host];
      drawGroups(agents);
    };
    head.onkeydown = (ev) => {
      if (ev.target === head && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault(); head.click();
      }
    };
    head.querySelector('.add').onclick = (ev) => {
      ev.stopPropagation();
      openCreate(host);
    };

    const body = document.createElement('div');
    body.className = 'group-body' + (isCollapsed ? ' collapsed' : '');

    const projects = new Map();
    for (const agent of members) {
      if (!projects.has(agent.dir)) projects.set(agent.dir, []);
      projects.get(agent.dir).push(agent);
    }
    for (const [directory, sessions] of projects) {
      const key = JSON.stringify([host, directory]);
      const project = document.createElement('section');
      project.className = 'project';
      const projectHead = document.createElement('button');
      projectHead.type = 'button';
      projectHead.className = 'project-head';
      projectHead.id = `project-${projectId++}`;
      projectHead.dataset.focusKey = JSON.stringify(['directory', host, directory]);
      projectHead.setAttribute('aria-expanded', String(!collapsedProjects.has(key)));
      projectHead.setAttribute('aria-label', `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'} in ${directory}`);
      projectHead.title = directory;
      projectHead.innerHTML = '<svg class="project-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 4 4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="project-path"></span><span class="project-count" aria-hidden="true"></span>';
      projectHead.querySelector('.project-path').textContent = directory;
      projectHead.querySelector('.project-count').textContent = sessions.length;
      projectHead.onclick = () => {
        collapsedProjects.has(key) ? collapsedProjects.delete(key) : collapsedProjects.add(key);
        drawGroups(agents);
      };
      const projectBody = document.createElement('div');
      projectBody.className = 'project-sessions';
      projectBody.hidden = collapsedProjects.has(key);
      project.append(projectHead, projectBody);
      body.append(project);

      for (const a of sessions) {
        // A div, not a button: a real <button> can't legally contain the
        // .drop stop button nested inside it, so this carries the button role
        // and keyboard activation by hand instead.
        const row = document.createElement('div');
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.dataset.focusKey = JSON.stringify(['agent', a.host, a.name, a.created_at]);
        row.className = 'agent' + (a.name === open ? ' on' : '');
        row.setAttribute('aria-describedby', projectHead.id);
        if (a.name === open) row.setAttribute('aria-current', 'page');
        row.innerHTML = `
          <span class="row"></span>
          <span class="dir"></span>`;
        const rowInner = row.querySelector('.row');
        // Lifecycle comes from the host control connection; busy, idle and a
        // question waiting come from the live terminal screen.
        const state = sessionState(a, !!hostInfo);
        const busy = state.key === 'busy';
        if (busy) {
          const spinner = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          spinner.setAttribute('class', 'spinner');
          spinner.setAttribute('width', '13'); spinner.setAttribute('height', '13'); spinner.setAttribute('viewBox', '0 0 13 13');
          spinner.setAttribute('role', 'img');
          spinner.setAttribute('aria-label', state.label);
          const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          spinner.innerHTML = `<circle class="track" cx="6.5" cy="6.5" r="5" fill="none" stroke-width="1.6"/>
            <circle class="arc" cx="6.5" cy="6.5" r="5" fill="none" stroke-width="1.6" stroke-linecap="round"/>`;
          title.textContent = state.label;
          spinner.prepend(title);
          rowInner.append(spinner);
        } else {
          const dot = document.createElement('span');
          dot.className = `dot ${state.key}`;
          dot.title = state.label;
          dot.setAttribute('role', 'img');
          dot.setAttribute('aria-label', state.label);
          rowInner.append(dot);
        }
        if (a.name === renamingId) {
          const input = document.createElement('input');
          input.className = 'rename';
          input.dataset.focusKey = row.dataset.focusKey;
          input.setAttribute('aria-label', 'Session name');
          input.value = renameDraft;
          input.oninput = (ev) => { renameDraft = ev.target.value; };
          input.onkeydown = (ev) => {
            if (ev.key === 'Enter') { ev.preventDefault(); commitRename(); }
            else if (ev.key === 'Escape') { ev.preventDefault(); cancelRename(); }
          };
          input.onblur = () => commitRename();
          input.onclick = (ev) => ev.stopPropagation();
          rowInner.append(input);
        } else {
          const name = document.createElement('span');
          name.className = 'name';
          name.textContent = a.label || a.title || a.name;
          name.title = `${name.textContent} · ${canControl() ? 'Double-click or press F2 to rename' : 'Read-only access'}`;
          name.ondblclick = (ev) => { ev.stopPropagation(); startRename(a); };
          rowInner.append(name);
        }
        const chip = document.createElement('span');
        chip.className = 'kind-chip';
        chip.title = programOf(a.command) || a.command;
        chip.append(kindIcon(a.command));
        rowInner.append(chip);
        const drop = document.createElement('button');
        drop.type = 'button';
        drop.hidden = !canControl();
        drop.disabled = !hostInfo;
        drop.className = 'drop';
        drop.dataset.focusKey = JSON.stringify(['stop', a.host, a.name, a.created_at]);
        drop.title = `Stop session ${a.label || a.title || a.name}`;
        drop.setAttribute('aria-label', drop.title);
        drop.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor"/></svg>';
        drop.onclick = (ev) => { ev.stopPropagation(); stop(a.name); };
        rowInner.append(drop);
        row.querySelector('.dir').textContent = a.dir;
        row.querySelector('.dir').title = a.dir;
        row.title = a.error ? `${state.label}: ${a.error}` : state.label;
        row.onclick = () => { setNavigation(false); location.hash = `#/agent/${a.name}`; };
        row.onkeydown = (ev) => {
          if (ev.target !== row) return;
          if (ev.key === 'F2' && canControl()) { ev.preventDefault(); startRename(a); return; }
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setNavigation(false); location.hash = `#/agent/${a.name}`; }
        };
        projectBody.append(row);
      }
    }

    group.append(head, body);
    container.append(group);
  }
}

// drawChoices fills the create dialog with what the hosts are lending. The
// choices are the host's own terms, so nothing can be picked that will only
// be refused a moment later, unless the host lent any command or any
// directory, in which case that field opens up into free text.
function drawChoices() {
  window.KoloUI.creation.update(hosts, canControl());
}

function programKind(command) {
  const program = programOf(command).toLowerCase().replace(/\.exe$/, '');
  if (['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd'].includes(program)) return 'Shell';
  if (['claude', 'opencode', 'codex', 'gemini', 'cursor', 'cursor-agent', 'copilot', 'qwen', 'windsurf', 'replit'].includes(program)) return 'AI agent';
  return 'Command';
}

function openCreate(hostPref) {
  if (!canControl()) return;
  setNavigation(false);
  drawChoices();
  window.KoloUI.creation.open(hostPref);
  el('.app').inert = true;
}
function closeCreate() {
  el('.app').inert = false;
  window.KoloUI.creation.close();
}
el('.side .log-open').onclick = () => { setNavigation(false); location.hash = '#/log'; };
el('.brand-home').onclick = () => { setNavigation(false); location.hash = ''; };

let createPending = false;
function automaticSessionName(command, dir) {
  const project = (dir || '').split(/[\\/]/).filter(Boolean).pop() || 'session';
  const base = `${project}-${programOf(command) || 'agent'}`.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 23).replace(/-+$/g, '') || 'session';
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)), (n) => n.toString(16).padStart(2, '0')).join('');
  return `${base}-${suffix}`;
}

async function createSession(ev) {
  ev.preventDefault();
  if (!canControl()) return;
  const submit = ev.target.querySelector('button[type=submit]');
  if (submit.disabled || createPending) return;
  createPending = true;
  if (document.activeElement === submit) el('.dialog').focus();
  const form = new FormData(ev.target);
  const lendingAny = !el('input[name=command]').hidden;
  const command = lendingAny ? form.get('command') : window.KoloUI.creation.command;
  const request = {
    name: form.get('name')?.trim() || automaticSessionName(command, form.get('dir')), host: form.get('host'),
    dir: form.get('dir'), command,
  };
  const run = authRun;
  const body = JSON.stringify(request);
  window.KoloUI.creation.setPending(true);
  try {
    const resp = await fetch('/v1/agents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    if (run !== authRun || !signedIn) return;
    if (!resp.ok) {
      say('.dialog-note', (await resp.text()).trim() || `create failed (${resp.status})`, true);
      return;
    }
    const made = await resp.json();
    if (run !== authRun || !signedIn) return;
    closeCreate();
    await refresh();
    if (run === authRun && signedIn) location.hash = `#/agent/${made.name}`;
  } catch (_) {
    if (run !== authRun || !signedIn) return;
    const data = await refresh();
    if (run !== authRun || !signedIn) return;
    const found = data?.agents?.find((a) => a.name === request.name && a.host === request.host &&
      a.dir === request.dir && a.command === request.command);
    if (found) {
      closeCreate();
      location.hash = `#/agent/${found.name}`;
    } else {
      say('.dialog-note', 'Could not confirm whether the session was created. Check the session list before trying again.', true);
    }
  } finally {
    createPending = false;
    window.KoloUI.creation.setPending(false);
    drawChoices();
    if (!el('.scrim').hidden) el('form.create button[type=submit]')?.focus();
  }
}
window.KoloController = { createSession, closeCreate, openCreate, kindGlyph, programKind, programOf, sessionState,
  prepareOverlay() { setNavigation(false); setAccountMenu(false); window.KoloUI.share.close(); },
  suspend() {
    ++authRun;
    ++refreshRun;
    signedIn = false;
    authLost = true;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    term.options.disableStdin = true;
    const previous = socket;
    socket = null;
    previous?.close();
  },
};

async function stop(name) {
  if (!canControl()) return;
  if (!confirm(`Stop session ${name}? This ends its running process and removes the session for everyone.`)) return;
  try {
    const resp = await fetch(`/v1/agents/${name}`, { method: 'DELETE' });
    if (!resp.ok) {
      alert((await resp.text()).trim() || `stop failed (${resp.status})`);
      return;
    }
    if (agentInURL() === name) location.hash = '';
    await refresh();
  } catch (_) {
    alert('Could not reach the hub. The agent may still be running.');
  }
}

function say(sel, message, problem) {
  if (sel === '.dialog-note') { window.KoloUI.creation.message(message, problem); return; }
  const note = el(sel);
  note.textContent = message;
  note.classList.toggle('problem', !!problem);
}

function setAccountMenu(open) {
  el('.me-menu').hidden = !open;
  el('.me').setAttribute('aria-expanded', String(open));
}
el('.me').onclick = () => setAccountMenu(el('.me-menu').hidden);
el('.me-wrap').onkeydown = (event) => {
  if (event.key === 'Escape' && !el('.me-menu').hidden) {
    event.preventDefault();
    event.stopPropagation();
    setAccountMenu(false);
    el('.me').focus();
  }
};
el('.me-wrap').addEventListener('focusout', (event) => {
  if (!el('.me-wrap').contains(event.relatedTarget)) setAccountMenu(false);
});
document.addEventListener('click', (ev) => {
  if (!el('.me-wrap').contains(ev.target)) setAccountMenu(false);
});

// A stable rendering size; fit scales the measured grid for each viewer.
const baseFont = 14;

function createTerminal() {
  const next = new Terminal({
    // Keystrokes go to the agent as they are pressed. Whoever types last is
    // the typist the others see, once the initial screen has been restored.
    disableStdin: true,
    cursorBlink: true,
    // What the agent says is what the machine says, so it is said in the
    // brand's mono. The stack behind it is what draws until the file arrives.
    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: baseFont,
    customGlyphs: true,
    scrollback: 5000,
    theme: { background: '#101314', foreground: '#E7E9E4',
             cursor: '#A0C4B1', selectionBackground: '#284336', brightBlack: '#8B949A' },
  });
  const stage = document.createElement('div');
  stage.className = 'terminal-stage';
  el('#term').append(stage);
  next.open(stage);
  KoloTerminalQueries.hostReplies(next);

  // The DOM renderer sets block glyphs in whatever font the browser picks,
  // leaving seams between quadrants. The canvas renderer draws them itself.
  try {
    next.loadAddon(new CanvasAddon.CanvasAddon());
  } catch (e) {
    console.warn('canvas renderer unavailable, falling back to the DOM', e);
  }
  // xterm has encoded arrows and pastes as the running program requested.
  next.onData((keys) => {
    if (next !== term || !socket) return;
    tell({ type: 'keys', keys });
  });
  return next;
}
let term = createTerminal();
let terminalOwner = null;
let screenReady = false;

// Who typed at the agent being watched last.
let typist = null;

let socket = null;
let watching = null;
let reconnectTimer = null;

// room is what the frame has left to draw a terminal in.
function room() {
  const viewport = window.visualViewport;
  if (viewport && matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px)').matches) el('.app').style.height = `${viewport.height}px`;
  else el('.app').style.height = '';
  const box = el('#term').getBoundingClientRect();
  return { w: Math.floor(box.width), h: Math.floor(box.height) };
}

// How much larger than fitted this window draws the screen. One person's own,
// and in nothing the hub is told: the grid is the agent's, this is only how
// big it is drawn here.
let zoom = 1;
const zoomRange = { least: 0.5, most: 4 };

// Render glyphs at their final size. Scaling a painted canvas resamples text
// and makes it blurry, especially at fractional scales on desktop displays.
let fitting = false;
let requestedSize = null;
function fit() {
  if (fitting) return;
  const drawn = term.element, grid = drawn && drawn.querySelector('.xterm-screen');
  const box = room();
  if (!grid || !grid.offsetWidth || !grid.offsetHeight || !box.w || !box.h) return;
  fitting = true;
  try {
    if (canControl()) {
      term.options.fontSize = baseFont * zoom;
      const cellWidth = grid.offsetWidth / term.cols;
      const cellHeight = grid.offsetHeight / term.rows;
      const cols = Math.max(2, Math.min(500, Math.floor(box.w / cellWidth)));
      const rows = Math.max(2, Math.min(200, Math.floor(box.h / cellHeight)));
      const size = `${cols}x${rows}`;
      if (screenReady && socket && socket.readyState === WebSocket.OPEN && requestedSize !== size) {
        requestedSize = size;
        socket.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
      // Wait for the host's size announcement before changing our buffer.
      // This keeps incoming output and all viewers on the same grid.
    } else {
      // Read-only viewers fit the shared grid without resizing the agent.
      let low = 1, high = 64;
      for (let i = 0; i < 10; i++) {
        const candidate = (low + high) / 2;
        term.options.fontSize = candidate;
        if (grid.offsetWidth <= box.w && grid.offsetHeight <= box.h) low = candidate;
        else high = candidate;
      }
      term.options.fontSize = low * zoom;
    }
    const width = grid.offsetWidth, height = grid.offsetHeight;
    const stage = drawn.parentElement;
    stage.style.width = `${Math.max(box.w, width)}px`;
    stage.style.height = `${Math.max(box.h, height)}px`;
    drawn.style.width = `${width}px`;
    drawn.style.height = `${height}px`;
    drawn.style.left = '0px';
    drawn.style.top = '0px';
    const frame = el('#term');
    frame.classList.toggle('roam', zoom > 1 || width > box.w || height > box.h);
    if (zoom <= 1) { frame.scrollLeft = 0; frame.scrollTop = 0; }
    sayZoom();
  } finally { fitting = false; }
}

// Only observe the available space; changing the font also resizes the grid.
const watcher = new ResizeObserver(() => fit());
watcher.observe(el('#term'));

addEventListener('resize', fit);
document.fonts.ready.then(fit);
window.visualViewport?.addEventListener('resize', fit);

// The zoom control, which belongs to this window and says so: it reads "fit"
// until somebody has moved it.
function setZoom(to) {
  zoom = Math.max(zoomRange.least, Math.min(to, zoomRange.most));
  fit();
}
function sayZoom() {
  el('.zoom .at').textContent = zoom === 1 ? 'fit' : `${Math.round(zoom * 100)}%`;
  el('.zoom').classList.toggle('moved', zoom !== 1);
}
el('.zoom .out').onclick = () => setZoom(zoom / 1.25);
el('.zoom .in').onclick = () => setZoom(zoom * 1.25);
el('.zoom .at').onclick = () => setZoom(1);

function canWatch(name) {
  const agent = lastAgents.find((a) => a.name === name);
  return signedIn && !!agent && hosts.some((h) => h.id === agent.host) &&
    (agent.status === 'running' || agent.status === 'starting');
}

// Poll lifecycle status independently of the terminal. Failed or removed
// sessions have no screen to reconnect to; a returning host can resume watching.
function reconcileWatch() {
  const name = agentInURL();
  if (!signedIn || !name) return;
  if (!canWatch(name)) {
    close();
    const agent = lastAgents.find((a) => a.name === name);
    el('.session-connection').textContent = agent?.status === 'failed' ? 'Session failed' : 'Session unavailable';
    say('.watch .note', agent?.status === 'failed'
      ? (canControl() ? 'Fix the problem on the machine, then choose Retry.' : 'A member with control access can retry this session.')
      : 'The machine is disconnected or this session has been removed.');
    applyAccess();
    return;
  }
  if (watching !== name) watch(name);
  else if ((!socket || socket.readyState === WebSocket.CLOSED) && !reconnectTimer) connect(name);
}

function watch(name) {
  close();
  watching = name;
  connect(name);
}

function resetTerminal() {
  // reset() does not drain xterm's write buffer or its UTF-8/escape parser.
  // Replacing the instance keeps in-flight bytes on the detached old screen.
  const focused = watching && term.element.contains(document.activeElement);
  term.dispose();
  el('#term').replaceChildren();
  term = createTerminal();
  terminalOwner = null;
  screenReady = false;
  requestedSize = null;
  applyAccess();
  fit();
  if (focused) term.focus();
}

function close() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  watching = null;
  el('.session-connection').textContent = 'Disconnected';
  typist = null; keyboardChanged();
  el('.watch .restart').disabled = true;
  if (socket) { const was = socket; socket = null; was.close(); }
  if (terminalOwner) resetTerminal();
}

function connect(name) {
  if (!signedIn || watching !== name || !canWatch(name)) return;
  if (terminalOwner) resetTerminal();
  el('.session-connection').textContent = 'Connecting…';
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${scheme}://${location.host}/v1/watch/${name}`);
  ws.binaryType = 'arraybuffer';
  socket = ws;
  terminalOwner = ws;
  const view = term;
  let snapshotReceived = false;

  // Every handler checks it is still the current socket: a superseded one still
  // reports its own close, which would land after the replacement opened.
  ws.onopen = () => {
    if (ws !== socket) return;
    el('.session-connection').textContent = 'Restoring screen…';
    say('.watch .note', '');
  };

  ws.onmessage = (ev) => {
    if (ws !== socket) return;
    if (typeof ev.data !== 'string') {
      const first = !snapshotReceived;
      snapshotReceived = true;
      view.write(new Uint8Array(ev.data), first ? () => {
        if (ws !== socket || view !== term || ws.readyState !== WebSocket.OPEN) return;
        screenReady = true;
        applyAccess();
        fit();
        el('.session-connection').textContent = 'Live connection';
      } : undefined);
      return;
    }
    const msg = JSON.parse(ev.data);
    switch (msg.type) {
      // Apply the host's authoritative PTY dimensions before its repaint.
      case 'size':
        view.resize(msg.cols, msg.rows);
        fit();
        break;
      case 'state':
        say('.watch .note', msg.state === 'dialog' ? describe(msg.state) : '');
        const agent = lastAgents.find((a) => a.name === name);
        if (agent) agent.screen_state = msg.state;
        attention.update(lastAgents);
        if (!renamingId) drawGroups(lastAgents);
        drawSession();
        drawHome();
        break;
      case 'interrupted':
        say('.watch .note', `${msg.from} stopped the agent`);
        break;
      // Who typed last. Announced on the screen everybody is watching, so it
      // arrives in step with what the agent does.
      case 'keyboard':
        typist = msg.who || null;
        keyboardChanged();
        break;
      // Both arrive just before the screen goes, so they are the last thing
      // anyone watching is told about the process they were watching.
      case 'restarted':
        say('.watch .note', `${msg.from} restarted the agent`);
        break;
      case 'fresh':
        say('.watch .note', `${msg.from} started the agent fresh. Its conversation is gone`);
        break;
      case 'refused':
        say('.watch .note', msg.text, true);
        break;
    }
  };

  // Falling behind, an agent restarting, and one not started yet all end the
  // same way: reconnect, and the next repaint resyncs.
  ws.onclose = () => {
    if (ws !== socket) return;
    screenReady = false;
    applyAccess();
    typist = null; keyboardChanged();
    el('.watch .restart').disabled = true;
    el('.session-connection').textContent = 'Reconnecting…';
    say('.watch .note', 'Screen disconnected. Input is unavailable while Kolo reconnects.');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (signedIn && watching === name && ws === socket) connect(name);
    }, 1000);
    refresh();
  };
  ws.onerror = () => ws.close();
}

// The states come from the agent's own screen, so this says what is true rather
// than what kolo intended.
function describe(state) {
  switch (state) {
    case 'idle': return canControl() ? 'Ready for input.' : 'Ready. You have read-only access.';
    case 'busy': return 'Working. Follow progress in the terminal.';
    // Kolo says that a question is up, never what it is: reading the question is
    // what the screen in front of you is for, and answering it is what typing
    // is for.
    case 'dialog': return canControl() ? 'Waiting for input. Type in the terminal to answer.'
      : 'Waiting for a member with control access to answer.';
    default: return 'Live terminal. Activity detection is unavailable for this screen.';
  }
}

// keyboardChanged redraws who typed last.
function keyboardChanged() {
  const bar = el('.typist');
  bar.hidden = !typist;
  bar.textContent = typist ? (typist === me.name ? 'Last input: you' : `Last input: ${typist}`) : '';
  bar.title = bar.textContent;
}

// tell sends one thing to the agent. Who it is from is the hub's word, taken
// from the connection, so there is nothing to send about that.
function tell(what) {
  if (!canControl()) {
    say('.watch .note', 'read-only access: you can watch this agent');
    return false;
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    say('.watch .note', 'not connected', true);
    return false;
  }
  if (what.type === 'keys' && !screenReady) {
    say('.watch .note', 'Waiting for the screen to finish restoring.');
    return false;
  }
  socket.send(JSON.stringify(what));
  return true;
}

async function acknowledgeContext() {
  if (!canControl() || contextAckPending) return;
  const name = agentInURL();
  const agent = lastAgents.find((a) => a.name === name);
  const reset = agent?.context_resets?.find((r) => !r.acknowledged);
  if (!reset) return;
  const attempt = { name, id: reset.id, run: authRun };
  contextAckPending = attempt;
  drawSession();
  try {
    const resp = await fetch(`/v1/agents/${encodeURIComponent(name)}/context/ack`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: reset.id }),
    });
    if (attempt.run !== authRun || name !== agentInURL()) return;
    if (resp.status === 401) { signOut(); return; }
    if (!resp.ok) {
      const problem = await resp.text();
      if (attempt.run === authRun && name === agentInURL()) say('.watch .note', problem, true);
      return;
    }
    // The endpoint waits for durable host confirmation. Polling supplies the
    // updated record; a newer reset cannot be hidden by this request.
    await refresh();
  } catch (_) {
    if (attempt.run === authRun && name === agentInURL()) say('.watch .note', 'Could not acknowledge the reset. Try again.', true);
  } finally {
    if (contextAckPending === attempt) contextAckPending = null;
    if (attempt.run === authRun && name === agentInURL()) drawSession();
  }
}

el('.context-ack').onclick = acknowledgeContext;

async function retrySession(name) {
  if (!canControl() || retryPending?.name === name) return;
  const agent = lastAgents.find((a) => a.name === name);
  if (!agent || agent.status !== 'failed') return;
  const run = authRun;
  const attempt = { name, run };
  retryPending = attempt;
  applyAccess();
  try {
    const resp = await fetch(`/v1/agents/${encodeURIComponent(name)}/retry`, { method: 'POST' });
    if (run !== authRun || name !== agentInURL()) return;
    if (resp.status === 401) { signOut(); return; }
    if (!resp.ok) {
      const problem = await resp.text();
      if (run === authRun && name === agentInURL()) say('.watch .note', problem, true);
      return;
    }
    agent.status = 'starting';
    agent.error = '';
    drawSession();
    reconcileWatch();
    await refresh();
  } catch (_) {
    if (run === authRun && name === agentInURL()) say('.watch .note', 'Could not reach the hub. Try again.', true);
  } finally {
    if (retryPending === attempt) retryPending = null;
    applyAccess();
  }
}

el('.watch .restart').onclick = () => {
  if (!canControl()) return;
  const name = agentInURL();
  if (lastAgents.find((a) => a.name === name)?.status === 'failed') {
    retrySession(name);
    return;
  }
  if (!confirm('Restart this agent? Its current work will be interrupted. Kolo will resume its conversation when this agent supports it.')) return;
  tell({ type: 'restart' });
};
el('.session-stop').onclick = () => {
  const name = agentInURL();
  if (name) stop(name);
};


// ---- the log -----------------------------------------------------------

// Newest first: the question the log is opened with is almost always what
// just happened, and 100 entries is more than a screen.
let logRun = 0;
async function drawLog() {
  const run = authRun;
  const request = ++logRun;
  const current = () => run === authRun && signedIn && request === logRun;
  try {
    const resp = await fetch('/v1/log');
    if (!current()) return;
    if (resp.status === 401) { signOut(); return; }
    if (!resp.ok) throw new Error('Activity request failed');
    const data = await resp.json();
    if (!current()) return;
    if (!Array.isArray(data.entries)) throw new Error('Unreadable activity response');
    const entries = data.entries;
    const message = el('.log-message');
    message.textContent = data.persistent === false
      ? 'New activity is only kept in memory and may be lost when the hub restarts.' : '';
    message.hidden = !message.textContent;
    el('.log-retry').hidden = true;

    const rows = el('.log-rows');
    rows.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'log-empty';
      empty.textContent = 'Nothing yet. What people do here is written down as they do it.';
      rows.append(empty);
      return;
    }
    for (let i = entries.length - 1; i >= 0; i--) rows.append(entryRow(entries[i]));
  } catch (_) {
    if (!current()) return;
    el('.log-message').textContent = 'Could not load activity. Previously loaded entries may be out of date. Try loading it again.';
    el('.log-message').hidden = false;
    el('.log-retry').hidden = false;
  }
}

el('.log-retry').onclick = drawLog;

// Every part of an entry is somebody's text, so every part of it is set as
// text. Nothing here builds markup out of what a member typed.
function entryRow(e) {
  const row = document.createElement('div');
  row.className = 'entry';
  row.dataset.action = e.what;
  const put = (cls, text) => {
    const available = cls === 'on' && lastAgents.some((agent) => agent.name === e.agent);
    const span = document.createElement(available ? 'a' : 'span');
    span.className = cls;
    span.textContent = text;
    span.title = String(text || '');
    if (available) span.href = `#/agent/${e.agent}`;
    row.append(span);
  };

  put('at', when(e.at));
  const who = e.who && e.who.name;
  if (!who) row.classList.add('nobody');
  put('who', who || 'nobody');
  put('what', didWhat(e.what));
  put('on', labelOf(e.agent));
  if (e.text) put('said', e.text + (e.truncated ? ' … [truncated]' : ''));
  return row;
}

// The past tense of what the hub wrote down. An unknown verb is shown as it
// came: a hub newer than this page has nothing to gain from being guessed at.
function didWhat(what) {
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

// Today is a time alone. Anything older carries the day it happened on, since
// a bare 09:14 thirty days back says the wrong thing confidently.
function when(at) {
  const d = new Date(at);
  if (isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

// An agent renamed in the side reads by its label here too. The journal keeps
// the name, which is what survives a rename.
function labelOf(name) {
  const a = lastAgents.find((x) => x.name === name);
  return (a && (a.label || a.title)) || name;
}


const sidebarMedia = matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px)');
const sidebarHandle = el('.side-resize');
let sidebarWidth = 240;
try {
  const saved = Number(localStorage.getItem('kolo-sidebar-width'));
  if (Number.isFinite(saved) && saved > 0) sidebarWidth = saved;
} catch (_) {}
function updateSidebarWidth(width, save = false) {
  if (!el('.app').clientWidth) return;
  const max = Math.min(480, Math.floor(el('.app').clientWidth / 2));
  const clamped = Math.max(180, Math.min(max, width));
  el('.app').style.setProperty('--sidebar-width', `${clamped}px`);
  sidebarHandle.setAttribute('aria-valuemin', '180');
  sidebarHandle.setAttribute('aria-valuemax', String(max));
  sidebarHandle.setAttribute('aria-valuenow', String(Math.round(clamped)));
  if (save) {
    sidebarWidth = clamped;
    try { localStorage.setItem('kolo-sidebar-width', String(clamped)); } catch (_) {}
  }
}
let sidebarDrag = null;
sidebarHandle.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || sidebarMedia.matches) return;
  event.preventDefault();
  sidebarDrag = { id: event.pointerId, x: event.clientX, width: el('.side').getBoundingClientRect().width };
  sidebarHandle.setPointerCapture(event.pointerId);
  el('.app').classList.add('resizing');
});
sidebarHandle.addEventListener('pointermove', (event) => {
  if (!sidebarDrag || sidebarDrag.id !== event.pointerId) return;
  updateSidebarWidth(sidebarDrag.width + event.clientX - sidebarDrag.x, true);
});
function endSidebarDrag() {
  sidebarDrag = null;
  el('.app').classList.remove('resizing');
}
sidebarHandle.addEventListener('pointerup', endSidebarDrag);
sidebarHandle.addEventListener('pointercancel', endSidebarDrag);
sidebarHandle.addEventListener('lostpointercapture', endSidebarDrag);
sidebarHandle.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const width = el('.side').getBoundingClientRect().width;
  updateSidebarWidth(event.key === 'Home' ? 180 : event.key === 'End' ? 480 :
    width + (event.key === 'ArrowLeft' ? -10 : 10), true);
});
addEventListener('resize', () => {
  endSidebarDrag();
  updateSidebarWidth(sidebarWidth);
});
updateSidebarWidth(sidebarWidth);
new ResizeObserver(() => updateSidebarWidth(sidebarWidth)).observe(el('.app'));

function setNavigation(open) {
  const mobile = matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px)').matches;
  const focusInSidebar = el('.side').contains(document.activeElement);
  el('.app').classList.toggle('nav-open', mobile && open);
  el('.mobile-menu').setAttribute('aria-expanded', String(mobile && open));
  el('.side').inert = mobile && !open;
  el('main').inert = mobile && open;
  if (mobile && open) {
    const selected = el('.agent.on');
    (selected?.getClientRects().length ? selected : el('.side-overview')).focus();
  }
  else if (mobile && focusInSidebar) el('.mobile-menu').focus();
}
el('.mobile-menu').onclick = () => setNavigation(el('.mobile-menu').getAttribute('aria-expanded') !== 'true');
el('.nav-shade').onclick = () => setNavigation(false);
addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && el('.mobile-menu').getAttribute('aria-expanded') === 'true') {
    setNavigation(false);
    el('.mobile-menu').focus();
  }
});
matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px)').addEventListener('change', () => setNavigation(false));

// ---- routing -----------------------------------------------------------

async function route() {
  setNavigation(false);
  attention.renderTitle(lastAgents);
  const name = agentInURL();
  const log = logInURL();
  updateMobileTitle();
  if (!name && !log) el('.side-overview').setAttribute('aria-current', 'page');
  else el('.side-overview').removeAttribute('aria-current');
  if (log) el('.log-open').setAttribute('aria-current', 'page');
  else el('.log-open').removeAttribute('aria-current');
  if (watching !== name) close();
  // The screen is put up before the list is fetched, so opening an agent does
  // not wait on a round trip that has nothing to do with it.
  el('.watch').hidden = !name;
  el('.log').hidden = !log;
  el('.home').hidden = !!name || log;
  drawSession();
  const data = await refresh();
  if (!data || name !== agentInURL() || log !== logInURL()) return;
  if (name) reconcileWatch();
  else close();
  // After the list rather than beside it, so the first draw already knows the
  // labels its rows are named by.
  if (log) drawLog();
}

addEventListener('hashchange', route);
route();
// The list is a live thing: agents appear when somebody else makes one, and
// change status on their own. Refresh access even mid-rename; refresh() defers
// redrawing that row until editing ends, unless control access was revoked.
setInterval(() => {
  if (!signedIn) return;
  refresh();
  // Only while the newest entry is in view. Entries arrive at the top, and
  // redrawing under somebody who has scrolled back moves what they are
  // reading out from under them.
  if (logInURL() && el('.log-rows').scrollTop === 0) drawLog();
}, 3000);
