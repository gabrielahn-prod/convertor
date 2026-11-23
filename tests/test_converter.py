import io
import unittest

import fitz

from app import app
from converter import convert_pdf_bytes, fit_contain_rect


def make_pdf(specs):
    doc = fitz.open()
    for index, spec in enumerate(specs):
        width, height, rotation = spec[:3]
        page = doc.new_page(width=width, height=height)
        if len(spec) > 3:
            page.set_cropbox(fitz.Rect(spec[3]))
        crop = page.cropbox
        for position, y in (("TOP", 40), ("BOTTOM", crop.height - 30)):
            page.insert_text((30, y), f"PAGE{index}-{position}", fontsize=14)
        page.set_rotation(rotation)
    data = doc.tobytes()
    doc.close()
    return data


class ConverterTests(unittest.TestCase):
    def assert_layout(self, specs, groups):
        data = make_pdf(specs)
        with fitz.open(stream=data, filetype="pdf") as source, fitz.open(
            stream=convert_pdf_bytes(data), filetype="pdf"
        ) as output:
            self.assertEqual(len(output), len(groups))
            for sheet, indices in zip(output, groups):
                self.assertEqual(tuple(sheet.rect), (0, 0, 1440, 1080))
                actual_labels = [word[4] for word in sheet.get_text("words")]
                expected_labels = [f"PAGE{i}-{pos}" for i in indices for pos in ("TOP", "BOTTOM")]
                self.assertEqual(actual_labels, expected_labels)

                for slot_index, index in enumerate(indices):
                    original = source[index]
                    if original.rect.height > original.rect.width:
                        slot = fitz.Rect(0, 0, 720, 1080)
                    else:
                        slot = fitz.Rect(0, slot_index * 540, 720, (slot_index + 1) * 540)
                    target = fit_contain_rect(slot, original.rect.width, original.rect.height)
                    scale = target.width / original.rect.width
                    for pos in ("TOP", "BOTTOM"):
                        label = f"PAGE{index}-{pos}"
                        source_box = original.search_for(label)[0] * original.rotation_matrix
                        expected_box = fitz.Rect(
                            source_box.x0 * scale + target.x0,
                            source_box.y0 * scale + target.y0,
                            source_box.x1 * scale + target.x0,
                            source_box.y1 * scale + target.y0,
                        )
                        actual_box = sheet.search_for(label)[0]
                        for actual, expected in zip(actual_box, expected_box):
                            self.assertAlmostEqual(actual, expected, delta=0.05)

                lines = sheet.get_drawings()
                grid_lines = [line for line in lines if line["color"] == (0.8500000238418579,) * 3]
                self.assertTrue(grid_lines)
                self.assertTrue(all(line["rect"].x0 >= 720 for line in grid_lines))

    def test_portrait_uses_full_height_one_page_per_sheet(self):
        self.assert_layout([(595, 842, 0)] * 3, [[0], [1], [2]])

    def test_landscape_keeps_two_slides_and_odd_last_page(self):
        self.assert_layout([(800, 600, 0)] * 5, [[0, 1], [2, 3], [4]])

    def test_mixed_orientations_keep_order_and_only_pair_adjacent_landscape(self):
        self.assert_layout(
            [(800, 600, 0), (595, 842, 0), (800, 600, 0), (800, 600, 0), (595, 842, 0)],
            [[0], [1], [2, 3], [4]],
        )

    def test_display_rotation_and_crop_define_orientation(self):
        self.assert_layout(
            [
                (842, 595, 90),
                (595, 842, 90),
                (595, 842, 270),
                (595, 842, 180),
                (900, 900, 0, (80, 50, 580, 850)),
                (900, 900, 90, (80, 50, 880, 550)),
                (600, 600, 0),
            ],
            [[0], [1, 2], [3], [4], [5], [6]],
        )

    def test_blank_portrait_page_still_gets_note_sheet(self):
        with fitz.open() as source:
            source.new_page(width=595, height=842)
            result = convert_pdf_bytes(source.tobytes())
        with fitz.open(stream=result, filetype="pdf") as output:
            self.assertEqual(len(output), 1)
            self.assertEqual(output[0].get_text(), "")
            self.assertTrue(output[0].get_drawings())

    def test_api_auto_detects_without_extra_form_fields(self):
        response = app.test_client().post(
            "/api/convert",
            data={"file": (io.BytesIO(make_pdf([(595, 842, 0)] * 2)), "paper.pdf")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "application/pdf")
        self.assertIn("paper_4P.pdf", response.headers["Content-Disposition"])
        with fitz.open(stream=response.data, filetype="pdf") as output:
            self.assertEqual(len(output), 2)


if __name__ == "__main__":
    unittest.main()
