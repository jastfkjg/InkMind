"""服务端将作品导出为 PDF：逻辑与「纯文本导出」一致，不嵌入网络字体。"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from pathlib import Path

import fpdf as fpdf_pkg
from fpdf import FPDF
from fpdf.enums import Align, WrapMode, XPos, YPos

from app.models import Chapter, Novel

logger = logging.getLogger(__name__)

# 若存在则直接加载（无下载）；优先能覆盖中文的系统字体
_FONT_CANDIDATES: tuple[str, ...] = (
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.otf",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.otf",
    "C:\\Windows\\Fonts\\msyh.ttf",
    "C:\\Windows\\Fonts\\simhei.ttf",
)


def safe_export_pdf_stem(title: str) -> str:
    t = (title or "未命名").strip() or "未命名"
    return re.sub(r'[/\\?%*:|"<>]', "_", t)[:80]


def _bundled_dejavu_paths() -> list[Path]:
    root = Path(fpdf_pkg.__file__).resolve().parent
    return [
        root / "font" / "DejaVuSans.ttf",
        root / "fonts" / "DejaVuSans.ttf",
    ]


def _try_pick_embedded_font(pdf: FPDF) -> str | None:
    """返回已成功 register 的 family 名称；失败则返回 None，改用核心字体。"""
    for raw in _FONT_CANDIDATES:
        path = Path(raw)
        if not path.is_file():
            continue
        suf = path.suffix.lower()
        if suf not in (".ttf", ".otf"):
            continue
        try:
            pdf.add_font("InkEmbed", "", str(path))
            logger.info("pdf export using font file: %s", path)
            return "InkEmbed"
        except Exception as e:
            logger.debug("skip font %s: %s", path, e)
    for dejavu in _bundled_dejavu_paths():
        if dejavu.is_file():
            try:
                pdf.add_font("InkEmbed", "", str(dejavu))
                logger.info("pdf export using bundled DejaVu: %s", dejavu)
                return "InkEmbed"
            except Exception as e:
                logger.debug("bundled dejavu failed (%s): %s", dejavu, e)
    return None


def _ascii_safe_for_core_font(text: str) -> str:
    """Helvetica 等核心字体仅 Latin-1；无法表示的 Unicode 替换为 '?'。"""
    return text.encode("latin-1", errors="replace").decode("latin-1")


def build_novel_pdf_bytes(novel: Novel, chapters: list[Chapter]) -> bytes:
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=14)

    use_embed = _try_pick_embedded_font(pdf) is not None

    def set_sz(size: int) -> None:
        if use_embed:
            pdf.set_font("InkEmbed", "", size)
        else:
            pdf.set_font("helvetica", "", size)

    def out_text(text: str) -> str:
        if use_embed:
            return text
        return _ascii_safe_for_core_font(text)

    def text_w() -> float:
        """可排版宽度；勿用 multi_cell(..., 0) 接默认 new_x=RIGHT 后不换回左边，会导致下一列宽为 0。"""
        return float(pdf.epw)

    def add_wrapped(text: str, size: int = 11, line_mm: float | None = None) -> None:
        set_sz(size)
        body = out_text(text)
        lh = line_mm if line_mm is not None else max(5.0, size * 0.48)
        pdf.multi_cell(
            text_w(),
            lh,
            body,
            align=Align.L,
            wrapmode=WrapMode.CHAR,
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )

    pdf.add_page()
    title = (novel.title or "").strip() or "未命名"
    set_sz(18)
    pdf.multi_cell(
        text_w(),
        10,
        out_text(title),
        align=Align.L,
        wrapmode=WrapMode.CHAR,
        new_x=XPos.LMARGIN,
        new_y=YPos.NEXT,
    )
    pdf.ln(2)

    meta: list[str] = []
    if novel.genre and str(novel.genre).strip():
        meta.append(f"类型：{str(novel.genre).strip()}")
    meta.append(f"导出时间：{datetime.now().strftime('%Y-%m-%d %H:%M')}")
    add_wrapped("  ·  ".join(meta), size=10, line_mm=4.5)

    bg = (novel.background or "").strip()
    if bg:
        pdf.ln(4)
        set_sz(13)
        pdf.cell(text_w(), 8, out_text("作品背景"), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        add_wrapped(bg, size=11)

    if not chapters:
        pdf.ln(6)
        add_wrapped("（暂无章节）", size=11)
        return _normalize_pdf_buffer(pdf.output())

    for i, ch in enumerate(chapters):
        if i > 0:
            pdf.add_page()
        ch_title = (ch.title or "").strip() or f"第 {i + 1} 章"
        set_sz(15)
        pdf.multi_cell(
            text_w(),
            9,
            out_text(ch_title),
            align=Align.L,
            wrapmode=WrapMode.CHAR,
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
        )
        pdf.ln(1)
        body = (ch.content or "").strip()
        if body:
            add_wrapped(body, size=11)

    return _normalize_pdf_buffer(pdf.output())


def _normalize_pdf_buffer(out: bytearray | bytes | memoryview | str | None) -> bytes:
    """fpdf2 的 output() 返回 bytearray；旧写法 dest='S' 已废弃，勿用。"""
    if out is None:
        raise RuntimeError("PDF output() 未返回数据（请检查 fpdf2 版本与 output() 调用方式）")
    if isinstance(out, (bytes, bytearray)):
        return bytes(out)
    if isinstance(out, memoryview):
        return out.tobytes()
    if isinstance(out, str):
        return out.encode("latin-1", errors="replace")
    raise TypeError(f"unexpected PDF buffer type: {type(out)}")
