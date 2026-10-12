import { useRef, useState, type ReactNode } from "react";

const HOLD_MS = 900;

export function HoldButton({ onConfirm, disabled, className = "", children }: { onConfirm: () => void; disabled?: boolean; className?: string; children: ReactNode }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<number>(undefined);

  const start = () => {
    setHolding(true);
    timer.current = window.setTimeout(() => {
      setHolding(false);
      onConfirm();
    }, HOLD_MS);
  };
  const cancel = () => {
    window.clearTimeout(timer.current);
    setHolding(false);
  };

  return (
    <button
      disabled={disabled}
      title="Hold to delete"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !e.repeat && start()}
      onKeyUp={cancel}
      onClick={(e) => e.stopPropagation()}
      className={`btn relative overflow-hidden hover:border-accent hover:text-accent ${className}`}
    >
      <span
        className="absolute inset-y-0 left-0 bg-accent/25"
        style={{ width: holding ? "100%" : "0%", transition: holding ? `width ${HOLD_MS}ms linear` : "none" }}
      />
      <span className="relative">{holding ? "Hold…" : children}</span>
    </button>
  );
}
