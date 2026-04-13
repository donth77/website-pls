"use client";

import { useEffect, useState } from "react";

interface Options {
  phrases: string[];
  typeMs?: number;
  deleteMs?: number;
  holdMs?: number;
  gapMs?: number;
  startDelayMs?: number;
  enabled?: boolean;
}

export function useTypewriterPlaceholder({
  phrases,
  typeMs = 60,
  deleteMs = 30,
  holdMs = 2000,
  gapMs = 400,
  startDelayMs = 1000,
  enabled = true,
}: Options): string {
  const [text, setText] = useState("");

  useEffect(() => {
    if (!enabled || phrases.length === 0) {
      return;
    }

    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced) {
      const id = setTimeout(() => setText(phrases[0]), 0);
      return () => clearTimeout(id);
    }

    let index = 0;
    let chars = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      const current = phrases[index];
      if (deleting) {
        chars -= 1;
        setText(current.slice(0, chars));
      } else {
        chars += 1;
        setText(current.slice(0, chars));
      }

      let next = deleting ? deleteMs : typeMs;
      if (!deleting && chars === current.length) {
        deleting = true;
        next = holdMs;
      } else if (deleting && chars === 0) {
        deleting = false;
        index = (index + 1) % phrases.length;
        next = gapMs;
      }
      timer = setTimeout(tick, next);
    };

    timer = setTimeout(tick, startDelayMs);
    return () => clearTimeout(timer);
  }, [phrases, typeMs, deleteMs, holdMs, gapMs, startDelayMs, enabled]);

  return text;
}
