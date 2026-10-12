import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { T, TOUR_STEPS, type Lang } from "./i18n";
import { api, type Level, type Permissions, type Recording, type Settings, type Tag, type Theme } from "./lib/api";
import { Ctx, type AppCtx, type Playback, type View } from "./lib/app";
import { useTauriEvent } from "./lib/util";
import { Icon, type TagOps } from "./components/Controls";
import { Picker } from "./components/Picker";
import { Pip, PlayPip } from "./components/Floating";
import { Tour } from "./components/Tour";
import { Home, Notch, RecMeta, TagFilters, groupByDay } from "./views/Home";
import { RecordingView } from "./views/Recording";
import { SECTIONS, SettingsView } from "./views/Settings";

const DEFAULT_THEME: Theme = { h: 8, c: 62, bh: 8, bc: 30, grain: 0.5, bgrain: 0.3, depth: 0.25, lift: 0.1, mode: "auto" };

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    api.getSettings().then(setSettings);
  }, []);
  if (!settings) return null;
  return <Shell initial={settings} />;
}

function Shell({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState(initial);
  const [view, setView] = useState<View>({ name: "home" });
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [level, setLevel] = useState<Level>({ mic: 0, sys: 0, ms: 0 });
  const [paused, setPausedState] = useState(false);
  const [progress, setProgress] = useState<Record<number, number>>({});
  const [playback, setPlayback] = useState<Playback | null>(null);
  const [time, setTime] = useState(0);
  const [modelReady, setModelReady] = useState(false);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [picker, setPicker] = useState<DOMRect | null>(null);
  const [tour, setTour] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [update, setUpdate] = useState<Update | null>(null);
  const [section, setSection] = useState<string>("general");
  const audio = useRef<HTMLAudioElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const saveTimer = useRef<number>(undefined);

  const lang: Lang = settings.ui?.lang ?? "en";
  const t = T[lang];
  const theme: Theme = { ...DEFAULT_THEME, ...settings.ui?.theme };

  const notify = useCallback((m: unknown) => {
    setToast(String(m));
    window.setTimeout(() => setToast(null), 3000);
  }, []);

  const persist = (next: Settings, delay = 0) => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => api.saveSettings(next).catch(notify), delay);
  };
  const updateSettings = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    if (patch.hotkey !== undefined)
      api.saveSettings(next).catch((e) => {
        setSettings(settings);
        notify(e);
      });
    else persist(next);
  };
  const updateUi = (patch: NonNullable<Settings["ui"]>, delay = 0) => {
    setSettings((s) => {
      const next = { ...s, ui: { ...s.ui, ...patch } };
      persist(next, delay);
      return next;
    });
  };
  const setTheme = (th: Theme) => updateUi({ theme: th }, 400);
  const setLang = (l: Lang) => updateUi({ lang: l });

  useEffect(() => {
    const r = document.documentElement;
    r.style.setProperty("--h", String(theme.h));
    r.style.setProperty("--c", String(theme.c));
    r.style.setProperty("--bh", String(theme.bh));
    r.style.setProperty("--bc", String(theme.bc));
    r.style.setProperty("--grain", String(theme.grain));
    r.style.setProperty("--bgrain", String(theme.bgrain));
    r.style.setProperty("--depth", String(theme.depth));
    r.style.setProperty("--lift", String(theme.lift));
    if (theme.mode === "auto") r.removeAttribute("data-theme");
    else r.setAttribute("data-theme", theme.mode);
    r.lang = lang;
    getCurrentWindow()
      .setTheme(theme.mode === "auto" ? null : theme.mode)
      .catch(() => {});
  }, [JSON.stringify(theme), lang]);

  const loadList = useCallback(() => {
    api.listRecordings(query, tagFilter).then(setRecordings).catch(notify);
    api.allTags().then(setTags).catch(notify);
  }, [query, tagFilter]);
  useEffect(loadList, [loadList]);
  const refreshPerms = useCallback(() => {
    api.permissions().then(setPerms).catch(() => {});
  }, []);
  useEffect(() => {
    api.activeRecording().then(setActiveId);
    api.modelInstalled().then(setModelReady);
    refreshPerms();
    if (settings.checkUpdates) check().then(setUpdate).catch(() => {});
    if (!settings.ui?.toured) {
      const id = window.setTimeout(() => setTour(0), 700);
      return () => window.clearTimeout(id);
    }
  }, []);

  const go = (v: View) => {
    if (playback?.playing && !(v.name === "rec" && v.id === playback.id)) setPlayback((p) => p && { ...p, pinned: true });
    setView(v);
    setPicker(null);
  };
  const newRecording = () =>
    api
      .createDraft()
      .then((id) => go({ name: "rec", id }))
      .catch(notify);

  useTauriEvent("recordings-changed", loadList);
  useTauriEvent<number | null>("recorder-state", (id) => {
    setActiveId(id);
    setPausedState(false);
    setLevel({ mic: 0, sys: 0, ms: 0 });
  });
  useTauriEvent<Level>("recorder-level", setLevel);
  useTauriEvent<string>("recorder-error", notify);
  useTauriEvent<[number, number]>("transcribe-progress", ([id, p]) => setProgress((x) => ({ ...x, [id]: p })));
  useTauriEvent("open-draft", newRecording);

  const tagOps: TagOps = {
    recolor: (name, color) => api.setTagColor(name, color).catch(notify),
    rename: (from, to) =>
      api
        .renameTag(from, to)
        .then(() => tagFilter === from && setTagFilter(to))
        .catch(notify),
    remove: (name) =>
      api
        .deleteTag(name)
        .then(() => tagFilter === name && setTagFilter(null))
        .catch(notify),
  };

  const loadSource = async (id: number) => {
    const el = audio.current!;
    if (playback?.id === id && el.src) return el;
    const path = await api.audioPath(id);
    el.src = convertFileSrc(path);
    el.playbackRate = playback?.rate ?? 1;
    setPlayback({ id, playing: false, rate: playback?.rate ?? 1, pinned: false });
    setTime(0);
    return el;
  };
  const play = async (id: number) => {
    const el = await loadSource(id);
    await el.play().catch(notify);
  };
  const toggle = () => {
    const el = audio.current!;
    if (el.paused) el.play().catch(notify);
    else el.pause();
  };
  const seek = async (id: number, ms: number) => {
    const el = await loadSource(id);
    const apply = () => {
      el.currentTime = ms / 1000;
      setTime(ms);
    };
    if (el.readyState >= 1) apply();
    else el.addEventListener("loadedmetadata", apply, { once: true });
  };
  const setRate = (r: number) => {
    if (audio.current) audio.current.playbackRate = r;
    setPlayback((p) => p && { ...p, rate: r });
  };
  useEffect(() => {
    if (!playback?.playing) return;
    const id = window.setInterval(() => setTime((audio.current?.currentTime ?? 0) * 1000), 80);
    return () => window.clearInterval(id);
  }, [playback?.playing]);

  const remove = (id: number) => {
    if (playback?.id === id) {
      audio.current?.pause();
      setPlayback(null);
    }
    api
      .deleteRecording(id)
      .then(() => {
        if (view.name === "rec" && view.id === id) setView({ name: "home" });
        notify(t.deleted);
      })
      .catch(notify);
  };

  const setPaused = (p: boolean) => {
    setPausedState(p);
    api.pauseRecording(p);
  };
  const stop = () => api.stopRecording().catch(notify);

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [view]);
  useEffect(() => {
    if (view.name !== "settings") return;
    const el = mainRef.current;
    if (!el) return;
    const spy = () => {
      const top = el.getBoundingClientRect().top;
      let cur: string = SECTIONS[0];
      for (const id of SECTIONS) {
        const s = document.getElementById(id);
        if (s && s.getBoundingClientRect().top - top < 120) cur = id;
      }
      setSection(cur);
    };
    el.addEventListener("scroll", spy);
    spy();
    return () => el.removeEventListener("scroll", spy);
  }, [view.name]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || tour !== null || picker || view.name === "home") return;
      if ((e.target as HTMLElement).closest?.("input, textarea, .pop, .composer")) return;
      go({ name: "home" });
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const tourTarget = recordings.find((r) => r.title.startsWith("Demo: weekly")) ?? recordings.find((r) => r.status === "done");
  useEffect(() => {
    if (tour === null) return;
    const st = TOUR_STEPS[tour];
    setPicker(null);
    if (st.view === "rec") {
      if (tourTarget) setView({ name: "rec", id: tourTarget.id });
      else setTour(tour + 1 < TOUR_STEPS.length ? tour + 1 : null);
    } else setView(st.view === "home" ? { name: "home" } : { name: "settings" });
    if (st.action === "perms") refreshPerms();
  }, [tour]);
  useEffect(() => {
    if (tour === null || TOUR_STEPS[tour].action !== "perms") return;
    const id = window.setInterval(refreshPerms, 1500);
    return () => window.clearInterval(id);
  }, [tour]);
  const endTour = () => {
    setTour(null);
    updateUi({ toured: true });
  };

  const ctx: AppCtx = {
    t,
    lang,
    setLang,
    settings,
    updateSettings,
    theme,
    setTheme,
    view,
    go,
    newRecording,
    recordings,
    query,
    setQuery,
    tagFilter,
    setTagFilter,
    tags,
    tagOps,
    activeId,
    level,
    paused,
    setPaused,
    stop,
    progress,
    playback,
    time,
    play,
    toggle,
    seek,
    setRate,
    modelReady,
    setModelReady,
    perms,
    refreshPerms,
    startTour: () => setTour(0),
    notify,
    remove,
  };

  const liveRec = recordings.find((r) => r.id === activeId);
  const onLivePage = activeId !== null && view.name === "rec" && view.id === activeId;
  const playRec = playback && recordings.find((r) => r.id === playback.id);
  const groups = useMemo(() => groupByDay(recordings, [t.today, t.yesterday, t.earlier]), [recordings, lang]);

  const footer = (
    <>
      <button className="iconbtn" aria-pressed={view.name === "settings"} title={t.settings} onClick={() => go({ name: "settings" })}>
        {Icon.gear}
      </button>
      <button className="iconbtn" aria-pressed={!!picker} title={t.appearance} onClick={(e) => setPicker(picker ? null : e.currentTarget.getBoundingClientRect())}>
        {Icon.palette}
      </button>
      <div className="uilang">
        {(["en", "uk", "ru"] as const).map((l) => (
          <button key={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <Ctx.Provider value={ctx}>
      <div className={"app" + (view.name === "home" ? " home" : "")}>
        {view.name !== "home" && (
          <aside className="side">
            <div className="dragbar" data-tauri-drag-region />
            {view.name === "settings" ? (
              <nav className="toc">
                {SECTIONS.map((id) => (
                  <a
                    key={id}
                    href={"#" + id}
                    aria-current={section === id}
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                      setSection(id);
                    }}
                  >
                    {t.s[id]}
                  </a>
                ))}
              </nav>
            ) : (
              <>
                <button className="newrec" onClick={newRecording}>
                  <i className="dot" />
                  {t.newRec}
                  <span className="kbd">⌃⌥R</span>
                </button>
                <label className="search">
                  {Icon.search}
                  <input placeholder={t.search} value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <TagFilters />
                <div className="list">
                  {groups.map(
                    ([label, items]) =>
                      items.length > 0 && (
                        <div key={label} style={{ display: "contents" }}>
                          <div className="group">{label}</div>
                          {items.map((r) => (
                            <button key={r.id} className="item" aria-current={view.name === "rec" && view.id === r.id} onClick={() => go({ name: "rec", id: r.id })}>
                              <Notch tags={r.tags} />
                              <span className="t">{r.title || t.untitled}</span>
                              <RecMeta r={r} />
                            </button>
                          ))}
                        </div>
                      ),
                  )}
                </div>
              </>
            )}
            <div className="sidefoot">{footer}</div>
          </aside>
        )}
        <main className="main" ref={mainRef}>
          {view.name !== "home" && (
            <div className="homefab">
              <button onClick={() => go({ name: "home" })} title={t.home} aria-label={t.home}>
                ←
              </button>
            </div>
          )}
          {update && view.name === "home" && (
            <div className="updatebar">
              <b>Muesli {update.version}</b> {t.updateAvailable}
              <button
                className="btn solid"
                onClick={() =>
                  update
                    .downloadAndInstall()
                    .then(relaunch)
                    .catch(notify)
                }
              >
                {t.installUpdate}
              </button>
              <button className="btn" onClick={() => setUpdate(null)}>
                {t.later}
              </button>
            </div>
          )}
          {view.name === "home" && <Home footer={footer} />}
          {view.name === "rec" && <RecordingView key={view.id} id={view.id} />}
          {view.name === "settings" && <SettingsView />}
        </main>
      </div>
      <audio
        ref={audio}
        preload="metadata"
        onPlay={() => setPlayback((p) => p && { ...p, playing: true })}
        onPause={() => {
          setPlayback((p) => p && { ...p, playing: false });
          setTime((audio.current?.currentTime ?? 0) * 1000);
        }}
        onSeeked={() => setTime((audio.current?.currentTime ?? 0) * 1000)}
      />
      {liveRec && !onLivePage && (
        <Pip
          t={t}
          title={liveRec.title}
          them={liveRec.them}
          level={level}
          paused={paused}
          setPaused={setPaused}
          onStop={stop}
          onOpen={() => go({ name: "rec", id: liveRec.id })}
          onMark={(body) => api.addNote(liveRec.id, level.ms, body).catch(notify)}
        />
      )}
      {playRec && playback.pinned && !(view.name === "rec" && view.id === playback.id) && (
        <PlayPip
          t={t}
          title={playRec.title}
          them={playRec.them}
          duration={playRec.durationMs}
          time={time}
          playing={playback.playing}
          stacked={!!liveRec && !onLivePage}
          onToggle={toggle}
          onSeek={(ms) => seek(playRec.id, ms)}
          onOpen={() => go({ name: "rec", id: playRec.id })}
          onClose={() => {
            audio.current?.pause();
            setPlayback(null);
          }}
        />
      )}
      {picker && <Picker t={t} theme={theme} setTheme={setTheme} anchor={picker} sideHidden={view.name === "home"} onClose={() => setPicker(null)} />}
      {tour !== null && (
        <Tour lang={lang} setLang={setLang} step={tour} setStep={setTour} onEnd={endTour} actionDone={(a) => (a === "model" ? modelReady : perms?.microphone === "granted" && perms?.systemAudio === "granted")} />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </Ctx.Provider>
  );
}
