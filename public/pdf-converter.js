// Keep oversized pages as vector PDF content without sending them through a
// serverless request or response size limit.
const PDFNoteConverter = (() => {
  const PAGE_WIDTH = 1440;
  const PAGE_HEIGHT = 1080;
  const COLUMN_WIDTH = 720;
  const HALF_HEIGHT = 540;

  const placePage = async (output, target, source, slot) => {
    // PDF-lib cannot embed pages with no content stream. They remain blank.
    if (!source.node.Contents()) return;

    const geometry = PDFChunking.getPageGeometry(source);
    const padX = slot.width * 0.02;
    const padY = slot.height * 0.02;
    const scale = Math.min(
      (slot.width - 2 * padX) / geometry.displayWidth,
      (slot.height - 2 * padY) / geometry.displayHeight
    );
    const width = geometry.displayWidth * scale;
    const height = geometry.displayHeight * scale;
    const left = slot.x + (slot.width - width) / 2;
    const bottom = PAGE_HEIGHT - slot.y - (slot.height + height) / 2;
    const embedded = await output.embedPage(source, {
      left: geometry.left,
      bottom: geometry.bottom,
      right: geometry.right,
      top: geometry.top,
    });

    // /Rotate is clockwise; drawPage's angle is counterclockwise. Offset the
    // rotated origin so the visible page fits exactly inside the target slot.
    const rotation = geometry.rotation;
    target.drawPage(embedded, {
      x: left + (rotation === 180 || rotation === 270 ? width : 0),
      y: bottom + (rotation === 90 || rotation === 180 ? height : 0),
      xScale: scale,
      yScale: scale,
      rotate: PDFLib.degrees(-rotation),
    });
  };

  const drawGrid = (page) => {
    const color = PDFLib.rgb(0.85, 0.85, 0.85);
    for (let y = 0; y <= PAGE_HEIGHT; y += 20) {
      page.drawLine({ start: { x: COLUMN_WIDTH, y }, end: { x: PAGE_WIDTH, y }, thickness: 0.5, color });
    }
    for (let x = COLUMN_WIDTH; x <= PAGE_WIDTH; x += 20) {
      page.drawLine({ start: { x, y: 0 }, end: { x, y: PAGE_HEIGHT }, thickness: 0.5, color });
    }
  };

  const convertPdfBytes = async (bytes) => {
    const source = await PDFLib.PDFDocument.load(bytes);
    const pages = source.getPages();
    if (pages.length === 0) throw new Error("빈 PDF 파일은 변환할 수 없습니다.");
    const output = await PDFLib.PDFDocument.create();

    for (let index = 0; index < pages.length;) {
      const target = output.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      if (PDFChunking.getPageGeometry(pages[index]).isPortrait) {
        await placePage(output, target, pages[index], { x: 0, y: 0, width: COLUMN_WIDTH, height: PAGE_HEIGHT });
        index += 1;
      } else {
        await placePage(output, target, pages[index], { x: 0, y: 0, width: COLUMN_WIDTH, height: HALF_HEIGHT });
        index += 1;
        if (index < pages.length && !PDFChunking.getPageGeometry(pages[index]).isPortrait) {
          await placePage(output, target, pages[index], { x: 0, y: HALF_HEIGHT, width: COLUMN_WIDTH, height: HALF_HEIGHT });
          index += 1;
        }
      }
      drawGrid(target);
    }
    return output.save();
  };

  const convertChunk = async (endpoint, bytes, index) => {
    // A single source page can exceed the limit even after splitting. Convert
    // those chunks locally before attempting an upload that cannot succeed.
    if (bytes.byteLength > PDFChunking.SAFE_CHUNK_BYTES) return convertPdfBytes(bytes);

    const formData = new FormData();
    formData.append("file", new Blob([bytes], { type: "application/pdf" }), `chunk-${index}.pdf`);

    let response;
    try {
      response = await fetch(endpoint, { method: "POST", body: formData });
    } catch (_error) {
      return convertPdfBytes(bytes);
    }

    // Also recover if the converted response is too large, or the server is
    // unavailable. No rasterization or external storage is needed.
    if (response.status === 413 || response.status >= 500) return convertPdfBytes(bytes);
    if (!response.ok) {
      let message = `PDF 변환 요청에 실패했습니다. (HTTP ${response.status})`;
      try {
        const payload = await response.json();
        message = payload.error || message;
      } catch (_error) {
        // Preserve the HTTP status when the platform returns a text error.
      }
      throw new Error(message);
    }
    return response.arrayBuffer();
  };

  return { convertPdfBytes, convertChunk };
})();
