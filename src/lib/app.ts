import { createContext, useContext } from "react";
import type { Lang, Strings } from "../i18n";
import type { Level, Permissions, Recording, Settings, Tag, Theme } from "./api";
import type { TagOps } from "../components/Controls";

export type View = { name: "home" } | { name: "rec"; id: number } | { name: "settings" };

export type Playback = { id: number; playing: boolean; rate: number; pinned: boolean };

export type AppCtx = {
  t: Strings;
  lang: Lang;
  setLang: (l: Lang) => void;
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  view: View;
  go: (v: View) => void;
  newRecording: () => void;
  recordings: Recording[];
  query: string;
  setQuery: (q: string) => void;
  tagFilter: string | null;
  setTagFilter: (t: string | null) => void;
  tags: Tag[];
  tagOps: TagOps;
  activeId: number | null;
  level: Level;
  paused: boolean;
  setPaused: (p: boolean) => void;
  stop: () => void;
  progress: Record<number, number>;
  playback: Playback | null;
  time: number;
  play: (id: number) => void;
  toggle: () => void;
  seek: (id: number, ms: number) => void;
  setRate: (r: number) => void;
  modelReady: boolean;
  setModelReady: (v: boolean) => void;
  perms: Permissions | null;
  refreshPerms: () => void;
  startTour: () => void;
  notify: (m: unknown) => void;
  remove: (id: number) => void;
};

export const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => useContext(Ctx)!;
