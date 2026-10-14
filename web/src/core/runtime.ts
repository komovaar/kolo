import type { Agent, Host } from './types.ts';
export type { Agent } from './types.ts';

// Elements selected from the fixed application shell. Dynamic markup stays
// typed at its creation site; these controls also serve the legacy frame.
export type Control = HTMLElement & {
  hidden: boolean; disabled: boolean; value: string; select(): void;
};
export interface Glyph { viewBox: string; inner: string }
export interface WorkspaceSnapshot {
  you: { name?: string; read_only?: boolean }; org?: string;
  hosts: Host[]; agents: Agent[];
}
export interface ActivityEntry {
  at: string; what: string; agent: string; text?: string;
  truncated?: boolean; who?: { name: string };
}
export interface AttentionView {
  update(agents: Agent[]): void;
  renderTitle(agents: Agent[]): void;
  reset(): void;
}
export interface TerminalView {
  element: HTMLElement;
  cols: number; rows: number;
  options: { disableStdin?: boolean; fontSize?: number };
  open(element: HTMLElement): void;
  loadAddon(addon: unknown): void;
  onData(callback: (keys: string) => void): unknown;
  write(data: Uint8Array, callback?: () => void): void;
  resize(cols: number, rows: number): void;
  dispose(): void; focus(): void;
  parser: {
    registerCsiHandler(id: { prefix?: string; intermediates?: string; final: string }, callback: (params: number[]) => boolean): unknown;
    registerEscHandler(id: { final: string }, callback: () => boolean): unknown;
    registerDcsHandler(id: { intermediates: string; final: string }, callback: () => boolean): unknown;
    registerOscHandler(command: number, callback: (data: string) => boolean): unknown;
  };
}
export interface BrowserEnvironment {
  window: Window & typeof globalThis;
  document: Document; location: Location;
  fetch: typeof fetch; confirm: typeof confirm; alert: typeof alert;
  crypto: Crypto; localStorage: Pick<Storage, 'getItem' | 'setItem'>; FormData: typeof FormData;
  WebSocket: typeof WebSocket; BroadcastChannel: typeof BroadcastChannel;
  ResizeObserver: typeof ResizeObserver; MutationObserver: typeof MutationObserver;
  addEventListener: Window['addEventListener']; matchMedia: typeof matchMedia;
  setTimeout: Window['setTimeout']; clearTimeout: Window['clearTimeout'];
  innerHeight: number;
  Terminal: new (options: Record<string, unknown>) => TerminalView;
  CanvasAddon: { CanvasAddon: new () => unknown };
  KoloTerminalQueries: { hostReplies(term: TerminalView): void };
  el(selector: string): Control;
}
export interface WorkspaceState {
  views: Record<'boot' | 'signin' | 'app', Control>;
  hosts: Host[]; lastAgents: Agent[];
  signedIn: boolean; authLost: boolean;
  me: { name?: string; read_only?: boolean };
  authRun: number; refreshRun: number; logRun: number;
  retryPending: { name: string; run: number } | null;
  contextAckPending: { name: string; id: string; run: number } | null;
  renamingId: string | null; renameDraft: string; createPending: boolean;
  collapsed: Record<string, boolean>; collapsedProjects: Set<string>;
  authChannel: BroadcastChannel | null; attention: AttentionView;
  term: TerminalView; socket: WebSocket | null; terminalOwner: WebSocket | null;
  screenReady: boolean; watching: string | null; typist: string | null;
  reconnectTimer: number | null;
  baseFont: number; zoom: number; zoomRange: { least: number; most: number };
  fitting: boolean; requestedSize: string | null; watcher: ResizeObserver;
  sidebarMedia: MediaQueryList; sidebarHandle: Control; sidebarWidth: number;
  sidebarDrag: { id: number; x: number; width: number } | null;
}
export interface WorkspaceActions {
  programOf(command: string | null | undefined): string;
  kindGlyph(command: string): Glyph;
  kindIcon(command: string): SVGSVGElement;
  programKind(command: string | null | undefined): string;
  automaticSessionName(command: string, dir: string): string;
  createTerminal(): TerminalView;
  room(): { w: number; h: number };
  fit(): void;
  setZoom(to: number): void;
  sayZoom(): void;
  canWatch(name: string): boolean;
  reconcileWatch(): void;
  watch(name: string): void;
  resetTerminal(): void;
  close(): void;
  connect(name: string): void;
  describe(state: string): string;
  keyboardChanged(): void;
  tell(what: { type: string; keys?: string }): boolean;
  drawHome(): void;
  sessionState(agent: Agent | null | undefined, connected?: boolean): { key: string; label: string };
  drawSession(): void;
  drawChoices(): void;
  openCreate(hostPref: string | null): void;
  closeCreate(): void;
  createSession(ev: { preventDefault(): void; target: HTMLFormElement }): Promise<void>;
  stop(name: string): Promise<void>;
  say(sel: string, message: string, problem?: boolean): void;
  acknowledgeContext(): Promise<void>;
  retrySession(name: string): Promise<void>;
  canControl(): boolean;
  applyAccess(): void;
  signOut(): void;
  refresh(): Promise<WorkspaceSnapshot | null>;
  show(name: keyof WorkspaceRuntime["views"]): void;
  agentInURL(): string | null;
  logInURL(): boolean;
  updateMobileTitle(): void;
  retryWorkspace(): Promise<void>;
  setAccountMenu(open: boolean): void;
  updateSidebarWidth(width: number, save?: boolean): void;
  endSidebarDrag(): void;
  setNavigation(open: boolean): void;
  route(): Promise<void>;
  startRename(a: Agent): void;
  cancelRename(): void;
  commitRename(): Promise<void>;
  drawGroups(agents: Agent[]): void;
  renderGroups(agents: Agent[]): void;
  drawLog(): Promise<void>;
  entryRow(e: ActivityEntry): HTMLDivElement;
  didWhat(what: string): string;
  when(at: string): string;
  labelOf(name: string): string;
}
export interface WorkspaceRuntime extends WorkspaceState, BrowserEnvironment, WorkspaceActions {}
