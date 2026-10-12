import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState("");
  const [known, setKnown] = useState<string[]>([]);

  useEffect(() => {
    api.allTags().then(setKnown);
  }, [tags]);

  const add = () => {
    const tag = input.trim().replace(/,$/, "");
    setInput("");
    if (tag && !tags.some((t) => t.toLowerCase() === tag.toLowerCase())) onChange([...tags, tag]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <span key={t} className="chip text-fg2">
          {t}
          <button className="text-muted hover:text-accent" aria-label={`Remove tag ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <input
        className="h-6 w-28 rounded-xs border border-dashed border-line3 bg-transparent px-2 text-xs outline-none focus:border-fg"
        placeholder="+ Add tag"
        list="known-tags"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
      />
      <datalist id="known-tags">
        {known.filter((k) => !tags.includes(k)).map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>
    </div>
  );
}
