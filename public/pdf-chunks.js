// Split at output-sheet boundaries so separate server requests produce the same
// layout as converting the entire PDF, including mixed page orientations.
const PDFChunking = (() => {
  const CHUNK_PAGE_SIZE = 20;
  const SAFE_CHUNK_BYTES = 4 * 1024 * 1024;

  const getPageGeometry = (page) => {
    const crop = page.getCropBox();
    const media = page.getMediaBox();
    const left = Math.max(crop.x, media.x);
    const bottom = Math.max(crop.y, media.y);
    const right = Math.min(crop.x + crop.width, media.x + media.width);
    const top = Math.min(crop.y + crop.height, media.y + media.height);
    const width = right - left;
    const height = top - bottom;
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    const quarterTurn = rotation === 90 || rotation === 270;
    const displayWidth = quarterTurn ? height : width;
    const displayHeight = quarterTurn ? width : height;
    return { left, bottom, right, top, rotation, displayWidth, displayHeight, isPortrait: displayHeight > displayWidth };
  };

  const isPortrait = (page) => getPageGeometry(page).isPortrait;

  const buildChunkBytes = async (sourceDoc, groups) => {
    const chunkDoc = await PDFLib.PDFDocument.create();
    const indices = groups.flat();
    const copiedPages = await chunkDoc.copyPages(sourceDoc, indices);
    copiedPages.forEach((page) => chunkDoc.addPage(page));
    return chunkDoc.save();
  };

  const splitGroupsBySize = async (sourceDoc, groups, maxBytes) => {
    const bytes = await buildChunkBytes(sourceDoc, groups);
    if (bytes.byteLength <= maxBytes || groups.length <= 1) {
      return [bytes];
    }

    const mid = Math.ceil(groups.length / 2);
    const left = await splitGroupsBySize(sourceDoc, groups.slice(0, mid), maxBytes);
    const right = await splitGroupsBySize(sourceDoc, groups.slice(mid), maxBytes);
    return [...left, ...right];
  };

  const splitPdfIntoChunks = async (
    file,
    { maxPages = CHUNK_PAGE_SIZE, maxBytes = SAFE_CHUNK_BYTES } = {}
  ) => {
    const sourceDoc = await PDFLib.PDFDocument.load(await file.arrayBuffer());
    const pages = sourceDoc.getPages();
    const groups = [];

    for (let index = 0; index < pages.length;) {
      const group = [index];
      if (!isPortrait(pages[index]) && index + 1 < pages.length && !isPortrait(pages[index + 1])) {
        group.push(index + 1);
      }
      groups.push(group);
      index += group.length;
    }

    const chunks = [];
    let batch = [];
    let pageCount = 0;
    for (const group of groups) {
      if (pageCount + group.length > maxPages && batch.length > 0) {
        chunks.push(...await splitGroupsBySize(sourceDoc, batch, maxBytes));
        batch = [];
        pageCount = 0;
      }
      batch.push(group);
      pageCount += group.length;
    }
    if (batch.length > 0) {
      chunks.push(...await splitGroupsBySize(sourceDoc, batch, maxBytes));
    }
    return chunks;
  };

  return { splitPdfIntoChunks, getPageGeometry, SAFE_CHUNK_BYTES };
})();
