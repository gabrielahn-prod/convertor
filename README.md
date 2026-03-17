# PDF 4P Converter

PDF 파일을 업로드하면 왼쪽에는 슬라이드 2장, 오른쪽에는 모눈 노트 영역이 있는 4P PDF로 변환하는 웹 앱입니다.

## Local

```bash
docker compose up --build
```

브라우저에서 `http://localhost:8000` 으로 접속합니다.

## Vercel

```bash
pip install -r requirements.txt
vercel dev
vercel
```

`public/` 폴더의 정적 파일과 `app.py` Flask 앱을 함께 배포합니다.
Vercel 서버리스 함수 엔트리포인트는 `api/app.py` 입니다.

## API

- `POST /api/convert`
  - form-data 키: `file`
  - PDF 업로드 후 변환된 PDF 파일을 바로 반환
