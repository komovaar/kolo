// Alerts follow the same snapshots as the sidebar. No terminal content is sent
// to the desktop, and loading a page never replays old questions as new alerts.
globalThis.KoloAttention = class {
  constructor(button, selected, openAgent) {
    this.button = button;
    this.selected = selected;
    this.openAgent = openAgent;
    this.title = document.title;
    this.episodes = new Set();
    this.notices = new Map();
    this.ready = false;
    this.enabled = false;
    this.pending = false;
    this.unavailable = false;
    try { this.enabled = localStorage.getItem('kolo.attention') === 'on'; } catch (_) {}
    button.onclick = () => this.toggle();
    this.renderButton();
  }

  supported() {
    return window.isSecureContext && typeof window.Notification === 'function';
  }

  renderButton() {
    const supported = this.supported();
    const denied = supported && Notification.permission === 'denied';
    const on = supported && this.enabled && Notification.permission === 'granted';
    this.button.disabled = !supported || denied || this.pending || this.unavailable;
    this.button.setAttribute('aria-pressed', String(on && !this.unavailable));
    this.button.textContent = !supported || this.unavailable ? 'desktop alerts unavailable' :
      denied ? 'desktop alerts blocked' : this.pending ? 'allow alerts in your browser' :
      on ? 'disable desktop alerts' : 'enable desktop alerts';
    this.button.title = !window.isSecureContext ? 'Desktop alerts require HTTPS or localhost.' :
      !supported || this.unavailable ? 'This browser cannot show desktop alerts. The tab still shows the waiting count.' :
      denied ? 'Allow notifications in this site’s browser settings to enable alerts.' :
      'Alert when an agent needs an answer. Keep this tab open; alerts include the agent name.';
  }

  async toggle() {
    if (this.button.disabled) return;
    if (this.enabled && Notification.permission === 'granted') {
      this.enabled = false;
      this.closeNotices();
    } else {
      this.pending = true;
      this.renderButton();
      try {
        const permission = Notification.permission === 'granted' ? 'granted' :
          await Notification.requestPermission();
        this.enabled = permission === 'granted';
      } catch (_) {
        this.enabled = false;
        this.unavailable = true;
      } finally {
        this.pending = false;
      }
    }
    try { localStorage.setItem('kolo.attention', this.enabled ? 'on' : 'off'); } catch (_) {}
    this.renderButton();
  }

  closeNotice(name) {
    const notice = this.notices.get(name);
    if (notice) notice.close();
    this.notices.delete(name);
  }

  closeNotices() {
    for (const name of this.notices.keys()) this.closeNotice(name);
  }

  reset() {
    this.closeNotices();
    this.episodes.clear();
    this.ready = false;
    document.title = this.title;
  }

  update(agents) {
    this.renderButton();
    const present = new Set(agents.map((a) => a.name));
    for (const name of this.episodes) {
      if (!present.has(name)) {
        this.episodes.delete(name);
        this.closeNotice(name);
      }
    }
    let waiting = 0;
    for (const a of agents) {
      if (a.status !== 'running' || a.screen_state !== 'dialog') {
        this.closeNotice(a.name);
        // A missing screen during reconnect is not proof the question ended.
        if (a.screen_state === 'idle' || a.screen_state === 'busy') this.episodes.delete(a.name);
        continue;
      }
      waiting++;
      const seen = this.episodes.has(a.name);
      this.episodes.add(a.name);
      const watching = !document.hidden && document.hasFocus() && this.selected() === a.name;
      if (watching) this.closeNotice(a.name);
      if (!this.ready || seen || watching || !this.enabled || this.button.disabled ||
          Notification.permission !== 'granted') continue;
      try {
        const notice = new Notification(`${a.label || a.name} needs you`, {
          body: 'Open Kolo to read and answer the question.',
          icon: '/assets/icon-180.png',
          tag: `kolo-attention-${a.name}`,
        });
        this.notices.set(a.name, notice);
        notice.onclick = () => {
          // An alert can outlive the process or the member's signed-in session.
          if (this.notices.get(a.name) !== notice) return;
          window.focus();
          this.openAgent(a.name);
          this.closeNotice(a.name);
        };
        notice.onerror = () => {
          this.unavailable = true;
          this.closeNotices();
          this.renderButton();
        };
      } catch (_) {
        // Some mobile browsers expose Notification but reject its constructor.
        this.unavailable = true;
        this.renderButton();
      }
    }
    document.title = waiting ? `(${waiting} waiting) ${this.title}` : this.title;
    this.ready = true;
  }
};
