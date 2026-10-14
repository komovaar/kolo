export interface Host { id: string; dirs?: string[] | null; allow?: string[] | null; found?: string[]; error?: string }
export interface CreationState {
  open: boolean; pending: boolean; hosts: Host[]; allowed: boolean;
  host: string; dir: string; command: string; name: string; message: string; problem: boolean;
}

declare global {
  interface Window {
    KoloUI: {
      creation: {
        update(hosts: Host[], allowed: boolean): void;
        open(host: string | null): void;
        close(): void;
        setPending(pending: boolean): void;
        message(text: string, problem?: boolean): void;
        readonly command: string;
      };
    };
    KoloController: {
      closeCreate(): void;
      createSession(event: { preventDefault(): void; target: HTMLFormElement }): Promise<void>;
      kindGlyph(command: string): { viewBox: string; inner: string };
      programKind(command: string): string;
    };
  }
}
