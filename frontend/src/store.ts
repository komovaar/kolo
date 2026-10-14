import { flushSync } from 'react-dom';

// Only workspace metadata crosses this boundary. Terminal bytes stay in xterm.
export function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next: T) {
      if (next === value) return;
      value = next;
      flushSync(() => listeners.forEach((listener) => listener()));
    },
  };
}
