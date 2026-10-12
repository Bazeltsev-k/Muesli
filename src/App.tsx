import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { api, type Level, type Settings } from "./lib/api";
import { Ctx, useTauriEvent, type AppContext, type View } from "./lib/context";
import { formatTime } from "./lib/format";
import { Library } from "./views/Library";
import { Detail } from "./views/Detail";
import { SettingsView } from "./views/Settings";

function useTheme(theme: Settings["theme"] | undefined) {
  useEffect(() => {
    if (!theme) return;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    getCurrentWindow().setTheme(theme === "system" ? null : theme).catch(() => {});
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

export default function App() {
  const [view, setView] = useState<View>({ name: "library" });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [level, setLevel] = useState<Level>({ mic: 0, sys: 0, ms: 0 });
  const [paused, setPausedState] = useState(false);
  const [starting, setStarting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);

  useEffect(() => {
    api.getSettings().then(setSettings);
    api.activeRecording().then(setActiveId);
  }, []);
  useTheme(settings?.theme);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const notify = useCallback((message: unknown) => setToast(String(message)), []);

  useEffect(() => {
    if (settings?.checkUpdates) check().then(setUpdate).catch(() => {});
  }, [settings?.checkUpdates]);

  useTauriEvent<number | null>("recorder-state", (id) => {
    setActiveId(id);
    setStarting(false);
    setPausedState(false);
    setLevel({ mic: 0, sys: 0, ms: 0 });
    if (id !== null) setView({ name: "detail", id });
  });
  useTauriEvent<Level>("recorder-level", setLevel);
  useTauriEvent<string>("recorder-error", (message) => {
    setStarting(false);
    notify(message);
  });

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      if (!settings) return;
      const next = { ...settings, ...patch };
      setSettings(next);
      try {
        await api.saveSettings(next);
      } catch (e) {
        setSettings(settings);
        notify(e);
      }
    },
    [settings, notify],
  );

  const ctx = useMemo<AppContext | null>(
    () =>
      settings && {
        settings,
        updateSettings,
        activeId,
        level,
        paused,
        setPaused: (p) => {
          setPausedState(p);
          api.pauseRecording(p);
        },
        go: setView,
        notify,
      },
    [settings, updateSettings, activeId, level, paused, notify],
  );

  if (!ctx) return null;

  const record = () => {
    if (activeId !== null) return api.stopRecording();
    setStarting(true);
    api.startRecording();
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex h-full flex-col">
        <header data-tauri-drag-region className="grid h-[52px] shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b-[1.5px] border-fg bg-side pr-4 pl-[84px]">
          <div data-tauri-drag-region className="flex items-center gap-2.5">
            <span className="grid size-[18px] place-items-center bg-accent">
              <span className="size-[6px] bg-side" />
            </span>
            <span className="text-[15px] font-extrabold tracking-[3px] uppercase">Muesli</span>
          </div>
          <nav className="flex rounded-xs border border-line3">
            {([{ name: "library" }, { name: "settings" }] as const).map((target) => {
              const name = target.name;
              const current = view.name === name || (name === "library" && view.name === "detail");
              return (
                <button
                  key={name}
                  onClick={() => setView(target)}
                  className={`h-8 border-line3 px-4 text-[13.5px] font-semibold capitalize not-last:border-r ${current ? "bg-fg text-bg" : "hover:bg-raised"}`}
                >
                  {name}
                </button>
              );
            })}
          </nav>
          <div className="flex justify-end">
            <button className="btn btn-rec" onClick={record} disabled={starting} title={settings ? `Hotkey: ${settings.hotkey}` : undefined}>
              {activeId !== null ? (
                <>
                  <span className="size-2.5 bg-white" />
                  Stop · <span className="tabular-nums">{formatTime(level.ms)}</span>
                </>
              ) : (
                <>
                  <span className="size-2.5 rounded-full bg-white" />
                  {starting ? "Starting…" : "Record"}
                </>
              )}
            </button>
          </div>
        </header>

        {update && (
          <div className="flex items-center gap-3 border-b border-line bg-panel px-6 py-2 text-[13px]">
            <span className="font-bold">Muesli {update.version} is available.</span>
            <button
              className="btn h-7"
              onClick={async () => {
                try {
                  await update.downloadAndInstall();
                  await relaunch();
                } catch (e) {
                  notify(e);
                }
              }}
            >
              Install and restart
            </button>
            <button className="ml-auto text-muted hover:text-fg" onClick={() => setUpdate(null)}>
              Later
            </button>
          </div>
        )}

        <main data-scroll className="min-h-0 flex-1 overflow-auto">
          {view.name === "library" && <Library />}
          {view.name === "detail" && <Detail key={view.id} id={view.id} />}
          {view.name === "settings" && <SettingsView />}
        </main>

        {toast && (
          <div role="status" className="fixed bottom-5 left-1/2 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-xs bg-fg px-4 py-2.5 font-bold text-bg shadow-lg" onClick={() => setToast(null)}>
            {toast}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
