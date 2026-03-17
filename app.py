from __future__ import annotations

import io
from pathlib import Path

from flask import Flask, jsonify, redirect, request, send_file, send_from_directory
from werkzeug.utils import secure_filename

from converter import build_output_filename, convert_pdf_bytes


BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
MAX_UPLOAD_SIZE = 40 * 1024 * 1024


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_SIZE


@app.route("/")
def index():
    index_path = PUBLIC_DIR / "index.html"
    if index_path.exists():
        return send_from_directory(PUBLIC_DIR, "index.html")
    return redirect("/index.html", code=307)


@app.route("/favicon.ico")
def favicon():
    favicon_path = PUBLIC_DIR / "favicon.svg"
    if favicon_path.exists():
        return send_from_directory(PUBLIC_DIR, "favicon.svg", mimetype="image/svg+xml")
    return ("", 204)


@app.route("/<path:path>")
def static_files(path: str):
    file_path = PUBLIC_DIR / path
    if file_path.exists() and file_path.is_file():
        return send_from_directory(PUBLIC_DIR, path)
    return ("Not Found", 404)


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


@app.route("/api/convert", methods=["POST"])
def convert():
    uploaded_file = request.files.get("file")
    if uploaded_file is None or uploaded_file.filename == "":
        return jsonify({"error": "PDF 파일을 업로드해 주세요."}), 400

    filename = secure_filename(uploaded_file.filename) or "document.pdf"
    if not filename.lower().endswith(".pdf"):
        return jsonify({"error": "PDF 파일만 업로드할 수 있습니다."}), 400

    try:
        pdf_bytes = uploaded_file.read()
        converted_bytes = convert_pdf_bytes(pdf_bytes)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        return jsonify({"error": "변환 중 오류가 발생했습니다. 다른 PDF로 다시 시도해 주세요."}), 500

    output_name = build_output_filename(filename)
    return send_file(
        io.BytesIO(converted_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name=output_name,
    )


@app.errorhandler(413)
def file_too_large(_error):
    return jsonify({"error": "업로드 가능한 최대 파일 크기는 40MB입니다."}), 413


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, debug=True)
