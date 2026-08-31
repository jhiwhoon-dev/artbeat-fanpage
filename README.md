# ARTBEAT 팬 페이지

## 로컬에서 실행하기

이 프로젝트를 압축 해제한 폴더에서:

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:4321` 접속하면 확인할 수 있어요.

## 폴더 구조

```
src/
  data/
    members.json      ← xlsx_to_json.py로 변환한 멤버 데이터. 여기만 교체하면 전체 반영됨
  layouts/
    Layout.astro       ← 모든 페이지가 공유하는 뼈대(폰트, 배경, 공통 스타일)
  pages/
    index.astro         ← 홈, 멤버 목록
    members/
      [id].astro         ← 멤버 상세 페이지. getStaticPaths()가 members.json을 읽어서
                            멤버 수만큼 자동으로 페이지를 찍어냅니다 (3명이든 66명이든 코드 수정 불필요)
```

## 데이터 갱신 흐름

1. 엑셀 파일 수정
2. `xlsx_to_json.py` 실행 → `members.json` 재생성
3. 새 `members.json`을 `src/data/members.json`에 덮어쓰기
4. `npm run build` (또는 GitHub에 push하면 자동 배포)

## 빌드 & 배포 (GitHub Pages)

1. `astro.config.mjs`에서 `site`, `base` 값을 본인 저장소에 맞게 채우기
2. `npm run build` → `dist/` 폴더에 정적 파일 생성됨
3. GitHub Pages 설정에서 `dist/` 배포 (또는 GitHub Actions로 자동화 — 다음 단계에서 같이 설정)

## 아직 안 된 것

- 영상 목록 페이지, 채널 역사 페이지
- 멤버 사진 (`photo_filename` 필드는 있지만 실제 이미지 파일/표시 로직 미연결)
- GitHub Actions 배포 자동화
