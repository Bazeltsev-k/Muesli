import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { TOUR } from "../i18n";
import { useApp } from "../lib/app";
import { api, type Device, type Permissions } from "../lib/api";
import { useTauriEvent } from "../lib/util";
import { HomeFab, LangToggles, Row, Seg, Toggle } from "../components/Controls";

export const SECTIONS = ["general", "recording", "transcription", "permissions", "updates"] as const;

const MODIFIERS: ["metaKey" | "ctrlKey" | "altKey" | "shiftKey", string][] = [
  ["metaKey", "CommandOrControl"],
  ["ctrlKey", "Control"],
  ["altKey", "Alt"],
  ["shiftKey", "Shift"],
];

export const prettyHotkey = (h: string) =>
  h
    .split("+")
    .map((k) => ({ CommandOrControl: "⌘", Command: "⌘", Control: "⌃", Shift: "⇧", Alt: "⌥" })[k] ?? k)
    .join("");

function HotkeyInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const { t } = useApp();
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const k = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setListening(false);
      const key = e.code.startsWith("Key") ? e.code.slice(3) : e.code.startsWith("Digit") ? e.code.slice(5) : /^F\d+$/.test(e.code) || e.code === "Space" ? e.code : null;
      const mods = MODIFIERS.filter(([m]) => e[m]).map(([, name]) => name);
      if (key && mods.length > 0) {
        setListening(false);
        onSave([...mods, key].join("+"));
      }
    };
    const cancel = () => setListening(false);
    window.addEventListener("keydown", k, true);
    window.addEventListener("pointerdown", cancel);
    return () => {
      window.removeEventListener("keydown", k, true);
      window.removeEventListener("pointerdown", cancel);
    };
  }, [listening]);
  return (
    <span style={{ display: "flex", gap: 6 }}>
      <button
        className="textin mono"
        style={{ width: 150, textAlign: "center", fontWeight: 600, boxShadow: listening ? "0 0 0 2px var(--accent)" : undefined }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setListening(!listening)}
      >
        {listening ? t.hotkeyPress : value ? prettyHotkey(value) : t.hotkeyNone}
      </button>
      {value && (
        <button className="btn" onClick={() => onSave("")}>
          {t.clear}
        </button>
      )}
    </span>
  );
}

