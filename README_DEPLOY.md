# 배포 가이드 (우분투 미니 PC, Node.js + SQLite 로컬 백엔드)

Google Apps Script/Google Sheets 연동은 완전히 제거되었습니다. 프론트엔드(React + Vite)와 백엔드(Express + SQLite, `server/`)가 같은 프로세스에서 서빙되는 단일 앱입니다.

## 아키텍처

- `server/index.js` — Express 서버. `/api/*` REST API, `/uploads/*` 이미지 정적 서빙, 그 외 경로는 `dist/`(빌드된 프론트엔드)를 서빙합니다.
- `server/db.js` — Node 내장 `node:sqlite` 모듈 사용 (네이티브 빌드 불필요, `server/schema.sql`을 시작 시 idempotent하게 적용).
- 개발 중에는 `npm run dev`(Vite, 3000번 포트)와 `npm run server`(Express, 3001번 포트)를 각각 띄우면 `vite.config.ts`의 프록시 설정으로 `/api`, `/uploads`가 자동 연결됩니다.
- 배포 시에는 `npm run build` 후 `npm run server` 하나만 실행하면 됩니다 (기본 3001번 포트, `PORT` 환경변수로 변경 가능).

## 최초 설치 (미니 PC, 우분투)

```bash
# Node.js LTS 설치 (배포판에 따라 nodesource 스크립트 등 사용)
node -v   # 22 이상 권장 (node:sqlite 사용)

git clone <이 저장소>
cd Intergreted_WMS
npm install
npm run build
```

## 초기 데이터 적재 (xlsx → SQLite)

기존 `통합 시트.xlsx`로 최초 1회 데이터를 적재합니다:

```bash
node server/scripts/import-xlsx.js "/path/to/통합 시트.xlsx"
```

이후에는 앱의 관리자 화면 → **연결 설정 → xlsx 임포트** 탭에서 동일한 작업을 웹 UI로 반복 실행할 수 있습니다 (SQLite 데이터 전체를 xlsx 기준으로 덮어씀, 이미 업로드된 이미지는 보존).

## 상시 구동 (systemd)

`deploy/wms.service` 참고 — 설치 경로를 환경에 맞게 조정한 뒤(운영 서버는 `WMS_DB_PATH`를 지정하지 않아 기본 경로 `server/data/db.sqlite3`, 즉 `/home/configds/wms/server/data/db.sqlite3`를 쓴다):

```bash
sudo cp deploy/wms.service /etc/systemd/system/wms.service
sudo systemctl daemon-reload
sudo systemctl enable --now wms
sudo systemctl status wms
```

## 접속 — 사내망 IP

`http://192.168.100.152:3000/` 로만 접속한다. 같은 사내망이면 어느 층에서든 열린다.

## 이 PC에서 업데이트 배포

이 개발 PC에는 운영 서버가 허용한 전용 키(`%USERPROFILE%\.ssh\wms_deploy`)가 설정되어
있습니다. 비밀번호를 파일에 저장하거나 입력하지 않고 다음 명령으로 빌드, 전송, 운영 자산
확인까지 한 번에 수행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\publish.ps1
```

**외부 공개(Tailscale Funnel)는 2026-09-07에 접었다.** 개인 테일넷과 회사 테일넷의 Split DNS가
충돌해 전사 장애를 냈던 이력이 있고, Funnel은 로그인 없이 열리는 페이지까지 인터넷에 드러낸다.
경위와 정리 내역, 나중에 테일넷을 다시 붙일 때의 주의점은 `deploy/access.md` 에 적어뒀다.

## 정기 백업

`deploy/backup-cron.md` 참고 — Node `node:sqlite`의 `backup()`으로 서비스를 멈추지 않고 DB를 백업합니다(서버에는 `sqlite3` CLI가 없습니다).

## 로컬 개발 확인

```bash
npm run dev      # 터미널 1: Vite dev server (3000)
npm run server   # 터미널 2: Express API 서버 (3001)
```

`http://localhost:3000` 접속. `npm run lint`(tsc --noEmit)로 타입 에러 여부도 확인하세요.
