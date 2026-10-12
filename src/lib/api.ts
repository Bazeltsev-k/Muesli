import { invoke } from "@tauri-apps/api/core";

export type Status = "recording" | "recorded" | "queued" | "transcribing" | "done" | "failed";

export type Recording = {
  id: number;
  title: string;
  createdAt: number;
  durationMs: number;
  status: Status;
  error: string | null;
  note: string;
  tags: string[];
  languages: string[];
};

export type Word = { startMs: number; text: string };

export type Segment = { speaker: number; startMs: number; endMs: number; lang: string; words: Word[] };

export type Note = { id: number; atMs: number; body: string };

export type Settings = {
  displayName: string;
  otherName: string;
  theme: "system" | "light" | "dark";
  hotkey: string;
  micDevice: string | null;
  captureSystem: boolean;
  languages: string[];
  autoTranscribe: boolean;
  vocabulary: string;
  exportTimestamps: boolean;
  checkUpdates: boolean;
};

export type Permission = "granted" | "denied" | "undetermined" | "unknown";
export type Permissions = { microphone: Permission; systemAudio: Permission };
export type Device = { id: string; name: string };
export type Level = { mic: number; sys: number; ms: number };

export const LANGUAGES: Record<string, string> = { en: "English", uk: "Українська", ru: "Русский" };

export const api = {
  listRecordings: (query: string, tag: string | null) => invoke<Recording[]>("list_recordings", { query, tag }),
  getRecording: (id: number) => invoke<Recording | null>("get_recording", { id }),
  getSegments: (id: number) => invoke<Segment[]>("get_segments", { id }),
  listNotes: (id: number) => invoke<Note[]>("list_notes", { id }),
  updateTitle: (id: number, title: string) => invoke<void>("update_title", { id, title }),
  updateNote: (id: number, note: string) => invoke<void>("update_note", { id, note }),
  setTags: (id: number, tags: string[]) => invoke<void>("set_tags", { id, tags }),
  setLanguages: (id: number, languages: string[]) => invoke<void>("set_languages", { id, languages }),
  allTags: () => invoke<string[]>("all_tags"),
  addNote: (id: number, atMs: number, body: string) => invoke<Note>("add_note", { id, atMs, body }),
  deleteNote: (noteId: number) => invoke<void>("delete_note", { noteId }),
  deleteRecording: (id: number) => invoke<void>("delete_recording", { id }),
  audioPath: (id: number) => invoke<string>("audio_path", { id }),
  startRecording: () => invoke<void>("start_recording"),
  stopRecording: () => invoke<void>("stop_recording"),
  pauseRecording: (paused: boolean) => invoke<void>("pause_recording", { paused }),
  activeRecording: () => invoke<number | null>("active_recording"),
  transcribe: (id: number) => invoke<void>("transcribe", { id }),
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<void>("save_settings", { settings }),
  listDevices: () => invoke<Device[]>("list_devices"),
  permissions: () => invoke<Permissions>("permissions"),
  requestPermission: (kind: keyof Permissions) => invoke<Permissions>("request_permission", { kind }),
  openPrivacy: (kind: keyof Permissions) => invoke<void>("open_privacy", { kind }),
  openDataDir: () => invoke<void>("open_data_dir"),
  modelInstalled: () => invoke<boolean>("model_installed"),
  downloadModel: () => invoke<void>("download_model"),
  deleteModel: () => invoke<void>("delete_model"),
  saveText: (path: string, text: string) => invoke<void>("save_text", { path, text }),
};
