import { LANGUAGES } from "../lib/api";

export function LanguagePicker({ value, onChange }: { value: string[]; onChange: (languages: string[]) => void }) {
  return (
    <div className="flex rounded-xs border border-line3" role="group" aria-label="Languages">
      {Object.entries(LANGUAGES).map(([code, name]) => {
        const on = value.includes(code);
        return (
          <button
            key={code}
            title={name}
            aria-pressed={on}
            disabled={on && value.length === 1}
            onClick={() => onChange(on ? value.filter((l) => l !== code) : Object.keys(LANGUAGES).filter((l) => l === code || value.includes(l)))}
            className={`h-7 border-line3 px-2.5 text-xs font-bold uppercase not-last:border-r ${on ? "bg-fg text-bg" : "text-muted hover:bg-raised hover:text-fg"}`}
          >
            {code}
          </button>
        );
      })}
    </div>
  );
}
