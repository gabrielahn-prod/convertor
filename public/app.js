const form = document.getElementById("upload-form");
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
const fileName = document.getElementById("file-name");
const statusBox = document.getElementById("status");
const submitButton = document.getElementById("submit-button");

const setStatus = (message, tone = "idle") => {
  statusBox.textContent = message;
  statusBox.dataset.tone = tone;
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
  setStatus("변환 중입니다. 파일 크기에 따라 몇 초 걸릴 수 있습니다.", "loading");

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
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = downloadName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);

    setStatus("변환이 완료되었습니다. 다운로드를 시작합니다.", "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
});
