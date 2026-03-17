import fitz  # PyMuPDF
import os

def draw_grid(page: fitz.Page, x0: float, y0: float, x1: float, y1: float, 
              grid_size: float = 20.0, grid_color=(0.85, 0.85, 0.85), line_width: float = 0.5):
    """지정된 영역에 모눈종이를 그리는 함수"""
    y = y0
    while y <= y1 + 0.01:
        page.draw_line(fitz.Point(x0, y), fitz.Point(x1, y), color=grid_color, width=line_width)
        y += grid_size

    x = x0
    while x <= x1 + 0.01:
        page.draw_line(fitz.Point(x, y0), fitz.Point(x, y1), color=grid_color, width=line_width)
        x += grid_size

def fit_contain_rect(slot: fitz.Rect, src_w: float, src_h: float, pad_ratio: float = 0.01) -> fitz.Rect:
    """비율을 유지하며 슬라이드가 잘리지 않게 상자 크기를 맞춰주는 함수"""
    slot_w, slot_h = float(slot.width), float(slot.height)

    # 끝부분 잘림 방지를 위한 아주 미세한 안전 여백 (1%)
    if pad_ratio > 0:
        pad_x, pad_y = slot_w * pad_ratio, slot_h * pad_ratio
        slot = fitz.Rect(slot.x0 + pad_x, slot.y0 + pad_y, slot.x1 - pad_x, slot.y1 - pad_y)
        slot_w, slot_h = float(slot.width), float(slot.height)

    scale = min(slot_w / src_w, slot_h / src_h)
    new_w, new_h = src_w * scale, src_h * scale

    x0 = slot.x0 + (slot_w - new_w) / 2
    y0 = slot.y0 + (slot_h - new_h) / 2
    return fitz.Rect(x0, y0, x0 + new_w, y0 + new_h)

def render_page_pixmap_auto_upright(src_page: fitz.Page, zoom: float = 3.0) -> fitz.Pixmap:
    """슬라이드를 4방향으로 찍어보고 가장 완벽한 가로 방향 사진을 뽑아내는 함수"""
    # zoom=3.0 은 고화질 렌더링을 의미합니다. (용량이 크면 2.0으로 낮추세요)
    base = fitz.Matrix(zoom, zoom)
    candidates = []
    
    for ang in (0, 90, 180, 270):
        mat = base.prerotate(ang)
        pix = src_page.get_pixmap(matrix=mat, alpha=False)
        candidates.append((ang, pix))

    # 가로가 세로보다 긴(Landscape) 결과물 우선 찾기
    landscape = [(ang, pix) for ang, pix in candidates if pix.width >= pix.height]
    if landscape:
        ang, pix = max(landscape, key=lambda ap: ap[1].width * ap[1].height)
        return pix

    # 없으면 가장 면적이 큰 것 선택
    ang, pix = max(candidates, key=lambda ap: ap[1].width * ap[1].height)
    return pix

def create_ultimate_raster_note():
    input_folder = "input_pdf"
    output_folder = "output_pdf"
    os.makedirs(output_folder, exist_ok=True)

    files = [f for f in os.listdir(input_folder) if f.lower().endswith(".pdf")]
    if not files:
        print(f"'{input_folder}' 폴더에 PDF 파일이 없습니다.")
        return

    # 🌟 어떤 교수님의 파일이든 굿노트 최적화 "1440 x 1080" 사이즈로 통일
    page_w, page_h = 1440, 1080

    for filename in files:
        input_path = os.path.join(input_folder, filename)
        try:
            doc = fitz.open(input_path)
            if doc.page_count == 0:
                continue
            
            new_doc = fitz.open()

            for i in range(0, doc.page_count, 2):
                page = new_doc.new_page(width=page_w, height=page_h)

                # --- 1. 왼쪽 위 슬라이드 (720x540 공간) ---
                rect_top = fitz.Rect(0, 0, 720, 540)
                pix1 = render_page_pixmap_auto_upright(doc[i], zoom=3.0)
                inner_top = fit_contain_rect(rect_top, pix1.width, pix1.height, pad_ratio=0.01)
                page.insert_image(inner_top, pixmap=pix1)

                # --- 2. 왼쪽 아래 슬라이드 (720x540 공간) ---
                if i + 1 < doc.page_count:
                    rect_bot = fitz.Rect(0, 540, 720, 1080)
                    pix2 = render_page_pixmap_auto_upright(doc[i + 1], zoom=3.0)
                    inner_bot = fit_contain_rect(rect_bot, pix2.width, pix2.height, pad_ratio=0.01)
                    page.insert_image(inner_bot, pixmap=pix2)

                # --- 3. 오른쪽 모눈종이 (나머지 절반 공간 꽉 채우기) ---
                draw_grid(
                    page,
                    x0=720, y0=0, x1=1440, y1=1080,
                    grid_size=20.0,
                    grid_color=(0.85, 0.85, 0.85),
                    line_width=0.5
                )

            name, ext = os.path.splitext(filename)
            output_path = os.path.join(output_folder, f"{name}_4P{ext}")
            
            new_doc.save(output_path)
            new_doc.close()
            doc.close()

            print(f"성공: {filename} (고화질 이미지 렌더링 방식 완료!)")

        except Exception as e:
            print(f"에러 발생 ({filename}): {e}")

if __name__ == "__main__":
    create_ultimate_raster_note()