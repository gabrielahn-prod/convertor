# PDF Note Converter

PDF 파일의 페이지 방향을 자동 인식해 왼쪽에는 원본, 오른쪽에는 모눈 노트 영역이 있는 PDF로 변환하는 웹 앱입니다.

- 가로 페이지: 기존 4P 형식으로 연속된 슬라이드 2장을 왼쪽 위아래에 배치합니다.
- 세로 페이지: 문서 1장을 왼쪽 전체 높이에 배치합니다. 논문·교재 옆에 넓은 필기 공간이 생깁니다.
- 가로·세로 혼합 PDF도 원래 순서대로 처리하며, 세로 페이지 앞뒤의 가로 페이지를 서로 묶지 않습니다.
- 회전 정보와 잘라낸 영역을 반영해 화면에 보이는 방향으로 판단합니다. 정사각형 페이지는 가로 형식으로 처리합니다.
- 출력 크기는 기존과 같은 1440×1080이며, 원본 비율을 유지합니다. 다운로드 파일명은 호환성을 위해 `_4P.pdf`를 유지합니다.
- 긴 PDF는 배치가 끊기지 않도록 최대 20페이지씩 나눠 변환한 뒤 합칩니다.

추가로 `.md` 파일을 업로드해 `gotenberg` 기반으로 PDF로 내려받는 페이지도 포함되어 있습니다.

## Local

```bash
docker compose up --build
```

브라우저에서 `http://localhost:8000` 으로 접속합니다.

- `/` : PDF -> 방향 자동 인식 필기 노트 PDF
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

## Tests

```bash
python -m unittest discover -s tests
PYTHON=python node --test tests/pdf-chunks.test.js
```

가로·세로·혼합·회전·CropBox PDF의 배치와 API 응답을 검증합니다.
브라우저 분할 변환은 PDF 전체를 한 번에 변환한 결과와 페이지 내용·좌표가 같은지도 확인합니다.
