# Vercel 배포 안내

## 이 프로젝트에 대해
기존 Warehouse-Management-System(GitHub 원본)에 "시나리오 물품 대여" 기능을 통합한 버전입니다.
백엔드는 통합 스프레드시트에 배포된 Apps Script 웹앱(Code.gs) 하나만 있으면 됩니다.
(BorrowForm.html은 더 이상 사용하지 않습니다.)

## 사전 준비
1. 통합 스프레드시트에 Code.gs 배포 완료 (배포 → 새 배포 → 웹 앱 → 액세스: 모든 사용자)
2. 배포된 `.../exec` URL 확보

## Vercel 배포 방법

### 방법 A — Vercel 웹 대시보드에서 새 프로젝트로 배포 (Git 연동 없이)
1. https://vercel.com 로그인
2. "Add New..." → "Project" → "Deploy without Git" 또는 로컬 폴더를 GitHub 새 저장소에 먼저 push
3. Framework Preset: **Vite** (자동 감지됨)
4. Build Command: `npm run build` (기본값 그대로)
5. Output Directory: `dist` (기본값 그대로)
6. Install Command: `npm install` (기본값 그대로)
7. Deploy 클릭

### 방법 B — 기존 GitHub 저장소에 push해서 자동 배포 (기존 Vercel 프로젝트가 이미 연결돼 있는 경우)
```bash
# 압축 푼 폴더 내용을 기존 로컬 git 저장소에 덮어쓰기
git add .
git commit -m "시나리오 물품 대여 기능 통합"
git push
```
Vercel이 push를 감지해서 자동으로 재배포합니다.

### 방법 C — Vercel CLI로 직접 배포
```bash
npm install -g vercel
cd Warehouse-Management-System-main
vercel --prod
```

## 배포 후 확인
1. 배포된 사이트 접속 → 랜딩 페이지
2. "구글 시트 연동하기" 클릭 → GAS `.../exec` URL 입력
3. 랜딩 화면의 세 카드 확인:
   - 📋 자재 대여 및 반납 (기존 WMS 기능)
   - 🎬 시나리오 물품 대여 (신규 통합 기능)
   - 관리자 모드 (창고 재고 현황/레이아웃 편집 등)

## 참고
- `GEMINI_API_KEY`, `APP_URL` 등 `.env.example`에 있는 값들은 이 프로젝트에서 실사용되지 않는
  템플릿 잔재입니다. 설정하지 않아도 정상 동작합니다.
- 빌드 결과 JS 번들이 500KB를 넘는다는 경고가 뜰 수 있는데, 기능상 문제는 없습니다
  (코드 스플리팅 최적화는 추후 과제로 남겨둔 상태).
