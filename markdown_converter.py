from __future__ import annotations

import os
from pathlib import Path

import requests


DEFAULT_GOTENBERG_URL = "http://localhost:3000"
GOTENBERG_TIMEOUT_SECONDS = 90


class MarkdownConversionError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


def _build_template(markdown_filename: str, title: str) -> str:
    safe_title = title or "Markdown Document"
    return f"""<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{safe_title}</title>
    <style>
      @page {{
        size: A4;
        margin: 18mm 16mm 18mm;
      }}

      :root {{
        color-scheme: light;
        --paper: #fbfcf8;
        --ink: #1f2a21;
        --muted: #5a665b;
        --line: #d7e0d4;
        --accent: #2f7d57;
        --code-bg: #eff4ec;
        --quote-bg: #f3f5ef;
      }}

      * {{
        box-sizing: border-box;
      }}

      html {{
        font-size: 15px;
      }}

      body {{
        margin: 0;
        color: var(--ink);
        background:
          radial-gradient(circle at top right, rgba(47, 125, 87, 0.08), transparent 22%),
          linear-gradient(180deg, #fdfdfb 0%, var(--paper) 100%);
        font-family: "Noto Sans CJK KR", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif;
        line-height: 1.72;
        word-break: keep-all;
      }}

      main {{
        width: 100%;
      }}

      h1,
      h2,
      h3,
      h4,
      h5,
      h6 {{
        margin: 1.5em 0 0.55em;
        color: #142419;
        font-weight: 700;
        line-height: 1.2;
        break-after: avoid;
      }}

      h1 {{
        padding-bottom: 0.4em;
        border-bottom: 2px solid var(--line);
        font-size: 2rem;
      }}

      h2 {{
        font-size: 1.5rem;
      }}

      p,
      ul,
      ol,
      blockquote,
      table,
      pre {{
        margin: 0 0 1em;
      }}

      ul,
      ol {{
        padding-left: 1.3em;
      }}

      li + li {{
        margin-top: 0.28em;
      }}

      a {{
        color: var(--accent);
        text-decoration: none;
      }}

      code,
      pre {{
        font-family: "SFMono-Regular", "Menlo", "Consolas", monospace;
      }}

      code {{
        padding: 0.16em 0.38em;
        border-radius: 0.4em;
        background: var(--code-bg);
        font-size: 0.94em;
      }}

      pre {{
        overflow: hidden;
        padding: 1em 1.1em;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: #f4f8f1;
        white-space: pre-wrap;
      }}

      pre code {{
        padding: 0;
        background: transparent;
      }}

      blockquote {{
        padding: 0.9em 1em;
        border-left: 4px solid var(--accent);
        border-radius: 0 14px 14px 0;
        background: var(--quote-bg);
        color: var(--muted);
      }}

      table {{
        width: 100%;
        border-collapse: collapse;
        font-size: 0.95rem;
      }}

      th,
      td {{
        padding: 0.7em 0.8em;
        border: 1px solid var(--line);
        text-align: left;
        vertical-align: top;
      }}

      th {{
        background: #eef4eb;
      }}

      img {{
        max-width: 100%;
      }}

      hr {{
        border: 0;
        border-top: 1px solid var(--line);
        margin: 1.8em 0;
      }}
    </style>
  </head>
  <body>
    <main>{{{{ toHTML "{markdown_filename}" }}}}</main>
  </body>
</html>
"""


def convert_markdown_bytes(markdown_bytes: bytes, filename: str) -> bytes:
    if not markdown_bytes.strip():
        raise MarkdownConversionError("비어 있는 Markdown 파일은 변환할 수 없습니다.", status_code=400)

    gotenberg_url = os.getenv("GOTENBERG_URL", DEFAULT_GOTENBERG_URL).rstrip("/")
    markdown_name = Path(filename).name or "document.md"
    title = Path(markdown_name).stem.replace("_", " ").strip()
    template_html = _build_template(markdown_name, title)
    output_name = Path(markdown_name).stem or "document"

    files = [
        ("files", ("index.html", template_html.encode("utf-8"), "text/html; charset=utf-8")),
        ("files", (markdown_name, markdown_bytes, "text/markdown; charset=utf-8")),
    ]
    data = {
        "printBackground": "true",
        "preferCssPageSize": "true",
        "generateDocumentOutline": "true",
    }
    headers = {"Gotenberg-Output-Filename": output_name}

    try:
        response = requests.post(
            f"{gotenberg_url}/forms/chromium/convert/markdown",
            files=files,
            data=data,
            headers=headers,
            timeout=GOTENBERG_TIMEOUT_SECONDS,
        )
    except requests.Timeout as exc:
        raise MarkdownConversionError(
            "Markdown PDF 변환 시간이 초과되었습니다. 다시 시도해 주세요.",
            status_code=504,
        ) from exc
    except requests.RequestException as exc:
        raise MarkdownConversionError(
            "Gotenberg 변환 서버에 연결할 수 없습니다. Docker Compose가 실행 중인지 확인해 주세요.",
            status_code=502,
        ) from exc

    if response.ok:
        return response.content

    message = response.text.strip()
    if not message:
        message = f"Gotenberg 변환 서버가 오류를 반환했습니다. (status={response.status_code})"

    status_code = 400 if 400 <= response.status_code < 500 else 502
    raise MarkdownConversionError(message, status_code=status_code)


def build_markdown_output_filename(original_name: str) -> str:
    path = Path(original_name)
    stem = path.stem or "document"
    return f"{stem}.pdf"
