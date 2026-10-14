import type { WorkspaceRuntime, TerminalView, Control } from '../core/runtime.ts';
import { hostReplies } from '../terminal/queries';

declare global {
  interface Window {
    Terminal: new (options: Record<string, unknown>) => TerminalView;
    CanvasAddon: { CanvasAddon: new () => unknown };
  }
}

export function browserRuntime(): WorkspaceRuntime {
  // State and operations are installed synchronously before startup callbacks.
  // Browser methods need their native receiver when called through the runtime.
  const runtime: Partial<WorkspaceRuntime> = {
    window, document, location, crypto, FormData,
    localStorage: { getItem: (key: string) => window.localStorage.getItem(key), setItem: (key: string, value: string) => window.localStorage.setItem(key, value) },
    fetch: window.fetch.bind(window), confirm: window.confirm.bind(window), alert: window.alert.bind(window),
    WebSocket, BroadcastChannel: window.BroadcastChannel, ResizeObserver, MutationObserver,
    addEventListener: window.addEventListener.bind(window), matchMedia: window.matchMedia.bind(window),
    setTimeout: window.setTimeout.bind(window), clearTimeout: window.clearTimeout.bind(window),
    get innerHeight() { return window.innerHeight; },
    Terminal: window.Terminal, CanvasAddon: window.CanvasAddon,
    KoloTerminalQueries: { hostReplies },
    el(selector: string) {
      const element = document.querySelector<Control>(selector);
      return element!;
    },
  };
  return runtime as WorkspaceRuntime;
}
