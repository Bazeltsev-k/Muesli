import { useCallback, useEffect, useState } from "react";
import { api, type Recording } from "../lib/api";
import { useApp, useTauriEvent } from "../lib/context";
import { formatDate, formatTime, prettyHotkey } from "../lib/format";
import { StatusBadge } from "../components/StatusBadge";

export function Library() {
  const { go, settings } = useApp();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [items, setItems] = useState<Recording[] | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<number, number>>({});

  const load = useCallback(() => {
    api.listRecordings(query, tag).then(setItems);
    api.allTags().then((all) => {
      setTags(all);
      if (tag && !all.includes(tag)) setTag(null);
    });
  }, [query, tag]);

  useEffect(load, [load]);
  useTauriEvent("recordings-changed", load);
  useTauriEvent<[number, number]>("transcribe-progress", ([id, p]) => setProgress((x) => ({ ...x, [id]: p })));

  return (
    <div className="mx-auto flex max-w-[920px] flex-col gap-5 px-8 py-9">
      <div className="flex items-end gap-4">
        <h1 className="text-[32px] leading-none font-bold tracking-[-0.8px]">Recordings</h1>
        <input className="field ml-auto max-w-[280px]" placeholder="Search titles, transcripts, notes" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {[null, ...tags].map((t) => (
            <button key={t ?? ""} onClick={() => setTag(t)} className={`chip ${tag === t ? "border-fg bg-fg text-bg" : "hover:border-fg hover:bg-raised"}`}>
              {t ?? "All"}
            </button>
          ))}
        </div>
      )}

      {items && items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-[3px] border border-dashed border-line3 px-6 py-16 text-center">
          <p className="text-[15px] font-bold">{query || tag ? "Nothing matches" : "No recordings yet"}</p>
          {!query && !tag && (
            <p className="text-muted">
              Press <b className="text-fg">Record</b> or {prettyHotkey(settings.hotkey)} to capture your next meeting.
            </p>
          )}
        </div>
      ) : (
        <div className="panel">
          {items?.map((r) => (
            <button key={r.id} onClick={() => go({ name: "detail", id: r.id })} className="flex w-full items-center gap-4 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-raised">
              <div className="min-w-0 flex-1">
                <div className="truncate font-bold">{r.title || "Untitled"}</div>
                <div className="text-[13px] text-muted tabular-nums">
                  {formatDate(r.createdAt)} · {formatTime(r.durationMs)}
                </div>
              </div>
              <div className="flex max-w-[40%] flex-wrap justify-end gap-1">
                {r.tags.map((t) => (
                  <span key={t} className="chip text-fg2">
                    {t}
                  </span>
                ))}
              </div>
              <StatusBadge status={r.status} progress={progress[r.id]} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
