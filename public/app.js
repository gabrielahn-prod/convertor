const form = document.getElementById("upload-form");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const fileName = document.getElementById("file-name");
const statusBox = document.getElementById("status");
const submitButton = document.getElementById("submit-button");
const resultActions = document.getElementById("result-actions");
const openResultLink = document.getElementById("open-result-link");
const pageMode = document.body.dataset.mode || "pdf4p";

const pageConfig = {
  pdf4p: {
    endpoint: "/api/convert",
    extension: ".pdf",
    readyMessage: "업로드 준비가 완료되었습니다.",
    missingMessage: "먼저 PDF 파일을 선택해 주세요.",
    invalidMessage: "PDF 파일만 업로드할 수 있습니다.",
    loadingMessage: "변환 중입니다. 파일 크기에 따라 몇 초 걸릴 수 있습니다.",
    successMobileMessage: "변환이 완료되었습니다. 아래 버튼을 눌러 PDF를 다운로드해 주세요.",
    successDesktopMessage: "변환이 완료되었습니다. 아래 버튼으로 다시 다운로드할 수 있습니다.",
    fallbackDownloadName(fileNameValue) {
      return `${fileNameValue.replace(/\.pdf$/i, "")}_4P.pdf`;
    },
  },
  markdown: {
    endpoint: "/api/convert/markdown",
    extension: ".md",
    readyMessage: "Markdown 업로드 준비가 완료되었습니다.",
    missingMessage: "먼저 Markdown 파일을 선택해 주세요.",
    invalidMessage: "`.md` 파일만 업로드할 수 있습니다.",
    loadingMessage: "Markdown을 PDF로 변환 중입니다. 잠시만 기다려 주세요.",
    successMobileMessage: "PDF 생성이 완료되었습니다. 아래 버튼을 눌러 다운로드해 주세요.",
    successDesktopMessage: "PDF 생성이 완료되었습니다. 아래 버튼으로 다시 다운로드할 수 있습니다.",
    fallbackDownloadName(fileNameValue) {
      return `${fileNameValue.replace(/\.md$/i, "")}.pdf`;
    },
  },
};

const config = pageConfig[pageMode] || pageConfig.pdf4p;

// Vercel 서버리스 함수는 요청/응답 본문을 4.5MB로 강제 제한한다(설정 불가).
// 슬라이드가 많아 파일이 커지면 이 한도에 걸려 변환이 실패하므로,
// 원본 PDF를 20페이지 단위로 나눠 각각 변환한 뒤 클라이언트에서 다시 합친다.
const CHUNK_PAGE_SIZE = 20;
const SAFE_CHUNK_BYTES = 4 * 1024 * 1024;

const buildChunkBytes = async (sourceDoc, startIndex, endIndex) => {
  const chunkDoc = await PDFLib.PDFDocument.create();
  const indices = [];
  for (let i = startIndex; i < endIndex; i += 1) {
    indices.push(i);
  }
  const copiedPages = await chunkDoc.copyPages(sourceDoc, indices);
  copiedPages.forEach((page) => chunkDoc.addPage(page));
  return chunkDoc.save();
};

// 20페이지로 나눠도 슬라이드 용량이 커서 4.5MB를 넘으면 절반씩 더 쪼갠다.
// 나누는 지점은 항상 짝수 페이지 폭으로 이동하므로 서버의 2페이지 짝짓기 규칙이 깨지지 않는다.
const splitRangeBySize = async (sourceDoc, startIndex, endIndex) => {
  const bytes = await buildChunkBytes(sourceDoc, startIndex, endIndex);
  const pageCount = endIndex - startIndex;
  if (bytes.byteLength <= SAFE_CHUNK_BYTES || pageCount <= 2) {
    return [bytes];
  }

  const half = Math.ceil(pageCount / 4) * 2;
  const mid = startIndex + half;
  const left = await splitRangeBySize(sourceDoc, startIndex, mid);
  const right = await splitRangeBySize(sourceDoc, mid, endIndex);
  return [...left, ...right];
};

const splitPdfIntoChunks = async (file) => {
  const buffer = await file.arrayBuffer();
  const sourceDoc = await PDFLib.PDFDocument.load(buffer);
  const totalPages = sourceDoc.getPageCount();

  const chunks = [];
  for (let start = 0; start < totalPages; start += CHUNK_PAGE_SIZE) {
    const end = Math.min(start + CHUNK_PAGE_SIZE, totalPages);
    const safeChunks = await splitRangeBySize(sourceDoc, start, end);
    chunks.push(...safeChunks);
  }
  return chunks;
};

