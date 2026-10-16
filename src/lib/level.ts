import { useSyncExternalStore } from "react";
import type { Level } from "./api";

let current: Level = { mic: 0, sys: 0, ms: 0 };
const subscribers = new Set<() => void>();

export const levelStore = {
  get: () => current,
  set: (l: Level) => {
    current = l;
    subscribers.forEach((f) => f());
  },
  subscribe: (f: () => void) => {
    subscribers.add(f);
    return () => {
      subscribers.delete(f);
    };
  },
};

export const useLevel = <T,>(pick: (l: Level) => T) => useSyncExternalStore(levelStore.subscribe, () => pick(current));
