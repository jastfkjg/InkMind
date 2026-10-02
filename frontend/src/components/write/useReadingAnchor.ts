import { useLayoutEffect, type RefObject } from "react";
import { getCaretViewportPoint } from "@/utils/textareaCaretViewport";

/** Keep a visible character in place when the editor reflows around side panels. */
export function useReadingAnchor(ref: RefObject<HTMLTextAreaElement>, scope: string, enabled: boolean) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    let width = node.clientWidth;
    let height = node.clientHeight;
    let anchor: { index: number; offset: number; value: string } | null = null;
    let frame = 0;
    const capture = () => {
      if (node.clientWidth !== width || node.clientHeight !== height) return;
      const top = node.getBoundingClientRect().top;
      const caret = getCaretViewportPoint(node, node.selectionEnd).top - top;
      let index = node.selectionEnd;
      if (document.activeElement !== node || caret < 0 || caret > height - 32) {
        // Find the first character on the top visible line, including wrapped lines.
        let low = 0, high = node.value.length;
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          if (getCaretViewportPoint(node, mid).top < top) low = mid + 1;
          else high = mid;
        }
        index = low;
      }
      anchor = { index, offset: getCaretViewportPoint(node, index).top - top, value: node.value };
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(capture); };
    const observer = new ResizeObserver(() => {
      const changed = width !== node.clientWidth || height !== node.clientHeight;
      width = node.clientWidth; height = node.clientHeight;
      if (changed && anchor?.value === node.value) {
        const offset = getCaretViewportPoint(node, anchor.index).top - node.getBoundingClientRect().top;
        node.scrollTop += offset - anchor.offset;
      }
      capture();
    });
    observer.observe(node);
    capture();
    node.addEventListener("scroll", schedule);
    node.addEventListener("input", schedule);
    node.addEventListener("select", schedule);
    node.addEventListener("blur", capture);
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      node.removeEventListener("scroll", schedule);
      node.removeEventListener("input", schedule);
      node.removeEventListener("select", schedule);
      node.removeEventListener("blur", capture);
    };
  }, [ref, scope, enabled]);
}
