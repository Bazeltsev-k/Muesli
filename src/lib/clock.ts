import { useSyncExternalStore } from "react";

let current = { id: -1, ms: 0 };
const subscribers = new Set<() => void>();

export const clock = {
  get: () => current,
  set: (id: number, ms: number) => {
    if (current.id === id && current.ms === ms) return;
    current = { id, ms };
    subscribers.forEach((f) => f());
  },
  subscribe: (f: () => void) => {
    subscribers.add(f);
    return () => {
      subscribers.delete(f);
    };
  },
};

export const useClock = <T,>(id: number, pick: (ms: number) => T) => useSyncExternalStore(clock.subscribe, () => pick(current.id === id ? current.ms : 0));
