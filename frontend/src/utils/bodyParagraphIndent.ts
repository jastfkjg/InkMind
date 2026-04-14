/**
 * 写作区规则：首段仅靠 textarea 的 text-indent；换段后行首为两个全角空格（与 Enter 插入一致）。
 * 对未带段首缩进的正文（如 AI 生成）补全，已符合格式的行不重复添加。
 */
export function normalizeBodyParagraphIndent(text: string): string {
  if (!text) return text;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (i === 0) {
      out.push(raw.replace(/^[\u3000 \t]+/, ""));
      continue;
    }
    const trimmed = raw.trimStart();
    if (trimmed === "") {
      out.push("");
      continue;
    }
    if (/^[\u3000]{2}/.test(raw)) {
      out.push(raw);
    } else {
      out.push(`\u3000\u3000${trimmed}`);
    }
  }
  return out.join("\n");
}
