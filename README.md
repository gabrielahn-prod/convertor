# PDF 4P Converter

PDF 파일을 업로드하면 왼쪽에는 슬라이드 2장, 오른쪽에는 모눈 노트 영역이 있는 4P PDF로 변환하는 웹 앱입니다.
추가로 `.md` 파일을 업로드해 `gotenberg` 기반으로 PDF로 내려받는 페이지도 포함되어 있습니다.

## Local

```bash
docker compose up --build
```

브라우저에서 `http://localhost:8000` 으로 접속합니다.

- `/` : PDF -> 4P 노트 PDF
- `/markdown.html` : Markdown -> PDF

`docker compose`는 웹 앱과 `gotenberg`를 함께 실행합니다.
내부 통신은 `http://gotenberg:3000`, 호스트에서는 `http://localhost:3000` 으로 접근할 수 있습니다.

## Vercel

```bash
pip install -r requirements.txt
vercel dev
vercel
```

`public/` 폴더의 정적 파일과 `app.py` Flask 앱을 함께 배포합니다.
`requirements.txt`에 `Flask`가 있어 Vercel이 프로젝트 루트의 `app.py`를 Flask 프레임워크 프리셋 엔트리포인트로 자동 인식하고,
모든 요청(정적 파일 포함)을 이 앱으로 라우팅합니다. 별도의 `rewrites` 설정은 필요하지 않습니다.

Markdown -> PDF 기능은 `GOTENBERG_URL` 환경 변수가 접근 가능한 `gotenberg` 인스턴스를 가리켜야 동작합니다.

## API

- `POST /api/convert`
  - form-data 키: `file`
  - PDF 업로드 후 변환된 PDF 파일을 바로 반환
- `POST /api/convert/markdown`
  - form-data 키: `file`
  - `.md` 업로드 후 `gotenberg`로 PDF를 생성해 바로 반환
