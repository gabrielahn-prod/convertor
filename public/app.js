const form = document.getElementById("upload-form");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const fileName = document.getElementById("file-name");
const statusBox = document.getElementById("status");
const submitButton = document.getElementById("submit-button");
const resultActions = document.getElementById("result-actions");
const openResultLink = document.getElementById("open-result-link");

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
  setStatus("업로드 준비가 완료되었습니다.", "ready");
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
    setStatus("먼저 PDF 파일을 선택해 주세요.", "error");
    return;
  }

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    setStatus("PDF 파일만 업로드할 수 있습니다.", "error");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  submitButton.disabled = true;
  resetResultLink();
  setStatus("변환 중입니다. 파일 크기에 따라 몇 초 걸릴 수 있습니다.", "loading");

  let mobilePreviewWindow = null;
  if (isMobileBrowser) {
    mobilePreviewWindow = window.open("", "_blank", "noopener");
    if (mobilePreviewWindow) {
      mobilePreviewWindow.document.write(`
        <!DOCTYPE html>
        <html lang="ko">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>PDF 준비 중</title>
            <style>
              body {
                margin: 0;
                min-height: 100vh;
                display: grid;
                place-items: center;
                padding: 24px;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                background: #f7f2ea;
                color: #1f2521;
              }
            </style>
          </head>
          <body>변환이 끝나면 PDF를 엽니다...</body>
        </html>
      `);
      mobilePreviewWindow.document.close();
    }
  }

  try {
    const response = await fetch("/api/convert", {
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

    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const downloadName = match ? match[1] : `${file.name.replace(/\.pdf$/i, "")}_4P.pdf`;
    const objectUrl = URL.createObjectURL(blob);
    showResultLink(objectUrl, downloadName);

    if (isMobileBrowser) {
      if (mobilePreviewWindow) {
        mobilePreviewWindow.location.replace(objectUrl);
        setStatus(
          "변환이 완료되었습니다. 새 탭에서 PDF를 열었습니다. 브라우저의 공유 또는 다운로드 메뉴로 저장해 주세요.",
          "success",
        );
      } else {
        setStatus(
          "변환이 완료되었습니다. 아래 '변환된 PDF 열기'를 눌러 저장해 주세요.",
          "success",
        );
      }
    } else {
      triggerDesktopDownload(objectUrl, downloadName);
      setStatus("변환이 완료되었습니다. 다운로드를 시작합니다.", "success");
    }
  } catch (error) {
    if (mobilePreviewWindow && !mobilePreviewWindow.closed) {
      mobilePreviewWindow.close();
    }
    setStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});

window.addEventListener("beforeunload", () => {
  releaseActiveObjectUrl();
});
