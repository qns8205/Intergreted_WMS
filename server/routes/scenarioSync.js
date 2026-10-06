// scenario-manager 스크래퍼(sm Scraper, sm-scraper repo 밖에서 실행되는 독립 파이썬 스크립트)가
// objects_by_sid.xlsx에 새로 쌓인 시나리오 행을 이 서버의 scenarios 테이블로 직접 밀어넣을 때 쓰는
// 엔드포인트. 예전에는 이 스크립트가 구글 스프레드시트(Scenario 탭)에 append했고 WMS가 그 시트를
// 읽었지만, WMS가 SQLite로 옮겨오면서 스크래퍼가 이 서버에 직접 쓰도록 바뀌었다.
import { Router } from "express";
import { get, transaction } from "../db.js";
import { requireScraperKey } from "../lib/auth.js";
import { upsertScenarioRows } from "../lib/xlsxImport.js";

export const scenarioSyncRouter = Router();

// 스크래퍼가 "이미 몇 행이 반영됐는지"를 로컬 상태 파일 대신 여기서 확인하고, 그 이후 행만 보낸다
// (재고 카운트 방식은 sheet_sync.py가 구글시트 실제 행 수를 조회하던 것과 동일한 목적).
scenarioSyncRouter.get("/scenarios/sync-status", requireScraperKey, (req, res) => {
  const row = get("SELECT COUNT(*) AS n FROM scenarios");
  res.json({ success: true, count: row?.n ?? 0 });
});

// body: { rows: [[sid, instructionEn, instructionKo, objectId, objectName, quantity], ...] }
// (sid, object_id) 자연 키로 upsert하므로 같은 행을 두 번 보내도 안전하다.
scenarioSyncRouter.post("/scenarios/sync", requireScraperKey, (req, res) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows)) return res.status(400).json({ success: false, error: "rows 배열이 필요합니다." });
  const summary = transaction(() => upsertScenarioRows(rows));
  const countRow = get("SELECT COUNT(*) AS n FROM scenarios");
  res.json({ success: true, ...summary, count: countRow?.n ?? 0 });
});