export function SettingsView() {
  const { t, lang, settings, updateSettings, modelReady, setModelReady, perms, refreshPerms, startTour, notify } = useApp();
  const L = t.s;
  const [devices, setDevices] = useState<Device[]>([]);
  const [autostart, setAutostart] = useState(false);
  const [download, setDownload] = useState<[number, number] | null>(null);
  const [version, setVersion] = useState("");
  const [updateState, setUpdateState] = useState<string | null>(null);
  useEffect(() => {
    api.listDevices().then(setDevices).catch(() => {});
    isEnabled().then(setAutostart).catch(() => {});
    getVersion().then(setVersion);
    refreshPerms();
  }, []);
  useTauriEvent<[number, number]>("model-progress", setDownload);

  const startDownload = async () => {
    setDownload([0, 574_041_195]);
    try {
      await api.downloadModel();
      setModelReady(true);
    } catch (e) {
      notify(e);
    }
    setDownload(null);
  };
  const runUpdate = async () => {
    setUpdateState(t.checking);
    try {
      const u = await check();
      if (!u) return setUpdateState(L.upToDate);
      setUpdateState(`${u.version}…`);
      await u.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setUpdateState(null);
      notify(e);
    }
  };
  const permRow = (kind: keyof Permissions, label: string, hint: string) => {
    const p = perms?.[kind];
    return (
      <Row key={kind} label={label} hint={hint}>
        {p === "granted" ? (
          <span className="status ok">● {t.allowed}</span>
        ) : p === "denied" ? (
          <button className="btn" onClick={() => api.openPrivacy(kind).catch(notify)}>
            {t.openSettings}
          </button>
        ) : (
          <button
            className="btn solid"
            onClick={() =>
              api
                .requestPermission(kind)
                .then(refreshPerms)
                .catch(notify)
            }
          >
            {t.allow}
          </button>
        )}
      </Row>
    );
  };

  return (
    <div className="page">
      <div className="toprow">
        <HomeFab />
        <h1 className="title" style={{ fontSize: 30, margin: 0, width: "auto" }}>
          {t.settings}
        </h1>
      </div>
      <div className="set">
        <section id="general">
          <h2>{L.general}</h2>
          <Row label={L.yourName} hint={L.yourNameHint}>
            <input className="textin" defaultValue={settings.displayName} placeholder={t.me} onBlur={(e) => updateSettings({ displayName: e.target.value.trim() })} />
          </Row>
          <Row label={L.defOther} hint={L.defOtherHint}>
            <input className="textin" defaultValue={settings.otherName} placeholder={t.them} onBlur={(e) => updateSettings({ otherName: e.target.value.trim() })} />
          </Row>
          <Row label={L.hotkey} hint={L.hotkeyHint}>
            <HotkeyInput value={settings.hotkey} onSave={(hotkey) => updateSettings({ hotkey })} />
          </Row>
          <Row label={L.layout} hint={L.layoutHint}>
            <Seg
              value={settings.ui?.layout ?? "columns"}
              options={[
                ["columns", L.layoutCols],
                ["stacked", L.layoutStack],
              ]}
              onChange={(layout) => updateSettings({ ui: { ...settings.ui, layout } })}
            />
          </Row>
          <Row label={L.login} hint={L.loginHint}>
            <Toggle on={autostart} set={(on) => (on ? enable() : disable()).then(() => setAutostart(on)).catch(notify)} />
          </Row>
          <Row label={L.dataFolder} hint={L.dataHint}>
            <button className="btn" onClick={() => api.openDataDir().catch(notify)}>
              {L.showFinder}
            </button>
          </Row>
          <Row label={TOUR[lang].row} hint={TOUR[lang].rowHint}>
            <button className="btn solid" onClick={startTour}>
              {TOUR[lang].start}
            </button>
          </Row>
        </section>
        <section id="recording">
          <h2>{L.recording}</h2>
          <Row label={L.mic} hint={L.micHint}>
            <select className="textin" value={settings.micDevice ?? ""} onChange={(e) => updateSettings({ micDevice: e.target.value || null })}>
              <option value="">{L.micDefault}</option>
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Row>
          <Row label={L.sysAudio} hint={L.sysAudioHint}>
            <Toggle on={settings.captureSystem} set={(captureSystem) => updateSettings({ captureSystem })} />
          </Row>
        </section>
        <section id="transcription">
          <h2>{L.transcription}</h2>
          <div id="row-model">
            <Row label="Whisper large-v3-turbo" hint={L.modelHint}>
              {download ? (
                <span style={{ width: 180, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="bar">
                    <i style={{ width: (download[0] / download[1]) * 100 + "%" }} />
                  </span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--muted)", textAlign: "right" }}>
                    {t.downloading} {Math.round(download[0] / 1e6)} / {Math.round(download[1] / 1e6)} MB
                  </span>
                </span>
              ) : modelReady ? (
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="status ok">● {t.installed}</span>
                  <button
                    className="btn"
                    onClick={() =>
                      api
                        .deleteModel()
                        .then(() => setModelReady(false))
                        .catch(notify)
                    }
                  >
                    {t.deleteModel}
                  </button>
                </span>
              ) : (
                <button className="btn solid" onClick={startDownload}>
                  {t.download}
                </button>
              )}
            </Row>
          </div>
          <Row label={L.defLangs} hint={L.defLangsHint}>
            <LangToggles value={settings.languages} onChange={(languages) => updateSettings({ languages })} />
          </Row>
          <Row label={L.autoTr} hint={L.autoTrHint}>
            <Toggle on={settings.autoTranscribe} set={(autoTranscribe) => updateSettings({ autoTranscribe })} />
          </Row>
          <Row label={L.vocab} hint={L.vocabHint}>
            <input className="textin" defaultValue={settings.vocabulary} placeholder="Muesli, Kyiv, OKR" onBlur={(e) => updateSettings({ vocabulary: e.target.value })} />
          </Row>
          <Row label={L.tsExport} hint={L.tsExportHint}>
            <Toggle on={settings.exportTimestamps} set={(exportTimestamps) => updateSettings({ exportTimestamps })} />
          </Row>
        </section>
        <section id="permissions">
          <h2>{L.permissions}</h2>
          {permRow("microphone", L.permMic, L.permMicHint)}
          {permRow("systemAudio", L.permSys, L.permSysHint)}
        </section>
        <section id="updates" style={{ minHeight: "60vh" }}>
          <h2>{L.updates}</h2>
          <Row label={`${L.version.replace(/[\d.]+$/, "")}${version}`} hint={updateState ?? undefined}>
            <button className="btn" onClick={runUpdate}>
              {L.checkNow}
            </button>
          </Row>
          <Row label={L.checkAuto} hint={L.checkAutoHint}>
            <Toggle on={settings.checkUpdates} set={(checkUpdates) => updateSettings({ checkUpdates })} />
          </Row>
        </section>
      </div>
    </div>
  );
}
