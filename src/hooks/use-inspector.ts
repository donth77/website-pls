"use client";

import { useEffect, useRef } from "react";
import { computeSelector, elementSizeRatio } from "@/lib/inspect/selector";

export interface InspectorSelection {
  selector: string;
  outerHTML: string;
  tagName: string;
  /** Fraction of the page the element occupies (0-1). */
  sizeRatio: number;
}

const HOVER_OUTLINE = "2px dashed #818cf8"; // indigo-400
const HOVER_BG = "rgba(99, 102, 241, 0.08)";

/**
 * Element inspector for the preview iframe. Runs entirely as PARENT-window
 * code reaching into the same-origin iframe's `contentDocument` — we cannot
 * inject a script into the iframe itself because the generated HTML's CSP
 * forbids inline/same-origin scripts.
 *
 * While `enabled`, hovering outlines elements and clicking captures a
 * structural selector + outerHTML, then calls `onSelect`. The parent is
 * expected to flip `enabled` off on selection.
 */
export function useInspector({
  iframeRef,
  enabled,
  ready,
  onSelect,
}: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  enabled: boolean;
  /** Flips true once the iframe has loaded; re-attaches listeners on reload. */
  ready: boolean;
  onSelect: (selection: InspectorSelection) => void;
}) {
  // Keep the latest onSelect without making it an effect dependency, so we
  // don't tear down + re-attach listeners every render.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!enabled || !ready) return;
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;

    let hovered: HTMLElement | null = null;
    const prevStyle = new WeakMap<
      HTMLElement,
      { outline: string; background: string }
    >();

    const clearHover = () => {
      if (hovered) {
        const saved = prevStyle.get(hovered);
        hovered.style.outline = saved?.outline ?? "";
        hovered.style.background = saved?.background ?? "";
        hovered = null;
      }
    };

    const isTargetable = (t: EventTarget | null): t is HTMLElement =>
      t instanceof doc.defaultView!.HTMLElement &&
      t.tagName !== "HTML" &&
      t.tagName !== "BODY";

    const onOver = (e: Event) => {
      const t = e.target;
      if (!isTargetable(t)) return;
      if (t === hovered) return;
      clearHover();
      prevStyle.set(t, { outline: t.style.outline, background: t.style.background });
      t.style.outline = HOVER_OUTLINE;
      t.style.outlineOffset = "-2px";
      t.style.background = HOVER_BG;
      hovered = t;
    };

    const onOut = () => clearHover();

    const onClick = (e: Event) => {
      const t = e.target;
      if (!isTargetable(t)) return;
      // Intercept so the page's own links/buttons don't fire while inspecting.
      e.preventDefault();
      e.stopPropagation();
      const selector = computeSelector(t);
      if (!selector) return;
      clearHover();
      onSelectRef.current({
        selector,
        outerHTML: t.outerHTML,
        tagName: t.tagName.toLowerCase(),
        sizeRatio: elementSizeRatio(t, doc),
      });
    };

    // Capture phase so we win over any page-level handlers.
    doc.addEventListener("mouseover", onOver, true);
    doc.addEventListener("mouseout", onOut, true);
    doc.addEventListener("click", onClick, true);
    // Crosshair cursor signals inspect mode. The React Compiler's
    // immutability rule traces `doc.body` back to `iframeRef` and treats
    // this DOM side-effect as "modifying the ref" — a false positive.
    const body = doc.body;
    const prevCursor = body.style.cursor;
    // eslint-disable-next-line react-hooks/immutability
    body.style.cursor = "crosshair";

    return () => {
      doc.removeEventListener("mouseover", onOver, true);
      doc.removeEventListener("mouseout", onOut, true);
      doc.removeEventListener("click", onClick, true);
      clearHover();
      // eslint-disable-next-line react-hooks/immutability
      body.style.cursor = prevCursor;
    };
  }, [enabled, ready, iframeRef]);
}