const convertChunk = async (endpoint, bytes, index) => {
  const formData = new FormData();
  formData.append(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    `chunk-${index}.pdf`
  );

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    let message = "변환에 실패했습니다.";
    try {
      const payload = await response.json();
      message = payload.error || message;
    } catch (_error) {
      // JSON이 아니면 기본 메시지를 그대로 사용합니다.
    }
    throw new Error(message);
  }

  return response.arrayBuffer();
};

const mergeConvertedChunks = async (buffers) => {
  const mergedDoc = await PDFLib.PDFDocument.create();
  for (const buffer of buffers) {
    const doc = await PDFLib.PDFDocument.load(buffer);
    const pages = await mergedDoc.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => mergedDoc.addPage(page));
  }
  return mergedDoc.save();
};

const userAgent = navigator.userAgent || navigator.vendor || "";
const isIOS =
  /iPad|iPhone|iPod/.test(userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(userAgent);
const isMobileBrowser = isIOS || isAndroid;

let activeObjectUrl = null;

const setStatus = (message, tone = "idle") => {
  statusBox.textContent = message;
  statusBox.dataset.tone = tone;
};

const releaseActiveObjectUrl = () => {
  if (!activeObjectUrl) {
    return;
  }

  URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = null;
};

const resetResultLink = () => {
  resultActions.hidden = true;
  openResultLink.href = "#";
  openResultLink.removeAttribute("download");
  releaseActiveObjectUrl();
};

const showResultLink = (objectUrl, downloadName) => {
  activeObjectUrl = objectUrl;
  openResultLink.href = objectUrl;
  openResultLink.download = downloadName;
  resultActions.hidden = false;
};

const triggerDesktopDownload = (objectUrl, downloadName) => {
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = downloadName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

const updateSelectedFile = (file) => {
  if (!file) {
    fileName.textContent = "선택된 파일이 없습니다.";
    return;
  }

  fileName.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
};

const handleFiles = (files) => {
  const [file] = files;
  if (!file) {
    return;
  }

  resetResultLink();
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  fileInput.files = dataTransfer.files;
  updateSelectedFile(file);
  setStatus(config.readyMessage, "ready");
};

["dragenter", "dragover"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.dataset.dragging = "true";
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.dataset.dragging = "false";
  });
});

dropzone.addEventListener("drop", (event) => {
  handleFiles(event.dataTransfer.files);
});

fileInput.addEventListener("change", (event) => {
  handleFiles(event.target.files);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = fileInput.files[0];
  if (!file) {
    setStatus(config.missingMessage, "error");
    return;
  }

  if (!file.name.toLowerCase().endsWith(config.extension)) {
    setStatus(config.invalidMessage, "error");
    return;
  }

  submitButton.disabled = true;
  resetResultLink();
  setStatus(config.loadingMessage, "loading");

  try {
    let blob;
    let downloadName;

    if (pageMode === "pdf4p") {
      const chunks = await splitPdfIntoChunks(file);
      if (chunks.length === 0) {
        throw new Error("빈 PDF 파일은 변환할 수 없습니다.");
      }
      const convertedBuffers = [];
      for (let i = 0; i < chunks.length; i += 1) {
        if (chunks.length > 1) {
          setStatus(`변환 중입니다. (${i + 1}/${chunks.length})`, "loading");
        }
        convertedBuffers.push(await convertChunk(config.endpoint, chunks[i], i + 1));
      }

      const mergedBytes =
        convertedBuffers.length > 1
          ? await mergeConvertedChunks(convertedBuffers)
          : convertedBuffers[0];
      blob = new Blob([mergedBytes], { type: "application/pdf" });
      downloadName = config.fallbackDownloadName(file.name);
    } else {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(config.endpoint, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let message = "변환에 실패했습니다.";
        try {
          const payload = await response.json();
          message = payload.error || message;
        } catch (_error) {
          // JSON이 아니면 기본 메시지를 그대로 사용합니다.
        }
        throw new Error(message);
      }

      blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      downloadName = match ? match[1] : config.fallbackDownloadName(file.name);
    }

    const objectUrl = URL.createObjectURL(blob);
    showResultLink(objectUrl, downloadName);

    if (isMobileBrowser) {
      setStatus(config.successMobileMessage, "success");
    } else {
      triggerDesktopDownload(objectUrl, downloadName);
      setStatus(config.successDesktopMessage, "success");
    }
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

window.addEventListener("beforeunload", () => {
  releaseActiveObjectUrl();
});
