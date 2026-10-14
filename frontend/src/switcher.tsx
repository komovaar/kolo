import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { createStore } from './store';
import { workspaceStore } from './overview';
import { KindIcon } from './creation';
import { Dialog, DialogContent, DialogTitle, DialogClose } from './components/ui/dialog';
import { Command, CommandInput, CommandList, CommandItem } from './components/ui/command';

const store = createStore({ open: false, generation: 0 });
let opener: HTMLElement | null = null;
let shouldRestore = true;
function restoreFocus() {
  if (!shouldRestore || document.querySelector<HTMLElement>('.app')?.hidden) return;
  const fallback = matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px)').matches ? '.mobile-switch' : '.switch-open';
  (opener?.isConnected && opener.getClientRects().length ? opener : document.querySelector<HTMLElement>(fallback))?.focus({ preventScroll: true });
}
export const switcher = {
  open() {
    if (document.querySelector<HTMLElement>('.app')?.hidden || !document.querySelector<HTMLElement>('.scrim')?.hidden) return;
    opener = document.activeElement as HTMLElement | null;
    shouldRestore = true;
    window.KoloController.prepareOverlay();
    store.set({ open: true, generation: store.getSnapshot().generation + 1 });
    document.querySelector<HTMLElement>('.app')!.inert = true;
  },
  close(restore = true) {
    shouldRestore = restore;
    document.querySelector<HTMLElement>('.app')!.inert = !document.querySelector<HTMLElement>('.scrim')?.hidden;
    store.set({ ...store.getSnapshot(), open: false });
    restoreFocus();
  },
};

function PromptIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 4 3 3-3 3M8 11h5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ActionIcon({ action }: { action: string }) {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    {action === 'new' ? <path d="M8 3v10M3 8h10" strokeLinecap="round" />
      : action === 'activity' ? <path d="M3 4h10M3 8h10M3 12h6" strokeLinecap="round" />
      : <><rect x="2" y="2" width="12" height="12" rx="2" /><path d="M2 6h12M6 6v8" /></>}
  </svg>;
}

export function SessionSwitcher() {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const data = useSyncExternalStore(workspaceStore.subscribe, workspaceStore.getSnapshot);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const current = location.hash.match(/^#\/agent\/([a-z0-9-]+)$/)?.[1];
  const filter = query.trim().toLocaleLowerCase();
  const agents = data.agents.filter((agent) => [agent.name, agent.label, agent.title, agent.host, agent.command, agent.dir].some((value) => String(value || '').toLocaleLowerCase().includes(filter)));
  const actions = [
    { key: 'overview', label: 'Open workspace overview', run: () => { location.hash = ''; requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.session-query')?.focus()); } },
    { key: 'activity', label: 'Open activity log', run: () => { location.hash = '#/log'; requestAnimationFrame(() => { const title = document.querySelector<HTMLElement>(matchMedia('(max-width: 760px)').matches ? '.mobile-title' : '.log-head h2'); if (title) { title.tabIndex = -1; title.focus(); } }); } },
  ];
  if (data.allowed && data.hosts.some((host) => host.allow?.length && host.dirs?.length)) actions.unshift({ key: 'new', label: 'New session', run: () => {
    document.querySelector<HTMLElement>(matchMedia('(max-width: 760px), (max-width: 1000px) and (max-height: 500px)').matches ? '.mobile-menu' : '.side-new')?.focus();
    window.KoloController.openCreate(null);
  } });
  const matches = actions.filter((action) => action.label.toLocaleLowerCase().includes(filter));
  useEffect(() => { setQuery(''); setSelected(''); }, [state.generation]);
  useEffect(() => {
    const apple = /Mac|iPhone|iPad/.test(navigator.platform);
    const shortcut = apple ? '⌘⇧Space' : 'Ctrl⇧Space';
    const trigger = document.querySelector<HTMLButtonElement>('.switch-open')!;
    trigger.title = `Switch session (${shortcut})`;
    trigger.setAttribute('aria-keyshortcuts', apple ? 'Meta+Shift+Space' : 'Control+Shift+Space');
    trigger.onclick = () => switcher.open();
    document.querySelector('.switch-shortcut')!.textContent = shortcut;
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && !event.isComposing && event.code === 'Space') {
        if (document.querySelector<HTMLElement>('.app')?.hidden || !document.querySelector<HTMLElement>('.scrim')?.hidden) return;
        event.preventDefault(); event.stopPropagation();
        store.getSnapshot().open ? switcher.close() : switcher.open();
      }
    };
    addEventListener('keydown', handleKey, true);
    return () => { removeEventListener('keydown', handleKey, true); trigger.onclick = null; };
  }, []);
  function activate(run: () => void) { switcher.close(false); run(); }
  return <>
    {createPortal(<button type="button" className="icon-btn mobile-switch" aria-label="Switch session" aria-haspopup="dialog" onClick={() => switcher.open()}><PromptIcon /></button>, document.querySelector('.mobile-nav')!)}
    <Dialog open={state.open} onOpenChange={(open) => { if (!open) switcher.close(); }}>
      <DialogContent open={state.open} frameClassName="switch-scrim" className="switch-dialog" aria-describedby={undefined} onOpenAutoFocus={(event) => { event.preventDefault(); input.current?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); restoreFocus(); }}>
        <Command loop shouldFilter={false} value={selected} onValueChange={setSelected}>
          <div className="switch-head"><DialogTitle id="switch-title">Switch session</DialogTitle><DialogClose className="icon-btn switch-close" aria-label="Close session switcher"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" strokeLinecap="round" /></svg></DialogClose></div>
          <div className="switch-search"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" strokeLinecap="round" /></svg><CommandInput ref={input} className="switch-query" aria-label="Find a session or action" placeholder="Search sessions or actions…" autoComplete="off" spellCheck={false} value={query} onValueChange={(value) => { setQuery(value); setSelected(''); }} /></div>
          <CommandList className="switch-results" aria-label="Sessions and actions">
            {agents.map((agent) => {
              const status = window.KoloController.sessionState(agent, data.hosts.some((host) => host.id === agent.host));
              return <CommandItem key={agent.name} value={`session:${agent.name}`} className="switch-option" onSelect={() => activate(() => window.KoloController.focusSession(agent.name))}>
                <span className="kind-chip"><KindIcon command={agent.command} /></span><span className="switch-copy"><span className="switch-name">{agent.label || agent.title || agent.name}</span><span className="switch-meta">{agent.host} · {window.KoloController.programOf(agent.command)} · {agent.dir}</span></span><span className="overview-state" data-state={status.key}>{status.key === 'unknown' ? 'Activity unknown' : status.label}</span>{agent.name === current && <span className="switch-current">Current</span>}
              </CommandItem>;
            })}
            {matches.map((action) => <CommandItem key={action.key} value={`action:${action.key}`} className="switch-option switch-action" onSelect={() => activate(action.run)}><span className="kind-chip"><ActionIcon action={action.key} /></span><span className="switch-copy"><span className="switch-name">{action.label}</span></span></CommandItem>)}
          </CommandList>
          <p className="switch-empty" role="status" hidden={!!(agents.length || matches.length)}>No matches. Try a name, program, machine, or directory.</p>
          <div className="switch-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>
        </Command>
      </DialogContent>
    </Dialog>
  </>;
}
