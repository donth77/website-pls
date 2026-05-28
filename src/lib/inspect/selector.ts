/**
 * Compute a structural CSS selector for an element in the preview iframe,
 * walking up to the first id-anchored ancestor (or <html>). Uses
 * `nth-of-type` so it survives Tailwind's churny, repeated class names.
 *
 * The selector is computed against the live iframe DOM but is designed to
 * resolve identically when the server re-parses the *source* HTML with a
 * DOM library (linkedom) — the preview renders static generated HTML with
 * no client framework mutating it, so live DOM === source structure.
 */

// Conservative id check: a plain CSS identifier we can safely use as `#id`
// without escaping. Anything weirder falls through to the nth-of-type path.
const SAFE_ID = /^[A-Za-z][\w-]*$/;

export function computeSelector(el: Element): string {
  if (!el || el.nodeType !== 1) return "";

  const parts: string[] = [];
  let node: Element | null = el;

  while (node && node.tagName && node.tagName.toLowerCase() !== "html") {
    const id = node.getAttribute?.("id");
    if (id && SAFE_ID.test(id)) {
      // An id is unique within the document — anchor here and stop.
      parts.unshift(`#${id}`);
      break;
    }

    const tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }

    const sameTag = Array.from(parent.children).filter(
      (c) => c.tagName === node!.tagName,
    );
    if (sameTag.length === 1) {
      parts.unshift(tag);
    } else {
      parts.unshift(`${tag}:nth-of-type(${sameTag.indexOf(node) + 1})`);
    }

    node = parent;
  }

  return parts.join(" > ");
}

/**
 * Rough fraction of the viewport an element occupies, used downstream to
 * decide whether a targeted edit makes sense (a near-full-page element
 * should fall back to normal refinement).
 */
export function elementSizeRatio(el: Element, doc: Document): number {
  try {
    const rect = (el as HTMLElement).getBoundingClientRect();
    const docEl = doc.documentElement;
    const w = docEl.clientWidth || 1;
    const h = docEl.scrollHeight || docEl.clientHeight || 1;
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    return Math.min(1, area / (w * h));
  } catch {
    return 0;
  }
}
