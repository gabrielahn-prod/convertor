from __future__ import annotations

import io
from pathlib import Path

import fitz


PAGE_WIDTH = 1440
PAGE_HEIGHT = 1080
SLIDE_COLUMN_WIDTH = 720
HALF_PAGE_HEIGHT = 540
GRID_SIZE = 20
GRID_COLOR = (0.85, 0.85, 0.85)
GRID_LINE_WIDTH = 0.5
SLOT_PADDING_RATIO = 0.02


def draw_grid(
    page: fitz.Page,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    grid_size: float = GRID_SIZE,
    grid_color: tuple[float, float, float] = GRID_COLOR,
    line_width: float = GRID_LINE_WIDTH,
) -> None:
    y = y0
    while y <= y1 + 0.01:
        page.draw_line(
            fitz.Point(x0, y),
            fitz.Point(x1, y),
            color=grid_color,
            width=line_width,
        )
        y += grid_size

    x = x0
    while x <= x1 + 0.01:
        page.draw_line(
            fitz.Point(x, y0),
            fitz.Point(x, y1),
            color=grid_color,
            width=line_width,
        )
        x += grid_size


def fit_contain_rect(
    slot: fitz.Rect,
    source_width: float,
    source_height: float,
    pad_ratio: float = SLOT_PADDING_RATIO,
) -> fitz.Rect:
    slot_width = float(slot.width)
    slot_height = float(slot.height)

    if pad_ratio > 0:
        pad_x = slot_width * pad_ratio
        pad_y = slot_height * pad_ratio
        slot = fitz.Rect(
            slot.x0 + pad_x,
            slot.y0 + pad_y,
            slot.x1 - pad_x,
            slot.y1 - pad_y,
        )
        slot_width = float(slot.width)
        slot_height = float(slot.height)

    scale = min(slot_width / source_width, slot_height / source_height)
    new_width = source_width * scale
    new_height = source_height * scale

    x0 = slot.x0 + (slot_width - new_width) / 2
    y0 = slot.y0 + (slot_height - new_height) / 2
    return fitz.Rect(x0, y0, x0 + new_width, y0 + new_height)


def _page_dimensions(page: fitz.Page) -> tuple[float, float]:
    rotation = page.rotation % 360
    rect = page.rect
    width = float(rect.width)
    height = float(rect.height)
    if rotation in (90, 270):
        return height, width
    return width, height


def _place_slide(target_page: fitz.Page, source_doc: fitz.Document, index: int, slot: fitz.Rect) -> None:
    source_page = source_doc[index]
    source_width, source_height = _page_dimensions(source_page)
    target_rect = fit_contain_rect(slot, source_width, source_height)

    # Rotate back to an upright orientation before placing it.
    rotate = (360 - source_page.rotation) % 360
    target_page.show_pdf_page(target_rect, source_doc, index, rotate=rotate)


def convert_pdf_bytes(pdf_bytes: bytes) -> bytes:
    source_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    if source_doc.page_count == 0:
        source_doc.close()
        raise ValueError("빈 PDF 파일은 변환할 수 없습니다.")

    output_doc = fitz.open()

    try:
        for index in range(0, source_doc.page_count, 2):
            output_page = output_doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)

            top_slot = fitz.Rect(0, 0, SLIDE_COLUMN_WIDTH, HALF_PAGE_HEIGHT)
            _place_slide(output_page, source_doc, index, top_slot)

            if index + 1 < source_doc.page_count:
                bottom_slot = fitz.Rect(0, HALF_PAGE_HEIGHT, SLIDE_COLUMN_WIDTH, PAGE_HEIGHT)
                _place_slide(output_page, source_doc, index + 1, bottom_slot)

            draw_grid(
                output_page,
                x0=SLIDE_COLUMN_WIDTH,
                y0=0,
                x1=PAGE_WIDTH,
                y1=PAGE_HEIGHT,
            )

        return output_doc.tobytes(garbage=4, deflate=True)
    finally:
        output_doc.close()
        source_doc.close()


def build_output_filename(original_name: str) -> str:
    path = Path(original_name)
    stem = path.stem or "converted"
    return f"{stem}_4P.pdf"
