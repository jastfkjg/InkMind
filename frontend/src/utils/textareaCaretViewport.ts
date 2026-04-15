/**
 * textarea 内某字符索引处的视口坐标（用于选区旁浮动菜单）。
 * 算法与 component/textarea-caret-position（MIT）一致，再换算为视口坐标。
 */

const MIRROR_PROPS = [
  "direction",
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
] as const;

function getCaretCoordinates(element: HTMLTextAreaElement, position: number): { top: number; left: number } {
  const isFirefox = typeof (window as unknown as { mozInnerScreenX?: number }).mozInnerScreenX !== "undefined";
  const div = document.createElement("div");
  document.body.appendChild(div);
  const style = div.style;
  const computed = window.getComputedStyle(element);

  style.whiteSpace = "pre-wrap";
  style.wordWrap = "break-word";
  style.position = "absolute";
  style.visibility = "hidden";

  for (const prop of MIRROR_PROPS) {
    (style as unknown as Record<string, string>)[prop] = computed[prop] as string;
  }

  if (isFirefox) {
    if (element.scrollHeight > parseInt(computed.height, 10)) style.overflowY = "scroll";
  } else {
    style.overflow = "hidden";
  }

  div.textContent = element.value.substring(0, position);
  const span = document.createElement("span");
  span.textContent = element.value.substring(position) || ".";
  div.appendChild(span);

  const top = span.offsetTop + parseInt(computed.borderTopWidth, 10);
  const left = span.offsetLeft + parseInt(computed.borderLeftWidth, 10);
  document.body.removeChild(div);
  return { top, left };
}

/** 选区末端（或任意索引）在视口中的参考点 */
export function getCaretViewportPoint(textarea: HTMLTextAreaElement, position: number): { top: number; left: number } {
  const c = getCaretCoordinates(textarea, position);
  const rect = textarea.getBoundingClientRect();
  return {
    top: rect.top + textarea.clientTop + c.top - textarea.scrollTop,
    left: rect.left + textarea.clientLeft + c.left - textarea.scrollLeft,
  };
}
