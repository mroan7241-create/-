"use client";
import { useEffect, useRef } from "react";
export function useDialogFocus(onClose: () => void, busy = false) {
  const ref = useRef<HTMLElement | null>(null),
    state = useRef({ onClose, busy });
  state.current = { onClose, busy };
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const elements = () =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]',
        ),
      ).filter((el) => el.getClientRects().length > 0);
    elements()[0]?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape" && !state.current.busy) {
        e.preventDefault();
        e.stopPropagation();
        state.current.onClose();
      }
      if (e.key !== "Tab") return;
      const list = elements(),
        first = list[0],
        last = list.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    root.addEventListener("keydown", key);
    return () => {
      root.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return ref;
}
