const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const PDFLib = require("../public/vendor/pdf-lib.min.js");

const root = path.join(__dirname, "..");
const PDFChunking = new Function(
  "PDFLib",
  `${fs.readFileSync(path.join(root, "public/pdf-chunks.js"), "utf8")}; return PDFChunking;`
)(PDFLib);
const { splitPdfIntoChunks } = PDFChunking;
const loadConverter = (fetchImpl = fetch) => new Function(
  "PDFLib", "PDFChunking", "fetch",
  `${fs.readFileSync(path.join(root, "public/pdf-converter.js"), "utf8")}; return PDFNoteConverter;`
)(PDFLib, PDFChunking, fetchImpl);

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

test("browser conversion matches server content and placement for mixed, rotated and cropped pages", async () => {
  const bytes = await makePdf([
    [595, 842], [800, 600], [595, 842, 90], [842, 595, 90],
    [595, 842, 180], [900, 900, 270, [50, 50, 800, 500]],
    [900, 900, 0, [50, 50, 500, 800]], [600, 600],
  ]);
  const converted = await loadConverter().convertPdfBytes(bytes);
  const result = spawnSync(process.env.PYTHON || "python3", ["-c", `
import base64, json, sys
import fitz
from converter import convert_pdf_bytes
payload = json.load(sys.stdin)
with fitz.open(stream=convert_pdf_bytes(base64.b64decode(payload['source'])), filetype='pdf') as server, fitz.open(stream=base64.b64decode(payload['local']), filetype='pdf') as local:
    assert len(server) == len(local)
    for expected, actual in zip(server, local):
        assert expected.rect == actual.rect
        a, b = expected.get_text('words'), actual.get_text('words')
        assert [w[4] for w in a] == [w[4] for w in b], (a, b)
        for word_a, word_b in zip(a, b):
            assert all(abs(x-y) < 0.05 for x,y in zip(word_a[:4], word_b[:4])), (word_a, word_b)
        assert len(actual.get_drawings()) == len(expected.get_drawings())
        assert all(line['rect'].x0 >= 720 for line in actual.get_drawings())
`], {
    cwd: root,
    input: JSON.stringify({ source: Buffer.from(bytes).toString("base64"), local: Buffer.from(converted).toString("base64") }),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("a single page larger than the server limit is converted without a network request", async () => {
  const { randomBytes } = require("node:crypto");
  const source = await PDFLib.PDFDocument.load(await makePdf([[595, 842]]));
  const commentStream = source.context.flateStream(`%${randomBytes(4300000).toString("base64")}\n`);
  source.getPage(0).node.addContentStream(source.context.register(commentStream));
  const bytes = await source.save();
  const chunks = await split(bytes);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].byteLength > PDFChunking.SAFE_CHUNK_BYTES);
  let requests = 0;
  const converter = loadConverter(async () => { requests += 1; throw new Error("Must not upload oversized page"); });
  const output = await converter.convertChunk("/api/convert", chunks[0], 1);
  assert.equal(requests, 0);
  const doc = await PDFLib.PDFDocument.load(output);
  assert.equal(doc.getPageCount(), 1);
  assert.equal(doc.getPage(0).getWidth(), 1440);
});

test("server payload errors, outages and network failures recover through browser conversion", async () => {
  const bytes = await makePdf([[595, 842]]);
  for (const status of [413, 500, 504, "offline"]) {
    let requests = 0;
    const converter = loadConverter(async () => {
      requests += 1;
      if (status === "offline") throw new TypeError("Failed to fetch");
      return new Response("Platform error", { status });
    });
    const output = await converter.convertChunk("/api/convert", bytes, 1);
    assert.equal(requests, 1);
    assert.equal((await PDFLib.PDFDocument.load(output)).getPageCount(), 1);
  }
});

test("small chunks still use the server and preserve validation errors", async () => {
  const bytes = await makePdf([[595, 842]]);
  const converter = loadConverter(async () => new Response(bytes, { status: 200 }));
  assert.deepEqual(new Uint8Array(await converter.convertChunk("/api/convert", bytes, 1)), bytes);
  const rejected = loadConverter(async () => new Response(JSON.stringify({ error: "잘못된 PDF입니다." }), { status: 400 }));
  await assert.rejects(rejected.convertChunk("/api/convert", bytes, 1), /잘못된 PDF/);
});

test("blank pages convert locally without embedding errors", async () => {
  const doc = await PDFLib.PDFDocument.create();
  doc.addPage([595, 842]);
  const output = await loadConverter().convertPdfBytes(await doc.save());
  assert.equal((await PDFLib.PDFDocument.load(output)).getPageCount(), 1);
});
