import type { WorkspaceRuntime, TerminalView } from '../core/runtime.ts';

// Clipboard contents belong to this browser. OSC 52 reads are deliberately
// consumed without replying: pasting is a local browser action.
export function installClipboard(runtime: WorkspaceRuntime, term: TerminalView) {
  const current = () => runtime.term === term && runtime.signedIn;
  const copy = async (text: string) => {
    const owner = runtime.socket;
    const active = () => current() && runtime.socket === owner;
    try {
      await runtime.window.navigator.clipboard.writeText(text);
    } catch (_) {
      if (!active()) return;
      // HTTP origins and denied clipboard permissions still have a selectable
      // copy surface. Keep private text inside this terminal's lifetime.
      const dialog = runtime.document.createElement('dialog');
      dialog.className = 'terminal-clipboard';
      dialog.setAttribute('aria-label', 'Copy terminal text');
      const label = runtime.document.createElement('p');
      label.textContent = 'Copy this text with your browser’s Copy action.';
      const field = runtime.document.createElement('textarea');
      field.setAttribute('aria-label', 'Text to copy');
      field.readOnly = true;
      field.value = text;
      const close = runtime.document.createElement('button');
      close.type = 'button';
      close.textContent = 'Done';
      close.onclick = () => dialog.close();
      dialog.append(label, field, close);
      term.element.append(dialog);
      dialog.addEventListener('close', () => { dialog.remove(); if (active()) term.focus(); });
      dialog.showModal();
      field.focus();
      field.select();
    }
  };

  term.attachCustomKeyEventHandler((event) => {
    if (!current() || event.type !== 'keydown' || event.altKey) return true;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && term.hasSelection()) {
      event.preventDefault();
      void copy(term.getSelection());
      return false;
    }
    // Let the browser dispatch a native paste event. xterm reads that local
    // event and applies the running app's bracketed-paste mode.
    if ((event.ctrlKey && event.shiftKey || event.metaKey) && event.key.toLowerCase() === 'v') return false;
    return true;
  });

  term.parser.registerOscHandler(52, (data) => {
    if (!current() || !runtime.screenReady || !runtime.viewerID || runtime.clipboardViewer !== runtime.viewerID) return true;
    const split = data.indexOf(';');
    if (split < 0 || !['', 'c', 's', 'p', 'pc'].includes(data.slice(0, split))) return true;
    const encoded = data.slice(split + 1);
    if (encoded === '?' || encoded.length > 1048576) return true;
    try {
      const bytes = Uint8Array.from(runtime.window.atob(encoded), (c) => c.charCodeAt(0));
      void copy(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch (_) { /* Ignore malformed application clipboard output. */ }
    return true;
  });
}
