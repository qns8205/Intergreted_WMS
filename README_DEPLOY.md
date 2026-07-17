# 통합 창고·시나리오 물품 관리 앱

처음부터 새로 짠 통합 React 앱입니다. 기존 WMS의 자재 대여/재고 관리 기능과
BorrowForm.html의 시나리오 물품 대여 기능을 하나로 합쳤습니다.

## 특징
- 의존성 최소화 (Tailwind 제거, React 18 + Vite 5 안정 버전 고정)
- 파일 17개로 구성이 단순함 (기존 저장소의 3D 레이아웃 편집기 등 복잡한 레거시 코드 제외)
- 백엔드는 `Code_unified_v2.gs` 하나면 충분 (BorrowForm.html 불필요)

## 화면 구성 (탭 4개)
1. **창고 재고** — 재고 목록 조회/검색, 물품 등록·수정·삭제 (사진 업로드 포함)
2. **자재 대여·반납** — 재고 물품 대여/반납 신청
3. **불량로그** — 불량 물품 기록 등록/조회 (사진 업로드 포함)
4. **시나리오 대여** — 대여 신청(SID 기반/일반) · 반납 처리 · 내 대여 조회 · SID 검색

## 사전 준비
1. 통합 스프레드시트에 `Code_unified_v2.gs` 내용으로 Apps Script 배포 완료
   (배포 → 새 배포 → 웹 앱 → 실행: 나 / 액세스: 모든 사용자)
2. 배포된 `.../exec` URL 확보

## 로컬 확인 (git/Vercel 이전에 반드시 먼저)
```bash
npm install
npm run build
```
`✓ built in ...` 이 뜨면 정상입니다. 이 단계를 건너뛰지 마세요.

로컬에서 직접 화면을 보고 싶다면:
```bash
npm run dev
```

## Vercel 배포

### 방법 1 — Vercel CLI (가장 안전, git 불필요)
```bash
npm install -g vercel
vercel --prod
```

### 방법 2 — GitHub 연동
```bash
git init
git add .
git commit -m "초기 커밋"
git branch -M main
git remote add origin <새 GitHub 저장소 URL>
git push -u origin main
```
그 다음 Vercel 대시보드에서 Add New → Project → 이 저장소 선택 → Deploy.
Framework Preset은 Vite로 자동 감지됩니다. Build/Output 설정은 기본값 그대로 두면 됩니다.

## 배포 후 확인
1. 배포된 URL 접속
2. 상단 입력창에 GAS `.../exec` URL 입력 → 연동
3. 탭 4개가 전부 데이터를 불러오는지 확인
