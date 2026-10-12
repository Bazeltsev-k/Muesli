import { createContext, useContext, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Level, Settings } from "./api";

export type View = { name: "library" } | { name: "detail"; id: number } | { name: "settings" };

export type AppContext = {
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  activeId: number | null;
  level: Level;
  paused: boolean;
  setPaused: (paused: boolean) => void;
  go: (view: View) => void;
  notify: (message: unknown) => void;
};

export const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  return useContext(Ctx)!;
}

export function useTauriEvent<T>(name: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const unlisten = listen<T>(name, (e) => ref.current(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, [name]);
}
