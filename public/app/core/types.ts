export interface Host { id: string; dirs?: string[] | null; allow?: string[] | null; found?: string[]; error?: string }
export interface Agent { name: string; host: string; command: string; dir: string; label?: string; title?: string; status: string; screen_state?: string; error?: string; created_at?: string }
export interface WorkspaceData { hosts: Host[]; agents: Agent[]; allowed: boolean }
export interface CreationState {
  open: boolean; pending: boolean; hosts: Host[]; allowed: boolean;
  host: string; dir: string; command: string; name: string; message: string; problem: boolean;
}

declare global {
  interface Window {
    KoloStartup: { fail(): void };
    KoloUI: {
      switcher: { open(): void; close(restore?: boolean): void };
      share: { close(): void };
      overview: { update(data: WorkspaceData): void; clear(): void };
      creation: {
        update(hosts: Host[], allowed: boolean): void;
        open(host: string | null): void;
        close(): void;
        clear(): void;
        setPending(pending: boolean): void;
        message(text: string, problem?: boolean): void;
        readonly command: string;
      };
    };
    KoloController: {
      closeCreate(): void;
      openCreate(host: string | null): void;
      programOf(command: string): string;
      sessionState(agent: Agent | undefined, connected?: boolean): { key: string; label: string };
      focusSession(name: string): void;
      prepareOverlay(): void;
      suspend(): void;
      createSession(event: { preventDefault(): void; target: HTMLFormElement }): Promise<void>;
      kindGlyph(command: string): { viewBox: string; inner: string };
      programKind(command: string): string;
    };
  }
}
