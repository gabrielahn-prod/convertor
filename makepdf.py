import fitz  # PyMuPDF
import os

def create_perfect_fixed_note():
    input_folder = "input_pdf"
    output_folder = "output_pdf"

    if not os.path.exists(output_folder):
        os.makedirs(output_folder)
    
    # 🌟 1440 x 1080 굿노트 최적화 규격
    page_w, page_h = 1440, 1080
    
    files = [f for f in os.listdir(input_folder) if f.lower().endswith(".pdf")]

    for filename in files:
        input_path = os.path.join(input_folder, filename)
        
        try:
            doc = fitz.open(input_path)
            if len(doc) == 0:
                continue
            
            new_doc = fitz.open()
            
            for i in range(0, len(doc), 2):
                page = new_doc.new_page(width=page_w, height=page_h)
                
                # --- 1. 왼쪽 위 슬라이드 ---
                # 💡 핵심: 원본 회전값을 역으로 상쇄시키는 마법의 공식! (90도면 270도를 돌려 360도로 만듦)
                rot1 = doc[i].rotation
                fix_rot1 = (360 - rot1) % 360
                
                rect1 = fitz.Rect(0, 0, 720, 540)
                page.show_pdf_page(rect1, doc, i, rotate=fix_rot1)

                # --- 2. 왼쪽 아래 슬라이드 ---
                if i + 1 < len(doc):
                    rot2 = doc[i+1].rotation
                    fix_rot2 = (360 - rot2) % 360
                    
                    rect2 = fitz.Rect(0, 540, 720, 1080)
                    page.show_pdf_page(rect2, doc, i + 1, rotate=fix_rot2)

                # --- 3. 오른쪽 모눈종이 ---
                grid_left, grid_right = 720, 1440
                grid_top, grid_bottom = 0, 1080
                grid_size = 20
                grid_color = (0.85, 0.85, 0.85) 
                line_width = 0.5
                
                for y in range(grid_top, grid_bottom + 1, grid_size):
                    page.draw_line(fitz.Point(grid_left, y), fitz.Point(grid_right, y), color=grid_color, width=line_width)
                for x in range(grid_left, grid_right + 1, grid_size):
                    page.draw_line(fitz.Point(x, grid_top), fitz.Point(x, grid_bottom), color=grid_color, width=line_width)

            name, ext = os.path.splitext(filename)
            output_path = os.path.join(output_folder, f"{name}_4P{ext}")
            
            new_doc.save(output_path)
            new_doc.close()
            doc.close()
            
            print(f"성공: {filename} (역방향 회전 상쇄 완벽 적용!)")
            
        except Exception as e:
            print(f"에러 발생 ({filename}): {e}")

if __name__ == "__main__":
    create_perfect_fixed_note()