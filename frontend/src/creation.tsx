import { useSyncExternalStore } from 'react';
import { createStore } from './store';
import { creationReady, reconcileCreation } from './creation-model';
import type { CreationState } from './types';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from './components/ui/dialog';

const initial: CreationState = { open: false, pending: false, allowed: false, hosts: [], host: '', dir: '', command: '', name: '', message: '', problem: false };
const store = createStore(initial);
let opener: HTMLElement | null = null;
function patch(update: Partial<CreationState>) { store.set({ ...store.getSnapshot(), ...update }); }
function restoreFocus() {
  const target = document.querySelector<HTMLElement>('.app')?.hidden ? document.querySelector<HTMLElement>('#signin-token')
    : opener?.isConnected && opener.getClientRects().length ? opener : document.querySelector<HTMLElement>('.brand-home');
  target?.focus({ preventScroll: true });
}

export const creation = {
  update(hosts: CreationState['hosts'], allowed: boolean) {
    const state = store.getSnapshot();
    if (JSON.stringify(state.hosts) === JSON.stringify(hosts) && state.allowed === allowed) return;
    store.set(reconcileCreation(state, hosts, allowed));
  },
  open(host: string | null) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const state = store.getSnapshot();
    store.set({ ...reconcileCreation(state, state.hosts, state.allowed, host), open: true, message: '', problem: false });
  },
  close() { patch({ open: false, name: '', message: '', problem: false }); restoreFocus(); },
  clear() { store.set({ ...initial, pending: store.getSnapshot().pending }); opener = null; },
  setPending(pending: boolean) { patch({ pending }); },
  message(message: string, problem = false) { patch({ message, problem }); },
  get command() { return store.getSnapshot().command; },
};

export function KindIcon({ command }: { command: string }) {
  const mark = window.KoloController?.kindGlyph(command);
  if (!mark) return null;
  return <svg width="20" height="20" viewBox={mark.viewBox} data-agent={command.split(/\s/)[0].toLowerCase()} aria-hidden="true" dangerouslySetInnerHTML={{ __html: mark.inner }} />;
}

export function CreationDialog() {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const host = state.hosts.find((item) => item.id === state.host);
  const anyCommand = !!host?.allow?.includes('*');
  const dirs = host?.dirs?.filter((dir) => dir !== '*') || [];
  const ready = creationReady(state);
  const guidance = !host ? 'No machines connected. Run kolo host on a configured machine.'
    : !host.allow?.length || !host.dirs?.length ? 'This machine must share a program and a directory before you can start a session.' : '';
  return <Dialog open={state.open} onOpenChange={(open) => { if (!open) window.KoloController.closeCreate(); }}>
    <DialogContent open={state.open} onOpenAutoFocus={(event) => {
      event.preventDefault();
      document.querySelector<HTMLElement>('.kind-picker [aria-pressed="true"], #new-command:not([hidden])')?.focus();
    }} onCloseAutoFocus={(event) => {
      event.preventDefault();
      restoreFocus();
    }}>
      <div className="dialog-head">
        <DialogTitle id="create-title">New session</DialogTitle>
        <DialogClose className="icon-btn close" title="Close" aria-label="Close new session dialog"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="m2 2 8 8m0-8-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></DialogClose>
      </div>
      <form className="create" aria-busy={state.pending} onSubmit={(event) => {
        event.preventDefault();
        void window.KoloController.createSession({ preventDefault() {}, target: event.currentTarget });
      }}>
        <fieldset disabled={state.pending} className="dialog-body">
          <DialogDescription className="machine-help">{host ? `Run on ${host.id}.` : 'Connect a machine before starting a session.'}</DialogDescription>
          <div className="field agent-field">
            <label htmlFor="new-command" id="program-label">Program</label>
            <div className="kind-picker" role="group" aria-labelledby="program-label" aria-describedby="command-help" hidden={anyCommand}>
              {(host?.allow || []).map((command) => <button key={command} type="button" className={`kind-choice${command === state.command ? ' on' : ''}`} aria-pressed={command === state.command} onClick={() => patch({ command })}>
                <span className="kind-chip"><KindIcon command={command} /></span><span className="kind-label">{command}</span><span className="kind-type">{window.KoloController?.programKind(command)}</span>
                <svg className="kind-selected" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 8 3 3 7-7" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>)}
            </div>
            <input id="new-command" name="command" list="known-commands" placeholder="e.g. claude or bash" aria-describedby="command-help" hidden={!anyCommand} disabled={!anyCommand} required value={state.command} onChange={(event) => patch({ command: event.target.value })} />
            <datalist id="known-commands">{(host?.found || []).map((command) => <option key={command} value={command} />)}</datalist>
            <p className="field-help" id="command-help">{anyCommand ? 'This machine allows any command. Enter an installed agent, shell, or other program.' : !host?.allow?.length ? 'No programs are shared by this machine yet.' : 'Choose a shared agent or shell.'}</p>
          </div>
          <div className={`field-row${state.hosts.length <= 1 ? ' single' : ''}`}>
            <div className="field host-field" hidden={state.hosts.length <= 1}>
              <label htmlFor="new-host">Machine</label>
              <select id="new-host" name="host" value={state.host} onChange={(event) => store.set(reconcileCreation(state, state.hosts, state.allowed, event.target.value))}>{state.hosts.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}</select>
            </div>
            <div className="field">
              <label htmlFor="directory-input">Directory</label>
              <input id="directory-input" name="dir" aria-label="Directory" list="shared-directories" placeholder="e.g. /home/me/project" required aria-describedby="directory-help" value={state.dir} onChange={(event) => patch({ dir: event.target.value })} />
              <datalist id="shared-directories">{dirs.map((dir) => <option key={dir} value={dir} />)}</datalist>
              <p className="field-help" id="directory-help">{host?.dirs?.includes('*') ? 'Enter a folder path on this machine.' : `Allowed folders: ${dirs.join(', ') || 'none'}.`}</p>
            </div>
          </div>
          <div className="field">
            <label htmlFor="new-name">Session name <span className="field-optional">(optional)</span></label>
            <input id="new-name" name="name" placeholder="Automatic" maxLength={32} pattern="[a-z0-9]([a-z0-9\-]*[a-z0-9])?" aria-describedby="name-help" value={state.name} onChange={(event) => patch({ name: event.target.value })} />
            <p className="field-help" id="name-help">Lowercase letters, numbers, and hyphens.</p>
          </div>
        </fieldset>
        <p className={`note dialog-note${state.problem ? ' problem' : ''}`} role="status">{state.message || guidance}</p>
        <div className="dialog-foot">
          <DialogClose className="go cancel">Cancel</DialogClose>
          <button type="submit" className="go primary" disabled={!ready}><span className="create-label">{state.pending ? 'Starting…' : 'Start session'}</span></button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
