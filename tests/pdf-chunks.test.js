const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const PDFLib = require("../public/vendor/pdf-lib.min.js");

const root = path.join(__dirname, "..");
const { splitPdfIntoChunks } = new Function(
  "PDFLib",
  `${fs.readFileSync(path.join(root, "public/pdf-chunks.js"), "utf8")}; return PDFChunking;`
)(PDFLib);

const makePdf = async (specs) => {
  const doc = await PDFLib.PDFDocument.create();
  specs.forEach(([width, height, rotation = 0, crop], index) => {
    const page = doc.addPage([width, height]);
    page.drawText(`PAGE${index}`, { x: 100, y: 150, size: 14 });
    page.setRotation(PDFLib.degrees(rotation));
    if (crop) page.setCropBox(...crop);
  });
  return doc.save({ addDefaultPage: false });
};

// Exercise the real HTTP endpoint for each chunk, then compare the sheet content
// and text positions against a single request containing the complete source.
const assertConvertedLayout = (original, chunks, expectedGroups) => {
  const result = spawnSync(process.env.PYTHON || "python3", ["-c", `
import base64, io, json, sys
import fitz
from app import app
payload = json.load(sys.stdin)
client = app.test_client()
def convert(data):
    response = client.post('/api/convert', data={'file': (io.BytesIO(base64.b64decode(data)), 'source.pdf')})
    assert response.status_code == 200, response.get_data(as_text=True)
    with fitz.open(stream=response.data, filetype='pdf') as doc:
        return [[tuple(round(value, 2) if isinstance(value, float) else value for value in word[:5]) for word in page.get_text('words')] for page in doc]
whole = convert(payload['original'])
chunked = [page for data in payload['chunks'] for page in convert(data)]
assert whole == chunked, (whole, chunked)
print(json.dumps([[word[4] for word in page] for page in chunked]))
`], {
    cwd: root,
    input: JSON.stringify({
      original: Buffer.from(original).toString("base64"),
      chunks: chunks.map((bytes) => Buffer.from(bytes).toString("base64")),
    }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), expectedGroups.map((indices) => indices.map((i) => `PAGE${i}`)));
};

const split = async (bytes, limits) => splitPdfIntoChunks({ arrayBuffer: async () => bytes }, limits);
const pageCounts = async (chunks) => Promise.all(chunks.map(async (bytes) => (await PDFLib.PDFDocument.load(bytes)).getPageCount()));

test("long portrait PDF keeps one original page per output sheet", async () => {
  const bytes = await makePdf(Array(41).fill([595, 842]));
  const chunks = await split(bytes);
  assert.deepEqual(await pageCounts(chunks), [20, 20, 1]);
  assertConvertedLayout(bytes, chunks, Array.from({ length: 41 }, (_, i) => [i]));
});

test("long landscape PDF preserves existing pairs and odd final slide", async () => {
  const bytes = await makePdf(Array(41).fill([800, 600]));
  const chunks = await split(bytes);
  assert.deepEqual(await pageCounts(chunks), [20, 20, 1]);
  assertConvertedLayout(bytes, chunks, Array.from({ length: 21 }, (_, i) => i < 20 ? [i * 2, i * 2 + 1] : [40]));
});

test("mixed PDF moves the split boundary to avoid breaking a landscape pair", async () => {
  const bytes = await makePdf([[595, 842], ...Array(22).fill([800, 600])]);
  const chunks = await split(bytes);
  assert.deepEqual(await pageCounts(chunks), [19, 4]);
  assertConvertedLayout(bytes, chunks, [[0], ...Array.from({ length: 11 }, (_, i) => [i * 2 + 1, i * 2 + 2])]);
});

test("size-based recursive splitting preserves full sheets with rotation and cropping", async () => {
  const bytes = await makePdf([
    [842, 595, 90],
    [595, 842, 90],
    [595, 842, 270],
    [900, 900, 0, [50, 50, 500, 800]],
    [900, 900, 90, [50, 50, 800, 500]],
    [600, 600],
    [800, 600],
    [595, 842],
  ]);
  const chunks = await split(bytes, { maxBytes: 1 });
  assert.deepEqual(await pageCounts(chunks), [1, 2, 1, 1, 2, 1]);
  assertConvertedLayout(bytes, chunks, [[0], [1, 2], [3], [4], [5, 6], [7]]);
});

test("empty PDF yields no conversion chunks", async () => {
  assert.equal((await split(await makePdf([]))).length, 0);
});
