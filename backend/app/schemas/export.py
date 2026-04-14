from pydantic import BaseModel


class NovelExportPdfIn(BaseModel):
    """chapter_ids 为 None 或空列表表示导出全部章节（仍按排序顺序）。"""

    chapter_ids: list[int] | None = None
