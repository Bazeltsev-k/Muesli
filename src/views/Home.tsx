import { useState } from "react";
import { useApp } from "../lib/app";
import type { Recording } from "../lib/api";
import { api } from "../lib/api";
import { fmt, fmtDate } from "../lib/util";
import { HoldDelete, Icon, TagPicker } from "../components/Controls";
import { prettyHotkey } from "./Settings";

export function TagFilters() {
  const { t, tags, tagFilter, setTagFilter } = useApp();
  return (
    <div className="tagrow">
      <button className="tagf" aria-pressed={!tagFilter} onClick={() => setTagFilter(null)}>
        {t.all}
      </button>
      {tags.map((x) => (
        <button key={x.name} className="tagf" aria-pressed={tagFilter === x.name} onClick={() => setTagFilter(tagFilter === x.name ? null : x.name)}>
          <i className="tdot" style={{ background: x.color }} />
          {x.name}
        </button>
      ))}
    </div>
  );
}

export function groupByDay<T extends Recording>(list: T[], labels: [string, string, string]) {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const startOfYesterday = startOfToday - 86_400_000;
  return [
    [labels[0], list.filter((r) => r.createdAt >= startOfToday)],
    [labels[1], list.filter((r) => r.createdAt >= startOfYesterday && r.createdAt < startOfToday)],
    [labels[2], list.filter((r) => r.createdAt < startOfYesterday)],
  ] as const;
}

export function Notch({ tags }: { tags: string[] }) {
  const { tags: all } = useApp();
  if (!tags.length) return null;
  return (
    <span className="notch">
      {tags.map((n) => (
        <i key={n} style={{ background: all.find((x) => x.name === n)?.color ?? "#8D8D86" }} />
      ))}
    </span>
  );
}

export function RecMeta({ r, withDate }: { r: Recording; withDate?: boolean }) {
  const { t, lang, progress, activeId } = useApp();
  return (
    <span className="m">
      {r.status === "recording" || r.id === activeId ? (
        <>
          <i className="live-dot" />
          {t.recording}
        </>
      ) : r.status === "draft" ? (
        <span>{t.newRec}</span>
      ) : (
        <span className="mono">{fmt(r.durationMs)}</span>
      )}
      {r.them && <span>· {r.them}</span>}
      {r.status === "transcribing" && (
        <span style={{ color: "var(--accent)" }}>
          · {t.transcribing} {Math.round((progress[r.id] ?? 0) * 100)}%
        </span>
      )}
      {r.status === "queued" && <span style={{ color: "var(--accent)" }}>· {t.queued}</span>}
      {r.status === "failed" && <span style={{ color: "var(--rec)" }}>· {t.failed}</span>}
      {withDate && <span>· {fmtDate(r.createdAt, lang)}</span>}
    </span>
  );
}

function HomeRow({ r }: { r: Recording }) {
  const { t, go, tags, tagOps, notify, remove, activeId } = useApp();
  const [renaming, setRenaming] = useState(false);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="hrow" role="button" tabIndex={0} onClick={() => !renaming && go({ name: "rec", id: r.id })} onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && go({ name: "rec", id: r.id })}>
      <Notch tags={r.tags} />
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
        {renaming ? (
          <input
            className="rename"
            autoFocus
            defaultValue={r.title}
            placeholder={t.untitled}
            onClick={stop}
            onBlur={(e) => {
              api.updateTitle(r.id, e.target.value.trim()).catch(notify);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <span
            className="t editable"
            title={t.rename}
            onClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
          >
            {r.title || t.untitled}
          </span>
        )}
        <RecMeta r={r} withDate />
      </span>
      <span onClick={stop}>
        <TagPicker t={t} tags={r.tags} allTags={tags} onChange={(next) => api.setTags(r.id, next).catch(notify)} tagOps={tagOps} compact />
      </span>
      <span className="acts" onClick={stop}>
        {r.id !== activeId && <HoldDelete t={t} onConfirm={() => remove(r.id)} />}
      </span>
    </div>
  );
}

export function Home({ footer }: { footer: React.ReactNode }) {
  const { t, recordings, query, setQuery, newRecording, settings } = useApp();
  return (
    <>
    <div className="homewrap">
      <div className="homebar" data-tauri-drag-region>
        <span className="brand" data-tauri-drag-region>
          <i />
          Muesli
        </span>
      </div>
      <div className="hero">
        <div>
          <h1>{t.greet}</h1>
          <p>
            {recordings.length} {t.recordings} · {t.greetSub}
          </p>
        </div>
        <button className="bigrec" onClick={newRecording}>
          <i />
          {t.newRec}
          {settings.hotkey && (
            <span className="kbd" style={{ color: "#fff", opacity: 0.7 }}>
              {prettyHotkey(settings.hotkey)}
            </span>
          )}
        </button>
      </div>
      <div className="hfilters">
        <label className="search">
          {Icon.search}
          <input placeholder={t.search} value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <TagFilters />
      </div>
      {groupByDay(recordings, [t.today, t.yesterday, t.earlier]).map(
        ([label, items]) =>
          items.length > 0 && (
            <div key={label} className="hlist">
              <div className="group" style={{ paddingLeft: 0 }}>
                {label}
              </div>
              {items.map((r) => (
                <HomeRow key={r.id} r={r} />
              ))}
            </div>
          ),
      )}
      {recordings.length === 0 && <p className="hint">{query ? "—" : t.emptySub}</p>}
    </div>
    <div className="sidefoot homefoot">{footer}</div>
    </>
  );
}
