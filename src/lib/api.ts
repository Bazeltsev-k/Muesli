import { invoke } from "@tauri-apps/api/core";

export type Status = "draft" | "recording" | "recorded" | "queued" | "transcribing" | "done" | "failed";

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
  them: string;
  speakers: string[];
};

export type Word = { startMs: number; text: string };
export type Segment = { speaker: number; startMs: number; endMs: number; lang: string; words: Word[] };
export type Note = { id: number; atMs: number; body: string };
export type Comment = { id: number; word: number; end: number; body: string };
export type Tag = { name: string; color: string };

export type Theme = { h: number; c: number; bh: number; bc: number; grain: number; bgrain: number; depth: number; lift: number; mode: "light" | "auto" | "dark" };
export type Folded = { notes: boolean; transcript: boolean };
export type Ui = { theme?: Partial<Theme>; lang?: "en" | "uk" | "ru"; toured?: boolean; layout?: "columns" | "stacked"; folded?: Folded; split?: number };

export type Settings = {
  displayName: string;
  otherName: string;
  theme: string;
  hotkey: string;
  micDevice: string | null;
  captureSystem: boolean;
  languages: string[];
  autoTranscribe: boolean;
  vocabulary: string;
  exportTimestamps: boolean;
  checkUpdates: boolean;
  ui: Ui | null;
  demosSeeded: boolean;
};

export type Permission = "granted" | "denied" | "undetermined" | "unknown";
export type Permissions = { microphone: Permission; systemAudio: Permission };
export type Device = { id: string; name: string };
export type Level = { mic: number; sys: number; ms: number };

export const api = {
  listRecordings: (query: string, tag: string | null) => invoke<Recording[]>("list_recordings", { query, tag }),
  getRecording: (id: number) => invoke<Recording | null>("get_recording", { id }),
  getSegments: (id: number) => invoke<Segment[]>("get_segments", { id }),
  setSegments: (id: number, segments: Segment[]) => invoke<void>("set_segments", { id, segments }),
  setComments: (id: number, comments: Comment[]) => invoke<void>("set_comments", { id, comments }),
  moveBlocks: (id: number, ranges: [number, number][], target: number | null, copy: boolean, atStart: boolean, title: string) => invoke<number>("move_blocks", { id, ranges, target, copy, atStart, title }),
  undoMove: () => invoke<void>("undo_move"),
  listNotes: (id: number) => invoke<Note[]>("list_notes", { id }),
  addNote: (id: number, atMs: number, body: string) => invoke<Note>("add_note", { id, atMs, body }),
  listComments: (id: number) => invoke<Comment[]>("list_comments", { id }),
  addComment: (id: number, word: number, end: number, body: string) => invoke<Comment>("add_comment", { id, word, end, body }),
  deleteComment: (commentId: number) => invoke<void>("delete_comment", { commentId }),
  updateTitle: (id: number, title: string) => invoke<void>("update_title", { id, title }),
  updateNote: (id: number, note: string) => invoke<void>("update_note", { id, note }),
  updateThem: (id: number, them: string) => invoke<void>("update_them", { id, them }),
  setSpeakers: (id: number, speakers: string[]) => invoke<void>("set_speakers", { id, speakers }),
  setLanguages: (id: number, languages: string[]) => invoke<void>("set_languages", { id, languages }),
  setTags: (id: number, tags: string[]) => invoke<void>("set_tags", { id, tags }),
  allTags: () => invoke<Tag[]>("all_tags"),
  setTagColor: (name: string, color: string) => invoke<void>("set_tag_color", { name, color }),
  renameTag: (from: string, to: string) => invoke<void>("rename_tag", { from, to }),
  deleteTag: (name: string) => invoke<void>("delete_tag", { name }),
  deleteRecording: (id: number) => invoke<void>("delete_recording", { id }),
  audioPath: (id: number) => invoke<string>("audio_path", { id }),
  createDraft: () => invoke<number>("create_draft"),
  startRecording: (id: number) => invoke<void>("start_recording", { id }),
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
