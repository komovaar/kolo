import { useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import * as Popover from '@radix-ui/react-popover';
import { createStore } from './store';

const initial = { open: false, url: '', message: '', problem: false, copying: false, generation: 0 };
const store = createStore(initial);
function setOpen(open: boolean) {
  const state = store.getSnapshot();
  store.set({ ...initial, open, url: open ? `${location.origin}/${location.hash}` : '', generation: state.generation + 1 });
}
export const share = { close: () => { if (store.getSnapshot().open) setOpen(false); } };

export function SessionShare() {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const input = useRef<HTMLInputElement>(null);
  async function copy() {
    if (state.copying) return;
    store.set({ ...state, copying: true });
    let problem = false;
    try { await navigator.clipboard.writeText(state.url); } catch { problem = true; }
    const current = store.getSnapshot();
    if (!current.open || current.generation !== state.generation || document.querySelector<HTMLElement>('.app')?.hidden) return;
    store.set({ ...current, copying: false, problem, message: problem ? 'Select the link and copy it manually.' : 'Session link copied.' });
    if (problem) { input.current?.focus(); input.current?.select(); }
  }
  return createPortal(<Popover.Root open={state.open} onOpenChange={setOpen}>
    <div className="session-share">
      <Popover.Trigger className="icon-btn" aria-label="Share session" title="Share session"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 10V2m-3 3 3-3 3 3M3 8v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8" strokeLinecap="round" strokeLinejoin="round" /></svg></Popover.Trigger>
      <Popover.Portal><Popover.Content className="share-panel react-share-panel" align="end" sideOffset={4} collisionPadding={12} aria-label="Share session link" onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); input.current?.select(); }} onCloseAutoFocus={(event) => {
        if (document.querySelector<HTMLElement>('.app')?.hidden) { event.preventDefault(); document.querySelector<HTMLInputElement>('#signin-token')?.focus(); }
      }}>
        <label htmlFor="session-url">Session link</label>
        <div className="share-link-row"><input ref={input} id="session-url" readOnly value={state.url} aria-describedby="share-help" onClick={() => input.current?.select()} /><button className="go secondary share-copy" type="button" disabled={state.copying} aria-busy={state.copying} onClick={() => void copy()}>Copy</button></div>
        <p id="share-help">Workspace members can open this link. New teammates need an invite from the host.</p>
        <p className={`share-feedback${state.problem ? ' problem' : ''}`} role="status">{state.message}</p>
      </Popover.Content></Popover.Portal>
    </div>
  </Popover.Root>, document.querySelector('.share-mount')!);
}
