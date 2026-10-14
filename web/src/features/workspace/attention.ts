import type { Agent } from '../../core/types.ts';
export interface AttentionEnvironment { window: Window & typeof globalThis; document: Document; localStorage: Pick<Storage, 'getItem' | 'setItem'>; Notification: typeof Notification }
// Alerts follow the same snapshots as the sidebar. No terminal content is sent
// to the desktop, and loading a page never replays old questions as new alerts.
export class Attention {
  button: Pick<HTMLButtonElement, 'disabled' | 'setAttribute' | 'textContent' | 'title' | 'onclick'>;
  selected: () => string | null;
  openAgent: (name: string) => void;
  title: string;
  episodes = new Set<string>();
  notices = new Map<string, Notification>();
  ready = false; enabled = false; pending = false; unavailable = false; waiting = 0;
  environment: AttentionEnvironment;
  constructor(button: Pick<HTMLButtonElement, 'disabled' | 'setAttribute' | 'textContent' | 'title' | 'onclick'>, selected: () => string | null, openAgent: (name: string) => void, environment: AttentionEnvironment) {
    this.environment = environment;
    this.button = button;
    this.selected = selected;
    this.openAgent = openAgent;
    this.title = this.environment.document.title;


    this.ready = false;
    this.enabled = false;
    this.pending = false;
    this.unavailable = false;
    try { this.enabled = this.environment.localStorage.getItem('kolo.attention') === 'on'; } catch (_) {}
    button.onclick = () => this.toggle();
    this.renderButton();
  }

  supported() {
    return this.environment.window.isSecureContext && typeof this.environment.window.Notification === 'function';
  }

  renderButton() {
    const supported = this.supported();
    const denied = supported && this.environment.Notification.permission === 'denied';
    const on = supported && this.enabled && this.environment.Notification.permission === 'granted';
    this.button.disabled = !supported || denied || this.pending || this.unavailable;
    this.button.setAttribute('aria-pressed', String(on && !this.unavailable));
    this.button.textContent = !supported || this.unavailable ? 'Desktop alerts unavailable' :
      denied ? 'Desktop alerts blocked' : this.pending ? 'Allow alerts in your browser' :
      on ? 'Disable desktop alerts' : 'Enable desktop alerts';
    this.button.title = !this.environment.window.isSecureContext ? 'Desktop alerts require HTTPS or localhost.' :
      !supported || this.unavailable ? 'This browser cannot show desktop alerts. The tab still shows the waiting count.' :
      denied ? 'Allow notifications in this site’s browser settings to enable alerts.' :
      'Alert when an agent needs an answer. Keep this tab open; alerts include the agent name.';
  }

  async toggle() {
    if (this.button.disabled) return;
    if (this.enabled && this.environment.Notification.permission === 'granted') {
      this.enabled = false;
      this.closeNotices();
    } else {
      this.pending = true;
      this.renderButton();
      try {
        const permission = this.environment.Notification.permission === 'granted' ? 'granted' :
          await this.environment.Notification.requestPermission();
        this.enabled = permission === 'granted';
      } catch (_) {
        this.enabled = false;
        this.unavailable = true;
      } finally {
        this.pending = false;
      }
    }
    try { this.environment.localStorage.setItem('kolo.attention', this.enabled ? 'on' : 'off'); } catch (_) {}
    this.renderButton();
  }

  closeNotice(name: string) {
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
    this.waiting = 0;
    this.environment.document.title = this.title;
  }

  renderTitle(agents: Agent[]) {
    const name = this.selected();
    const agent = agents.find((a) => a.name === name);
    const title = name ? `${agent?.label || agent?.title || agent?.name || name} · ${this.title}` : this.title;
    this.environment.document.title = this.waiting ? `(${this.waiting} waiting) ${title}` : title;
  }

  update(agents: Agent[]) {
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
      const watching = !this.environment.document.hidden && this.environment.document.hasFocus() && this.selected() === a.name;
      if (watching) this.closeNotice(a.name);
      if (!this.ready || seen || watching || !this.enabled || this.button.disabled ||
          this.environment.Notification.permission !== 'granted') continue;
      try {
        const notice = new this.environment.Notification(`${a.label || a.title || a.name} needs you`, {
          body: 'Open Kolo to read and answer the question.',
          icon: '/assets/icon-180.png',
          tag: `kolo-attention-${a.name}`,
        });
        this.notices.set(a.name, notice);
        notice.onclick = () => {
          // An alert can outlive the process or the member's signed-in session.
          if (this.notices.get(a.name) !== notice) return;
          this.environment.window.focus();
          this.openAgent(a.name);
          this.closeNotice(a.name);
        };
        notice.onerror = () => {
          this.unavailable = true;
          this.closeNotices();
          this.renderButton();
        };
      } catch (_) {
        // Some mobile browsers expose this.environment.Notification but reject its constructor.
        this.unavailable = true;
        this.renderButton();
      }
    }
    this.waiting = waiting;
    this.renderTitle(agents);
    this.ready = true;
  }
};
