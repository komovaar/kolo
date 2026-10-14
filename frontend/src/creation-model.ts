import type { CreationState, Host } from './types';

export function reconcileCreation(state: CreationState, hosts: Host[], allowed: boolean, preferred?: string | null): CreationState {
  if (state.pending) return state;
  const host = hosts.find((item) => item.id === (preferred || state.host)) || hosts[0];
  const changedHost = state.host !== (host?.id || '');
  const anyCommand = host?.allow?.includes('*');
  const command = anyCommand ? (changedHost ? '' : state.command)
    : host?.allow?.includes(state.command) ? state.command : host?.allow?.[0] || '';
  return { ...state, hosts, allowed, host: host?.id || '', command,
    dir: changedHost || !state.dir ? host?.dirs?.find((dir) => dir !== '*') || '' : state.dir };
}

export function creationReady(state: CreationState): boolean {
  const host = state.hosts.find((item) => item.id === state.host);
  return state.allowed && !state.pending && !!host?.allow?.length && !!host?.dirs?.length;
}
