import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { LanguagePicker } from "../components/LanguagePicker";
import { api, type Device, type Permission, type Permissions, type Settings } from "../lib/api";
import { useApp, useTauriEvent } from "../lib/context";
import { prettyHotkey } from "../lib/format";

const TABS = ["General", "Recording", "Transcription", "Permissions", "Updates"] as const;
type Tab = (typeof TABS)[number];

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,300px)] items-center gap-6 border-b border-line px-5 py-4 last:border-0">
      <div className="min-w-0">
        <div className="font-bold">{label}</div>
        {hint && <div className="text-[13px] text-muted">{hint}</div>}
      </div>
      <div className="flex min-w-0 justify-end">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex h-6 w-11 items-center rounded-xs border px-0.5 transition-colors ${checked ? "border-fg bg-fg" : "border-line3 bg-raised"}`}
    >
      <span className={`size-4 rounded-xs transition-transform ${checked ? "translate-x-5 bg-bg" : "bg-line3"}`} />
    </button>
  );
}

function TextSetting({ value, onSave, placeholder }: { value: string; onSave: (v: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="field"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() && text !== value && onSave(text.trim())}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

const MODIFIERS: ["metaKey" | "ctrlKey" | "altKey" | "shiftKey", string][] = [
  ["metaKey", "CommandOrControl"],
  ["ctrlKey", "Control"],
  ["altKey", "Alt"],
  ["shiftKey", "Shift"],
];

function HotkeyInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [listening, setListening] = useState(false);
  return (
    <div className="flex gap-2">
      <button
        className={`field w-40 text-center font-bold ${listening ? "border-accent" : ""}`}
        onClick={() => setListening(true)}
        onBlur={() => setListening(false)}
        onKeyDown={(e) => {
          if (!listening) return;
          e.preventDefault();
          if (e.key === "Escape") return setListening(false);
          const key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : /^F\d+$/.test(e.code) || e.code === "Space" ? e.code : null;
          const mods = MODIFIERS.filter(([k]) => e[k]).map(([, name]) => name);
          if (key && mods.length > 0) {
            setListening(false);
            onSave([...mods, key].join("+"));
          }
        }}
      >
        {listening ? "Press keys…" : value ? prettyHotkey(value) : "None"}
      </button>
      {value && (
        <button className="btn" onClick={() => onSave("")}>
          Clear
        </button>
      )}
    </div>
  );
}

function General() {
  const { settings, updateSettings, notify } = useApp();
  const [autostart, setAutostart] = useState(false);
  useEffect(() => {
    isEnabled().then(setAutostart).catch(() => {});
  }, []);
  return (
    <div className="panel">
      <Row label="Your name" hint="Shown instead of “Me” in transcripts and exports.">
        <TextSetting value={settings.displayName} onSave={(displayName) => updateSettings({ displayName })} />
      </Row>
      <Row label="Other side" hint="Label for everyone heard through your computer's audio.">
        <TextSetting value={settings.otherName} onSave={(otherName) => updateSettings({ otherName })} />
      </Row>
      <Row label="Appearance">
        <div className="flex rounded-xs border border-line3">
          {(["system", "light", "dark"] as const).map((theme) => (
            <button
              key={theme}
              onClick={() => updateSettings({ theme })}
              className={`h-8 border-line3 px-3 text-[13px] font-semibold capitalize not-last:border-r ${settings.theme === theme ? "bg-fg text-bg" : "hover:bg-raised"}`}
            >
              {theme}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Record hotkey" hint="Starts or stops a recording from anywhere.">
        <HotkeyInput value={settings.hotkey} onSave={(hotkey) => updateSettings({ hotkey })} />
      </Row>
      <Row label="Launch at login" hint="Muesli stays in the menu bar, ready to record.">
        <Toggle
          label="Launch at login"
          checked={autostart}
          onChange={(on) =>
            (on ? enable() : disable())
              .then(() => setAutostart(on))
              .catch(notify)
          }
        />
      </Row>
      <Row label="Data folder" hint="Recordings, transcripts and the model live here, on this Mac only.">
        <button className="btn" onClick={() => api.openDataDir().catch(notify)}>
          Show in Finder
        </button>
      </Row>
    </div>
  );
}

function RecordingTab() {
  const { settings, updateSettings, notify } = useApp();
  const [devices, setDevices] = useState<Device[]>([]);
  useEffect(() => {
    api.listDevices().then(setDevices).catch(notify);
  }, [notify]);
  return (
    <div className="panel">
      <Row label="Microphone" hint="Use headphones so your mic doesn't pick up the other side.">
        <select className="field" value={settings.micDevice ?? ""} onChange={(e) => updateSettings({ micDevice: e.target.value || null })}>
          <option value="">System default</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Record computer audio" hint={`Captures ${settings.otherName} from Zoom, Meet, Teams or any other app.`}>
        <Toggle label="Record computer audio" checked={settings.captureSystem} onChange={(captureSystem) => updateSettings({ captureSystem })} />
      </Row>
    </div>
  );
}

function Transcription() {
  const { settings, updateSettings, notify } = useApp();
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [download, setDownload] = useState<[number, number] | null>(null);
  useEffect(() => {
    api.modelInstalled().then(setInstalled);
  }, []);
  useTauriEvent<[number, number]>("model-progress", setDownload);

  const start = async () => {
    setDownload([0, 574_041_195]);
    try {
      await api.downloadModel();
      setInstalled(true);
    } catch (e) {
      notify(e);
    }
    setDownload(null);
  };

  const mb = (n: number) => `${Math.round(n / 1_000_000)} MB`;
  const update = (patch: Partial<Settings>) => updateSettings(patch);

  return (
    <div className="flex flex-col gap-5">
      <div className="panel">
        <Row label="Whisper large-v3-turbo" hint="Runs entirely on this Mac. 574 MB download, about 1 GB of memory while transcribing.">
          {download ? (
            <div className="flex w-full flex-col gap-1.5">
              <div className="h-1.5 bg-raised">
                <div className="h-full bg-accent" style={{ width: `${(download[0] / download[1]) * 100}%` }} />
              </div>
              <span className="text-right text-xs text-muted tabular-nums">
                {mb(download[0])} / {mb(download[1])}
              </span>
            </div>
          ) : installed ? (
            <div className="flex items-center gap-3">
              <span className="chip border-me text-me">Installed</span>
              <button
                className="btn"
                onClick={() =>
                  api
                    .deleteModel()
                    .then(() => setInstalled(false))
                    .catch(notify)
                }
              >
                Delete
              </button>
            </div>
          ) : (
            installed === false && (
              <button className="btn btn-pri" onClick={start}>
                Download
              </button>
            )
          )}
        </Row>
      </div>
      <div className="panel">
        <Row label="Languages" hint="Default for new recordings, changeable per recording. Each utterance is matched to one of them; a single language is fastest.">
          <LanguagePicker value={settings.languages} onChange={(languages) => update({ languages })} />
        </Row>
        <Row label="Transcribe automatically" hint="Start transcribing as soon as a recording stops.">
          <Toggle label="Transcribe automatically" checked={settings.autoTranscribe} onChange={(autoTranscribe) => update({ autoTranscribe })} />
        </Row>
        <Row label="Vocabulary" hint="Names and jargon that should be spelled right, comma separated.">
          <TextSetting value={settings.vocabulary} placeholder="Muesli, Kyiv, OKR" onSave={(vocabulary) => update({ vocabulary })} />
        </Row>
        <Row label="Timestamps in exports" hint="Prefix each turn with its time in exported .txt files.">
          <Toggle label="Timestamps in exports" checked={settings.exportTimestamps} onChange={(exportTimestamps) => update({ exportTimestamps })} />
        </Row>
      </div>
    </div>
  );
}

const PERMISSION_INFO: Record<keyof Permissions, [string, string]> = {
  microphone: ["Microphone", "Records your voice."],
  systemAudio: ["System audio recording", "Records the other participants through your computer's audio."],
};

function PermissionsTab() {
  const { notify } = useApp();
  const [perms, setPerms] = useState<Permissions | null>(null);
  const refresh = useCallback(() => {
    api.permissions().then(setPerms).catch(notify);
  }, [notify]);
  useEffect(() => {
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const badge = (p: Permission) =>
    p === "granted" ? <span className="chip border-me text-me">Granted</span> : p === "denied" ? <span className="chip border-accent text-accent">Denied</span> : <span className="chip text-muted">Not asked</span>;

  return (
    <div className="panel">
      {perms &&
        (Object.keys(PERMISSION_INFO) as (keyof Permissions)[]).map((kind) => (
          <Row key={kind} label={PERMISSION_INFO[kind][0]} hint={PERMISSION_INFO[kind][1]}>
            <div className="flex items-center gap-3">
              {badge(perms[kind])}
              {perms[kind] === "granted" ? null : perms[kind] === "denied" ? (
                <button className="btn" onClick={() => api.openPrivacy(kind).catch(notify)}>
                  Open System Settings
                </button>
              ) : (
                <button
                  className="btn btn-pri"
                  onClick={() =>
                    api
                      .requestPermission(kind)
                      .then(setPerms)
                      .catch(notify)
                  }
                >
                  Allow
                </button>
              )}
            </div>
          </Row>
        ))}
    </div>
  );
}

function Updates() {
  const { settings, updateSettings, notify } = useApp();
  const [version, setVersion] = useState("");
  const [state, setState] = useState<string | null>(null);
  useEffect(() => {
    getVersion().then(setVersion);
  }, []);

  const run = async () => {
    setState("Checking…");
    try {
      const update = await check();
      if (!update) return setState("You're up to date.");
      setState(`Installing ${update.version}…`);
      await update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setState(null);
      notify(e);
    }
  };

  return (
    <div className="panel">
      <Row label="Version" hint={state}>
        <div className="flex items-center gap-3">
          <span className="text-muted tabular-nums">{version}</span>
          <button className="btn" onClick={run}>
            Check for updates
          </button>
        </div>
      </Row>
      <Row label="Check automatically" hint="Look for a new version each time Muesli starts.">
        <Toggle label="Check automatically" checked={settings.checkUpdates} onChange={(checkUpdates) => updateSettings({ checkUpdates })} />
      </Row>
    </div>
  );
}

export function SettingsView() {
  const [tab, setTab] = useState<Tab>("General");
  return (
    <div className="mx-auto grid max-w-[980px] grid-cols-[170px_minmax(0,1fr)] gap-8 px-8 py-9">
      <nav className="flex flex-col gap-0.5">
        <h1 className="mb-4 text-[32px] leading-none font-bold tracking-[-0.8px]">Settings</h1>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`h-[34px] rounded-xs px-2.5 text-left text-[13.5px] font-semibold ${tab === t ? "bg-fg text-bg" : "text-fg2 hover:bg-raised"}`}>
            {t}
          </button>
        ))}
      </nav>
      <div className="pt-12">
        {tab === "General" && <General />}
        {tab === "Recording" && <RecordingTab />}
        {tab === "Transcription" && <Transcription />}
        {tab === "Permissions" && <PermissionsTab />}
        {tab === "Updates" && <Updates />}
      </div>
    </div>
  );
}
