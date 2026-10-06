# 📦 WMS 스마트 재고 & 대여/반납 관리 시스템

React + Vite 프론트엔드와 로컬 Node.js(Express) + SQLite 백엔드로 동작하는 통합 웹 애플리케이션입니다. 창고 재고 관리, 랙/구역 레이아웃 편집, 자재 대여·반납, 불량 로그, SID 기반 시나리오 물품 대여 시스템을 제공합니다. Google Sheets/Apps Script 의존성은 없습니다 — 데이터는 우분투 미니 PC에 상주하는 로컬 SQLite 파일에 저장됩니다.

## 주요 기능

1. **재고 관리** — 랙/구역별 창고 물품 조회·검색·등록·수정·삭제, 이미지 업로드(원본 1600px + 300px 썸네일 자동 생성)
2. **랙 레이아웃 편집기** — 드래그 앤 드롭, 회전, 크기 조절이 가능한 2D 창고 배치도
3. **대여·반납 시스템** — 창고 물품 대여/반납/소모 처리, 재고 자동 증감, 대여로그 자동 기록
4. **시나리오(SID) 물품 대여** — SID 기반 대여, 일반 대여, 반납 처리, 내 대여 조회, 전체 대여 대장 조회
5. **불량 로그** — 불량 자재 등록 및 조회 (사진 업로드 포함)
6. **관리자 설정 화면** — Admin 계정 CRUD, 페널티 CRUD, xlsx 업로드로 SQLite 전체 재적재

## 아키텍처

```
server/         Express 백엔드 (REST API, 이미지 업로드/썸네일, xlsx 임포트)
  index.js        서버 엔트리 — /api, /uploads, 그리고 dist/ 정적 서빙
  db.js            node:sqlite 연결 + 스키마 초기화
  schema.sql        SQLite 테이블 정의
  routes/           기능별 라우터 (inventory, borrow, admin, ...)
  lib/              이미지 처리, xlsx 임포트, 인증
src/            React + Vite 프론트엔드
  App.tsx           메인 애플리케이션 프레임
  lib/apiClient.ts  로컬 API 호출 래퍼
  components/       화면별 컴포넌트
  utils/borrowApi.ts 대여 시스템 API 헬퍼
```

## 로컬 개발

```bash
npm install

# 터미널 1: 프론트엔드 dev 서버 (3000)
npm run dev

# 터미널 2: 백엔드 API 서버 (3001) — vite.config.ts 프록시로 /api, /uploads 연결됨
npm run server
```

`http://localhost:3000` 접속. 최초 실행 시 `통합 시트.xlsx`로 데이터를 적재하려면:

```bash
node server/scripts/import-xlsx.js "/path/to/통합 시트.xlsx"
```

## 배포

우분투 미니 PC에 systemd로 상시 구동하는 배포 절차는 [README_DEPLOY.md](README_DEPLOY.md)와 `deploy/` 디렉터리를 참고하세요. 접속은 사내망 IP(`http://192.168.100.152:3000/`)로만 하며, 외부 공개는 하지 않습니다([deploy/access.md](deploy/access.md)).

## 프로젝트 구조

```
├── package.json
├── vite.config.ts
├── server/                 백엔드 (위 아키텍처 참고)
├── deploy/                 systemd unit, Tailscale, 백업 cron 문서
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── types.ts
    ├── lib/apiClient.ts
    ├── components/
    └── utils/
```

## 관리 팁

- **사진 업로드**: 물품 편집 화면에서 파일을 선택하면 브라우저에서 리사이즈 후 서버로 전송되고, 서버가 원본/썸네일 webp 파일을 생성해 `/uploads/...` 경로로 저장합니다.
- **재고 동기화**: 대여/반납/소모 처리 시 즉시 `warehouse_items.stock`이 갱신되고 `warehouse_rental_logs`에 기록이 남습니다.
- **관리자 계정 추가**: 관리자 화면 → 연결 설정 → Admin 계정 탭에서 추가/삭제할 수 있습니다 (비밀번호는 서버에서 bcrypt로 해시되어 저장됩니다).
