import type { Status } from "../lib/api";

const LABELS: Record<Status, string> = {
  recording: "Recording",
  recorded: "Not transcribed",
  queued: "Queued",
  transcribing: "Transcribing",
  done: "",
  failed: "Failed",
};

export function StatusBadge({ status, progress }: { status: Status; progress?: number }) {
  if (status === "done") return null;
  const alert = status === "recording" || status === "failed";
  return (
    <span className={`chip shrink-0 ${alert ? "border-accent text-accent" : "text-muted"}`}>
      {status === "recording" && <span className="size-1.5 animate-pulse rounded-full bg-accent" />}
      {LABELS[status]}
      {status === "transcribing" && progress !== undefined && <span className="tabular-nums">{Math.round(progress * 100)}%</span>}
    </span>
  );
}
