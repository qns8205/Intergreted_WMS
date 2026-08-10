// AppsScript_Code.gs
// 이 코드를 구글 스프레드시트의 [확장 프로그램] -> [Apps Script]에 붙여넣고 웹앱으로 배포하세요.

const DEFECT_SHEET_NAME = "불량로그";
const RENT_SHEET_NAME = "창고물품 대여로그"; // (통합 시트) 기존 "대여로그"
const USERS_SHEET_NAME = "Admin"; // (통합 시트) 기존 "Users" — ID와 패스워드가 저장될 시트 탭 이름입니다.

// ─────────────────────────────────────────────────────────────
// 사진 업로드 폴더 ID 설정 (한 곳에서 관리)
// 기존 사진들이 있는 폴더와 새 업로드가 같은 폴더로 가도록, 여기서 폴더 ID를 맞추세요.
// 스크립트 속성(Script Properties)에 같은 이름의 키가 있으면 그 값이 우선 적용됩니다.
//   - INVENTORY_IMAGE_FOLDER_ID : 창고물품 사진 폴더
//   - DEFECT_IMAGE_FOLDER_ID    : 불량 제품 사진 폴더
// ─────────────────────────────────────────────────────────────
var INVENTORY_IMAGE_FOLDER_ID_DEFAULT = "1YsDpExU4ojeOJM5EiL07cveZs7Ojtasz";
var DEFECT_IMAGE_FOLDER_ID_DEFAULT = "1gs7NcJWgFY37OZ4aEuG6Z-PNlmAfz6_R";

function getFolderIdSetting_(key, fallback) {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(key);
    if (v && String(v).trim()) return String(v).trim();
  } catch (e) {}
  return fallback;
}
function getInventoryImageFolderId_() {
  return getFolderIdSetting_("INVENTORY_IMAGE_FOLDER_ID", INVENTORY_IMAGE_FOLDER_ID_DEFAULT);
}
function getDefectImageFolderId_() {
  return getFolderIdSetting_("DEFECT_IMAGE_FOLDER_ID", DEFECT_IMAGE_FOLDER_ID_DEFAULT);
}

// 스마트 시트 찾기 함수: "관리시트", "시트1", "Sheet1" 순서로 시트를 시도하고,
// 검색어가 매칭되는 시트가 없으면 첫 번째 시트를 자동으로 매칭하여 오류를 예방합니다.
function getInventorySheet(ss) {
  if (!ss) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) return null;
  
  // 0. (통합 시트) "창고물품" 검색
  var sheet = ss.getSheetByName("창고물품");
  if (sheet) return sheet;

  // 1. "관리시트" 검색
  sheet = ss.getSheetByName("관리시트");
  if (sheet) return sheet;
  
  // 2. "시트1" 검색
  sheet = ss.getSheetByName("시트1");
  if (sheet) return sheet;
  
  // 3. "Sheet1" 검색
  sheet = ss.getSheetByName("Sheet1");
  if (sheet) return sheet;
  
  // 4. "재고", "인벤토리", "물품", "관리", "품목", "inventory" 단어가 들어간 시트 찾기
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName().toLowerCase();
    if (name.indexOf("재고") !== -1 || name.indexOf("인벤토리") !== -1 || 
        name.indexOf("물품") !== -1 || name.indexOf("관리") !== -1 || 
        name.indexOf("품목") !== -1 || name.indexOf("inventory") !== -1) {
      return sheets[i];
    }
  }
  
  // 5. 첫 번째 시트 반환
  if (sheets.length > 0) {
    return sheets[0];
  }
  return null;
}

function doGet(e) {
  try {
    const action = e && e.parameter && e.parameter.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getInventorySheet(ss);
    if (!sheet) {
      return responseJSON({ success: false, error: "스프레드시트에서 데이터를 저장/조회할 시트 탭을 찾을 수 없습니다. 시트가 비어있는지 확인하세요." });
    }
    
    // 대여/반납 외부인용 웹 신청 폼 (파라미터가 없거나 action이 비어있으면 이 HTML 페이지를 띄워줍니다)
    if (!action) {
      return serveExternalForm(ss, sheet);
    }
    
    // 불량로그 시트 가져오거나 없으면 자동 생성
    let defectSheet = ss.getSheetByName(DEFECT_SHEET_NAME);
    if (!defectSheet) {
      defectSheet = ss.insertSheet(DEFECT_SHEET_NAME);
      defectSheet.getRange(1, 1, 1, 8).setValues([["제품명", "개수", "기록 시간", "불량 유형", "세부 사항", "대처 방안", "사진", "파손자"]]);
    }
    
    // 대여로그 시트 가져오거나 없으면 자동 생성
    let rentSheet = ss.getSheetByName(RENT_SHEET_NAME);
    if (!rentSheet) {
      rentSheet = ss.insertSheet(RENT_SHEET_NAME);
      rentSheet.getRange(1, 1, 1, 7).setValues([["기록 시간", "구분", "위치", "제품명", "수량", "대여자 성함", "메모"]]);
    }
    
    if (action === "getAll") {
      // 성능 최적화: 짧은 시간(4초) 내 반복 요청은 캐시된 응답을 그대로 반환한다.
      // (여러 화면이 동시에 마운트되며 getAll을 중복 호출하는 경우, 매번 시트 전체를
      //  다시 읽지 않고 캐시를 재사용해 체감 속도를 크게 높인다. 새로고침/재접속 시에는
      //  캐시 만료 후 최신 데이터를 다시 읽으므로 데이터 정확성에 지장이 없다.)
      // forceRefresh=1이면(관리자가 새로고침 버튼을 직접 눌렀을 때) 이 캐시도 무시한다 —
      // 시트를 스크립트 바깥 경로(수동 편집 등)로 바꾼 경우를 위한 안전장치.
      var forceRefreshAll = e.parameter.forceRefresh === "1";
      if (!forceRefreshAll) {
        try {
          var cache = CacheService.getScriptCache();
          var cached = cache.get("getAll_cache_v2");
          if (cached) {
            return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);
          }
        } catch (cacheErr) { /* 캐시 조회 실패 시 그냥 아래로 진행 */ }
      }

      const inventory = getInventoryData(sheet);
      const sectors = getSectorLayout();
      const users = getUsersData(ss);
      const defectLogs = getDefectLogs(defectSheet);
      const rentLogs = getRentLogs(rentSheet);
      let robotObjects = [];
      try {
        robotObjects = getRobotObjects(ss);
      } catch (err) {
        // '로봇 오브젝트' 시트가 없거나 오류 시 빈 배열
      }
      var getAllPayload = JSON.stringify({
        success: true,
        inventory: inventory,
        sectors: sectors,
        users: users,
        defectLogs: defectLogs,
        rentLogs: rentLogs,
        robotObjects: robotObjects
      });
      try {
        CacheService.getScriptCache().put("getAll_cache_v2", getAllPayload, 4);
      } catch (cachePutErr) { /* 캐시 저장 실패해도 응답은 정상 반환 */ }
      return ContentService.createTextOutput(getAllPayload).setMimeType(ContentService.MimeType.JSON);
    }
    
    // ─────────────── 대여 시스템(구 BorrowForm) GET 액션 ───────────────
    if (action === "getObjectItems") {
      return responseJSON({ success: true, items: getObjectItems() });
    }
    if (action === "getScenarioObjectsForAdmin") {
      return responseJSON({ success: true, items: getScenarioObjectsForAdmin_(e.parameter.forceRefresh === "1") });
    }
    if (action === "getScenarioDefinition") {
      // 이 조회는 시트를 무겁게 읽는 작업이라, 짧은 캐시로 반복 요청 부담을 크게 줄인다.
      var rawSid = "";
      if (e && e.parameter) {
        rawSid = e.parameter.scenarioId || e.parameter.sid || "";
      }
      var sidKey = "scenarioDef_" + normalizeSid_(rawSid);
      try {
        var cachedScenario = CacheService.getScriptCache().get(sidKey);
        if (cachedScenario) {
          return ContentService.createTextOutput(cachedScenario).setMimeType(ContentService.MimeType.JSON);
        }
      } catch (scCacheErr) { /* 캐시 조회 실패 시 그냥 아래로 진행 */ }

      var scenarioPayload = JSON.stringify({ success: true, scenario: getScenarioDefinition(rawSid) });
      try { CacheService.getScriptCache().put(sidKey, scenarioPayload, 20); } catch (scCachePutErr) { /* 무시 */ }
      return ContentService.createTextOutput(scenarioPayload).setMimeType(ContentService.MimeType.JSON);
    }
    if (action === "getUnreturnedItems") {
      return responseJSON({ success: true, items: getUnreturnedItems(e.parameter.forceRefresh === "1") });
    }
    if (action === "getLeastBorrowedItems") {
      return responseJSON({ success: true, items: getLeastBorrowedItems_(ss, Number(e.parameter.limit) || 20) });
    }
    if (action === "getBatchDetail") {
      return responseJSON({ success: true, items: getBatchDetail_(ss, e.parameter.batchId) });
    }
    if (action === "getWarehouseLogs") {
      var whLogsAll = getWarehouseLogs_(ss, Number(e.parameter.recentDays) || 0);
      var whPeopleLimit = Number(e.parameter.peopleLimit) || 0;
      if (whPeopleLimit > 0) {
        var whPaged = paginateLogsByPeople_(whLogsAll, function (it) { return it.user; }, Number(e.parameter.peopleOffset) || 0, whPeopleLimit);
        return responseJSON({ success: true, items: whPaged.items, hasMore: whPaged.hasMore, totalPeople: whPaged.totalPeople });
      }
      return responseJSON({ success: true, items: whLogsAll });
    }
    if (action === "getScenarioAllLogs") {
      // recentDays: "미반납 전체 + 최근 N일 내 반납분"만 (관리자 화면 로딩 단축)
      // scope: unreturned | returned | all — 미반납만 먼저 빨리 내려보내고 반납분은 뒤이어 받게 한다
      // slim: 1이면 화면에서 쓰지 않는 필드(사진/재고/대여중)를 빼서 전송량을 줄인다
      // peopleOffset/peopleLimit: 주어지면 "건수"가 아니라 "사람 수" 기준으로 잘라서 내려준다
      //   (getScenarioAllLogs_ 자체는 그대로 전체를 계산해 120초 캐시하므로, 반복되는
      //   "더보기" 요청은 캐시를 재사용해 빠르다 — 잘라내는 연산만 매번 새로 한다)
      var scenarioLogsAll = getScenarioAllLogs_(
        Number(e.parameter.recentDays) || 0,
        String(e.parameter.scope || "all"),
        String(e.parameter.slim || "") === "1"
      );
      var scPeopleLimit = Number(e.parameter.peopleLimit) || 0;
      if (scPeopleLimit > 0) {
        var scPaged = paginateLogsByPeople_(scenarioLogsAll, function (it) { return it.borrowerName; }, Number(e.parameter.peopleOffset) || 0, scPeopleLimit);
        return responseJSON({ success: true, items: scPaged.items, hasMore: scPaged.hasMore, totalPeople: scPaged.totalPeople });
      }
      return responseJSON({ success: true, items: scenarioLogsAll });
    }
    if (action === "getMyBorrowedItems") {
      return responseJSON({ success: true, items: getMyBorrowedItems(e.parameter.name, e.parameter.employeeId) });
    }
    if (action === "isConfigDsRegistered") {
      return responseJSON({ success: true, registered: isConfigDsRegistered(e.parameter.name) });
    }
    if (action === "getBorrowAppInfo") {
      return responseJSON({ success: true, version: APP_VERSION });
    }
    if (action === "getWarehouseBorrowedItems") {
      return responseJSON({ success: true, items: getWarehouseBorrowedItems_(e.parameter.name || "") });
    }
    if (action === "getWarehouseInventoryOnly") {
      return responseJSON({ success: true, inventory: getInventoryData(sheet) });
    }
    if (action === "getStockChangeHistory") {
      return responseJSON({ success: true, items: getStockChangeHistory_(ss, e.parameter.category, e.parameter.id, e.parameter.name) });
    }
    if (action === "getItemSets") {
      return responseJSON({ success: true, sets: getItemSets_(ss) });
    }
    if (action === "getSeatMap") {
      return responseJSON({ success: true, map: getSeatMap_(ss) });
    }
    if (action === "getSeatOccupancy") {
      return responseJSON({ success: true, items: getSeatOccupancy_(ss, e.parameter.floor, e.parameter.unit, e.parameter.shift) });
    }
    if (action === "getBorrowLock") {
      return responseJSON({ success: true, lock: getBorrowLock_() });
    }
    if (action === "getNotice") {
      // 하위호환: 첫 번째 공지만 돌려준다
      var firstNotice = getNotices_(ss)[0] || { title: "", text: "", updatedAt: "", author: "" };
      return responseJSON({ success: true, notice: firstNotice, notices: getNotices_(ss) });
    }
    if (action === "getNotices") {
      return responseJSON({ success: true, items: getNotices_(ss) });
    }
    if (action === "getPenalties") {
      return responseJSON({ success: true, items: getActivePenalties_(ss) });
    }
    if (action === "getActiveItemTypeCount") {
      // apiGet이 success 플래그를 검사하므로 반드시 함께 내려보낸다.
      var activeTypeResult = getActiveItemTypeCount_(e.parameter.name);
      // 예외 유닛(∞) 판정도 서버가 내려준다. 화면과 서버가 각자 판단하면 서로 어긋난다.
      activeTypeResult.exempt = isExemptSeat_(ss, e.parameter.floor, e.parameter.unit);
      activeTypeResult.success = true;
      return responseJSON(activeTypeResult);
    }
    if (action === "getStockAuditHistory") {
      return responseJSON({ success: true, items: getStockAuditHistory_(ss, e.parameter.itemId) });
    }
    if (action === "getStockFormulaStatus") {
      return responseJSON({ success: true, status: getStockFormulaStatus_(ss, e.parameter.itemId) });
    }

    return responseJSON({ success: false, error: "알 수 없는 GET 액션입니다." });
  } catch (err) {
    return responseJSON({ success: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const requestData = JSON.parse(e.postData.contents);
    const action = requestData.action;
    const payload = requestData.payload;

    // ─────────────── 스크래퍼 하위 호환 (action 없이 sid+items가 오면 Scenario 시트 upsert) ───────────────
    if (!action && requestData.sid && Array.isArray(requestData.items)) {
      return handleScenarioUpsertPost_(requestData);
    }

    // ─────────────── 대여 시스템(구 BorrowForm) POST 액션 ───────────────
    if (action === "recordBorrow") {
      const recordBorrowResult = recordBorrow(payload.borrowList, payload.clientVersion);
      invalidateGetAllCache_();
      invalidateLogCaches_();
      return responseJSON(recordBorrowResult);
    }
    if (action === "sendReturnReminderDm") {
      return responseJSON(sendReturnReminderDm_(payload));
    }
    if (action === "setBorrowLock") {
      return responseJSON(setBorrowLock_(payload));
    }
    if (action === "saveNotice") {
      return responseJSON(saveNotice_(ss, payload));
    }
    if (action === "saveNotices") {
      return responseJSON(saveNotices_(ss, payload));
    }
    if (action === "publishAppVersion") {
      return responseJSON(publishAppVersionFromClient_());
    }
    if (action === "swapBorrowItem") {
      const swapResult = swapBorrowItem_(ss, payload);
      invalidateGetAllCache_();
      invalidateLogCaches_();
      return responseJSON(swapResult);
    }
    if (action === "processReturn") {
      const processReturnResult = processReturn(payload.returnRequests, payload.clientVersion);
      invalidateGetAllCache_();
      invalidateLogCaches_();
      return responseJSON(processReturnResult);
    }
    if (action === "confirmPickup") {
      // 대여 실물 확인(체크) 완료 — SID대여는 M열, 일반대여는 N열에 확인 시각을 적는다.
      const confirmPickupResult = confirmPickup_(payload.items);
      invalidateGetAllCache_();
      invalidateLogCaches_();
      return responseJSON(confirmPickupResult);
    }
    if (action === "upsertScenario") {
      return handleScenarioUpsertPost_(payload);
    }
    if (action === "updateScenarioObject") {
      var scObjResult = updateScenarioObject_(payload);
      invalidateLogCaches_();
      return responseJSON({ success: true, item: scObjResult });
    }
    if (action === "addScenarioObject") {
      var scObjResult = addScenarioObject_(payload);
      invalidateLogCaches_();
      return responseJSON({ success: true, item: scObjResult });
    }
    if (action === "deleteScenarioObject") {
      deleteScenarioObject_(payload.rowIndex);
      invalidateLogCaches_();
      return responseJSON({ success: true });
    }
    if (action === "adjustStock") {
      var adjustResult = adjustStock_(ss, payload);
      invalidateLogCaches_();
      return responseJSON(adjustResult);
    }
    if (action === "saveItemSet") {
      return responseJSON(saveItemSet_(ss, payload));
    }
    if (action === "deleteItemSet") {
      return responseJSON(deleteItemSet_(ss, payload));
    }
    if (action === "saveSeatMap") {
      return responseJSON(saveSeatMap_(ss, payload));
    }
    if (action === "recordStockAudit") {
      return responseJSON(recordStockAudit_(ss, payload));
    }
    const sheet = getInventorySheet(ss);
    if (!sheet) {
      return responseJSON({ success: false, error: "스프레드시트에서 데이터를 저장/조회할 시트 탭을 찾을 수 없습니다. 시트가 비어있는지 확인하세요." });
    }
    
    if (action === "addInventoryItem") {
      const newRowIndex = addInventoryItem(sheet, payload);
      invalidateGetAllCache_();
      return responseJSON({ success: true, rowIndex: newRowIndex });
    }
    
    if (action === "updateInventoryItem") {
      updateInventoryItem(sheet, payload);
      invalidateGetAllCache_();
      return responseJSON({ success: true });
    }

    if (action === "updateMultipleInventoryItems") {
      const items = payload.items;
      if (items && Array.isArray(items)) {
        for (let i = 0; i < items.length; i++) {
          updateInventoryItem(sheet, items[i]);
        }
      }
      invalidateGetAllCache_();
      return responseJSON({ success: true });
    }
    
    if (action === "deleteInventoryItem") {
      deleteInventoryItem(sheet, payload.rowIndex);
      invalidateGetAllCache_();
      return responseJSON({ success: true });
    }
    
    if (action === "saveSectorLayout") {
      saveSectorLayout(payload.sectors);
      return responseJSON({ success: true });
    }
    
    if (action === "deleteSector") {
      deleteSector(payload.sectorId);
      return responseJSON({ success: true });
    }

    if (action === "addDefectLog") {
      let defectSheet = ss.getSheetByName(DEFECT_SHEET_NAME);
      if (!defectSheet) {
        defectSheet = ss.insertSheet(DEFECT_SHEET_NAME);
        defectSheet.getRange(1, 1, 1, 8).setValues([["제품명", "개수", "기록 시간", "불량 유형", "세부 사항", "대처 방안", "사진", "파손자"]]);
      }
      const result = addDefectLog(defectSheet, payload);

      // 로봇(시나리오) 오브젝트의 불량만 재고를 차감한다.
      // 랙 선반 공구 및 부품류(itemCategory === "rack")는 어떤 경우에도 재고를 건드리지 않는다.
      var stockAdjusted = null;
      if (payload && payload.itemCategory === "robot" && payload.itemId) {
        var defectQty = Number(payload.qty);
        if (defectQty > 0) {
          stockAdjusted = decrementScenarioObjectStock_(payload.itemId, defectQty);
          if (stockAdjusted) {
            logStockChange_(ss, "시나리오 물품", stockAdjusted.itemId, payload.name || "",
              stockAdjusted.before, stockAdjusted.after,
              "불량 신고로 인한 소모 처리" + (payload.defectType ? " (" + payload.defectType + ")" : ""),
              payload.culprit || "-");
          }
        }
      }

      invalidateGetAllCache_();
      if (stockAdjusted) invalidateLogCaches_(); // 재고가 바뀌었으니 관련 캐시도 같이 비운다
      return responseJSON({ success: true, rowIndex: result.rowIndex, photo: result.photo, stockAdjusted: stockAdjusted });
    }

    // 여러 건을 한 번의 요청으로 처리한다.
    // 예전에는 프론트가 건수만큼 동시에 요청을 보내 같은 시트에 동시 쓰기가 발생했고,
    // 잠금 충돌로 실패하거나 재고 갱신이 서로를 덮어쓰는 문제가 있었다.
    if (action === "rentInventoryItemsBulk") {
      var bulkItems = (payload && payload.items) || [];
      if (!bulkItems.length) return responseJSON({ success: false, error: "처리할 항목이 없습니다." });

      // 대여 잠금 중에는 대여/소모를 막는다 (반납은 허용)
      var hasBorrowRow = false;
      for (var lk = 0; lk < bulkItems.length; lk++) {
        var t = String(bulkItems[lk].type || "");
        if (t === "대여" || t === "소모") { hasBorrowRow = true; break; }
      }
      if (hasBorrowRow) {
        var bulkLockMsg = borrowLockMessage_();
        if (bulkLockMsg) return responseJSON({ success: false, error: bulkLockMsg, message: bulkLockMsg });
      }

      var bulkLock = LockService.getScriptLock();
      try { bulkLock.waitLock(30000); } catch (lockErr) {
        return responseJSON({ success: false, error: "다른 작업이 진행 중입니다. 잠시 후 다시 시도해주세요." });
      }
      try {
        var bulkSheet = getInventorySheet(ss);
        if (!bulkSheet) return responseJSON({ success: false, error: "창고물품 시트를 찾을 수 없습니다." });
        var bulkRentSheet = ss.getSheetByName(RENT_SHEET_NAME);
        if (!bulkRentSheet) {
          bulkRentSheet = ss.insertSheet(RENT_SHEET_NAME);
          bulkRentSheet.getRange(1, 1, 1, 7).setValues([["기록 시간", "구분", "위치", "제품명", "수량", "대여자 성함", "메모"]]);
        }

        // 로그는 한 번에 append, 재고는 시트를 한 번만 읽고 바뀐 행만 쓴다.
        var okCount = 0, failed = [];
        var logRows = [];
        var nowStr = formatDate(new Date());

        var invLastRow = bulkSheet.getLastRow();
        var invN = Math.max(0, invLastRow - 1);
        var invVals = invN ? bulkSheet.getRange(2, 1, invN, 5).getValues() : [];
        var invIndex = {};
        for (var ii = 0; ii < invN; ii++) {
          var keyLoc = String(invVals[ii][0]).trim() + "||" + String(invVals[ii][2]).trim();
          if (invIndex[keyLoc] === undefined) invIndex[keyLoc] = ii;
        }
        var touched = {};

        for (var bi = 0; bi < bulkItems.length; bi++) {
          var it = bulkItems[bi] || {};
          try {
            var ts = it.timestamp || nowStr;
            logRows.push([
              String(ts).indexOf("'") === 0 ? ts : "'" + ts,
              it.type || "대여",
              it.location || "",
              it.name || "",
              (it.qty === "" || it.qty == null) ? 0 : Number(it.qty),
              it.user || "",
              it.note || ""
            ]);

            var idx = invIndex[String(it.location || "").trim() + "||" + String(it.name || "").trim()];
            if (idx !== undefined) {
              var rawStock = invVals[idx][4];
              var isNaValue = rawStock === "" || rawStock === null || rawStock === undefined
                || rawStock === "N/A" || isNaN(Number(rawStock));
              if (!isNaValue) {
                var cur = Number(rawStock || 0);
                var chg = Number(it.qty || 0);
                var nextStock = cur;
                if (it.type === "대여" || it.type === "소모") nextStock = Math.max(0, cur - chg);
                else if (it.type === "반납" && String(it.note || "").indexOf("[소모완료]") !== -1) nextStock = cur;
                else if (it.type === "반납") nextStock = cur + chg;
                invVals[idx][4] = nextStock; // 같은 물품이 여러 건이어도 누적된다
                touched[idx] = true;

                // 소모는 재고가 실제로 영구히 줄어드는 것이므로 재고변경이력에도 정확한
                // 스냅샷(그 시점까지의 누적 반영 전/후 값)으로 남긴다.
                if (it.type === "소모") {
                  logStockChange_(ss, "공구 및 부품류", it.location || "", it.name || "", cur, nextStock,
                    "소모 처리" + (it.note ? " (" + it.note + ")" : ""), it.user || "-");
                }
              }
            }
            okCount++;
          } catch (rowErr) {
            failed.push(String(it.name || "") + ": " + rowErr.message);
          }
        }

        if (logRows.length) {
          bulkRentSheet.getRange(bulkRentSheet.getLastRow() + 1, 1, logRows.length, 7).setValues(logRows);
        }

        // 대여/소모 신청이 들어오면 관리자들에게 DM으로 알린다 (반납은 제외)
        try {
          var notifyRows = bulkItems.filter(function (it) {
            var t = String(it.type || "");
            return t === "대여" || t === "소모";
          });
          if (notifyRows.length) {
            var who = String(notifyRows[0].user || "").trim() || "(이름 없음)";
            var totalQty = 0;
            notifyRows.forEach(function (it) { totalQty += Number(it.qty) || 0; });
            var noteText = String(notifyRows[0].note || "").trim();

            var dmLines = ["🧰 *공구 및 부품류 " + (notifyRows[0].type === "소모" ? "소모" : "대여") + " 신청*"];
            dmLines.push("• 신청자: " + who);
            dmLines.push("• 수량: " + notifyRows.length + "종 / " + totalQty + "개");
            if (noteText) dmLines.push("• 메모: " + noteText);
            dmLines.push("");
            notifyRows.slice(0, 30).forEach(function (it) {
              dmLines.push("• " + (it.location ? "[" + it.location + "] " : "") + String(it.name || "")
                + ((Number(it.qty) || 0) > 1 ? " x " + it.qty : ""));
            });
            if (notifyRows.length > 30) dmLines.push("… 외 " + (notifyRows.length - 30) + "건");

            notifyAdminsDm_(dmLines.join("\n"));
          }
        } catch (dmErr) { Logger.log("공구 대여 DM 실패: " + dmErr.message); }
        Object.keys(touched).forEach(function (k) {
          var r = Number(k) + 2;
          bulkSheet.getRange(r, 5, 1, 2).setValues([[invVals[Number(k)][4], nowStr]]);
        });
        SpreadsheetApp.flush();
        invalidateGetAllCache_();
        invalidateLogCaches_();
        return responseJSON({
          success: failed.length === 0,
          processed: okCount,
          failed: failed,
          error: failed.length ? failed.join(" / ") : ""
        });
      } finally {
        try { bulkLock.releaseLock(); } catch (e) {}
      }
    }

    if (action === "rentInventoryItem") {
      let rentSheet = ss.getSheetByName(RENT_SHEET_NAME);
      if (!rentSheet) {
        rentSheet = ss.insertSheet(RENT_SHEET_NAME);
        rentSheet.getRange(1, 1, 1, 7).setValues([["기록 시간", "구분", "위치", "제품명", "수량", "대여자 성함", "메모"]]);
      }
      const newRowIndex = addRentLog(rentSheet, payload);
      
      // Update inventory stock count
      const lastRow = sheet.getLastRow();
      if (lastRow >= 2) {
        const values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
        for (let i = 0; i < values.length; i++) {
          // Compare location (Col 1) and name (Col 3) to find unique match
          if (String(values[i][0]).trim() === String(payload.location).trim() && 
              String(values[i][2]).trim() === String(payload.name).trim()) {
            const rowIdx = i + 2;
            const rawStock = values[i][4]; // index 4 is Column E (Stock)
            const isNaValue = rawStock === "" || rawStock === null || rawStock === undefined || rawStock === "N/A" || isNaN(Number(rawStock));
            
            let nextStock = rawStock;
            if (!isNaValue) {
              let currentStock = Number(rawStock || 0);
              const qtyChange = Number(payload.qty || 0);
              
              if (payload.type === "대여" || payload.type === "소모") {
                nextStock = Math.max(0, currentStock - qtyChange);
              } else if (payload.type === "반납" && String(payload.note || "").indexOf("[소모완료]") !== -1) {
                // 반납 화면에서 "소모로 처리"한 경우: 대여 시 이미 재고가 차감됐으므로 재고를 다시 늘리지 않는다.
                nextStock = currentStock;
              } else if (payload.type === "반납") {
                nextStock = currentStock + qtyChange;
              }
            }
            
            // Batch update E, F columns in 1 single write (leave G column/manager untouched)
            sheet.getRange(rowIdx, 5, 1, 2).setValues([[
              nextStock === "" || nextStock == null ? "" : nextStock,
              formatDate(new Date())
            ]]);
            break;
          }
        }
      }
      invalidateGetAllCache_();

      // 단건 대여/소모도 관리자에게 알린다 (구버전 화면 호환)
      try {
        var singleType = String(payload.type || "");
        if (singleType === "대여" || singleType === "소모") {
          var qty1 = Number(payload.qty) || 0;
          var lines1 = ["🧰 *공구 및 부품류 " + (singleType === "소모" ? "소모" : "대여") + " 신청*"];
          lines1.push("• 신청자: " + (String(payload.user || "").trim() || "(이름 없음)"));
          lines1.push("• 수량: 1종 / " + qty1 + "개");
          if (String(payload.note || "").trim()) lines1.push("• 메모: " + String(payload.note).trim());
          lines1.push("");
          lines1.push("• " + (payload.location ? "[" + payload.location + "] " : "") + String(payload.name || "") + (qty1 > 1 ? " x " + qty1 : ""));
          notifyAdminsDm_(lines1.join("\n"));
        }
      } catch (dmErr1) { Logger.log("공구 단건 대여 DM 실패: " + dmErr1.message); }

      return responseJSON({ success: true, rowIndex: newRowIndex });
    }
    
    return responseJSON({ success: false, error: "알 수 없는 POST 액션입니다." });
  } catch (err) {
    return responseJSON({ success: false, error: err.toString() });
  }
}

function getUsersData(ss) {
  if (!ss) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) return [];
  let userSheet = ss.getSheetByName(USERS_SHEET_NAME);
  if (!userSheet) {
    // Users 시트가 없다면 기본 어드민 정보로 자동 생성해 줍니다.
    userSheet = ss.insertSheet(USERS_SHEET_NAME);
    userSheet.getRange(1, 1, 1, 4).setValues([["ID", "PASSWORD", "NAME", "Slack 채널 ID"]]);
    userSheet.getRange(2, 1, 1, 3).setValues([["admin", "1234", "관리자"]]);
    SpreadsheetApp.flush();
  }
  
  const lastRow = userSheet.getLastRow();
  if (lastRow < 2) {
    return [{ id: "admin", password: "1234", name: "관리자" }];
  }
  
  const range = userSheet.getRange(2, 1, lastRow - 1, 3);
  const values = range.getValues();
  const users = [];
  
  for (let i = 0; i < values.length; i++) {
    const id = String(values[i][0] || "").trim();
    const password = String(values[i][1] || "").trim();
    const name = String(values[i][2] || "").trim();
    if (id) {
      users.push({ id: id, password: password, name: name || id });
    }
  }
  return users;
}

function getInventoryData(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  // 시트에 11번째 열(한글 검색어)이 없으면 자동 생성해 안전하게 읽는다.
  if (sheet.getMaxColumns() < 11) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 11 - sheet.getMaxColumns());
  }
  // K열 헤더가 비어 있으면 라벨을 넣어준다.
  if (!String(sheet.getRange(1, 11).getValue() || "").trim()) {
    sheet.getRange(1, 11).setValue("검색어(한글)");
  }
  const range = sheet.getRange(2, 1, lastRow - 1, 11);
  const values = range.getValues();
  // 성능 최적화: getRichTextValues()/getDisplayValues()는 셀당 비용이 커서
  // 11개 열 전체가 아니라 실제로 필요한 열(D열=링크, F열=업데이트일자, I열=사진)만 좁혀서 읽는다.
  const linkRichText = sheet.getRange(2, 4, lastRow - 1, 1).getRichTextValues();   // D열 (index 3)
  const updatedAtDisplay = sheet.getRange(2, 6, lastRow - 1, 1).getDisplayValues(); // F열 (index 5)
  const photoRichText = sheet.getRange(2, 9, lastRow - 1, 1).getRichTextValues();   // I열 (index 8)
  const inventory = [];
  
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const rowIndex = i + 2;
    
    // I열 (index 8, 사진 링크용)에서 이미지 주소 추출 (B열은 참고하지 않음)
    let photoUrl = "";
    const photoRich = photoRichText[i] && photoRichText[i][0];
    if (photoRich && typeof photoRich.getLinkUrl === "function") {
      photoUrl = photoRich.getLinkUrl() || "";
      if (!photoUrl && typeof photoRich.getRuns === "function") {
        const runs = photoRich.getRuns();
        for (let r = 0; r < runs.length; r++) {
          if (runs[r] && typeof runs[r].getLinkUrl === "function") {
            const runUrl = runs[r].getLinkUrl();
            if (runUrl) {
              photoUrl = runUrl;
              break;
            }
          }
        }
      }
    }
    if (!photoUrl) {
      photoUrl = String(row[8] || "").trim();
    }
    if (photoUrl === "undefined") {
      photoUrl = "";
    }
    
    // 스마트 칩 링크 주소 추출 (D열 / index 3)
    let itemLink = "";
    const linkRich = linkRichText[i] && linkRichText[i][0];
    if (linkRich && typeof linkRich.getLinkUrl === "function") {
      itemLink = linkRich.getLinkUrl() || "";
      if (!itemLink && typeof linkRich.getRuns === "function") {
        const runs = linkRich.getRuns();
        for (let r = 0; r < runs.length; r++) {
          if (runs[r] && typeof runs[r].getLinkUrl === "function") {
            const runUrl = runs[r].getLinkUrl();
            if (runUrl) {
              itemLink = runUrl;
              break;
            }
          }
        }
      }
    }
    if (!itemLink) {
      itemLink = String(row[3] || "").trim();
    }
    
    let itemStock = null;
    if (String(row[4]).trim().toUpperCase() === "N/A") {
      itemStock = "N/A";
    } else if (row[4] !== "" && !isNaN(Number(row[4]))) {
      itemStock = Number(row[4]);
    }

    inventory.push({
      rowIndex: rowIndex,
      location: String(row[0] || "").trim(),
      photo: photoUrl,
      name: String(row[2] || "").trim(),
      link: itemLink,
      stock: itemStock,
      updatedAt: updatedAtDisplay[i][0] || "",
      manager: String(row[6] || "").trim(),
      note: String(row[7] || "").trim(),
      spec: String(row[1] || "").trim(), // Column B (서브 분류)
      keywords: String(row[10] || "").trim() // Column K (한글 검색어)
    });
  }
  return inventory;
}

function getDefectLogs(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const lastCol = Math.min(Math.max(sheet.getLastColumn(), 7), 8);
  const range = sheet.getRange(2, 1, lastRow - 1, lastCol);
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const logs = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const rawTs = displayValues[i][2] ? String(displayValues[i][2]).trim() : (row[2] instanceof Date ? formatDate(row[2]) : String(row[2] || "").trim());
    const photoUrl = lastCol >= 7 ? String(row[6] || "").trim() : "";
    
    logs.push({
      rowIndex: i + 2,
      timestamp: rawTs.replace(/^'/, ""),
      location: "",
      name: String(row[0] || "").trim(),
      qty: row[1] === "" ? null : Number(row[1]),
      defectType: String(row[3] || "").trim(),
      manager: "",
      note: String(row[4] || "").trim(),
      actionTaken: String(row[5] || "").trim(),
      photo: photoUrl,
      culprit: lastCol >= 8 ? String(row[7] || "").trim() : ""
    });
  }
  return logs;
}

// ── 진단용: 기존 창고물품 사진들이 실제로 어느 드라이브 폴더에 있는지 알려준다.
// Apps Script 편집기에서 이 함수(창고사진폴더찾기)를 직접 실행하면 로그에 폴더 ID가 출력된다.
// 그 값을 스크립트 속성 INVENTORY_IMAGE_FOLDER_ID 에 넣으면 새 업로드도 같은 폴더로 간다.
function 창고사진폴더찾기() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getInventorySheet(ss);
  if (!sheet) { Logger.log("창고물품 시트를 찾지 못했습니다."); return; }
  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(2, 9, Math.max(0, lastRow - 1), 1).getValues(); // I열(사진)
  var counts = {};
  for (var i = 0; i < values.length; i++) {
    var link = String(values[i][0] || "").trim();
    if (!link) continue;
    var id = extractDriveFileId_(link);
    if (!id) continue;
    try {
      var file = DriveApp.getFileById(id);
      var parents = file.getParents();
      while (parents.hasNext()) {
        var f = parents.next();
        var key = f.getId() + " (" + f.getName() + ")";
        counts[key] = (counts[key] || 0) + 1;
      }
    } catch (e) { /* 접근 불가 파일은 건너뜀 */ }
  }
  Logger.log("=== 기존 창고물품 사진이 들어있는 폴더 (많은 순) ===");
  var arr = Object.keys(counts).map(function (k) { return [k, counts[k]]; });
  arr.sort(function (a, b) { return b[1] - a[1]; });
  for (var j = 0; j < arr.length; j++) { Logger.log(arr[j][1] + "개 -> " + arr[j][0]); }
  if (arr.length) {
    var topId = arr[0][0].split(" ")[0];
    Logger.log("\n> 가장 많은 폴더 ID: " + topId);
    Logger.log("  이 값을 스크립트 속성 INVENTORY_IMAGE_FOLDER_ID 에 저장하면 새 업로드도 같은 폴더로 갑니다.");
  } else {
    Logger.log("사진 링크에서 폴더를 확인하지 못했습니다.");
  }
}

// 드라이브 링크에서 파일 ID 추출 (open?id=, /d/ID 등 지원)
function extractDriveFileId_(link) {
  if (!link) return "";
  var m = link.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = link.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return "";
}

function uploadImageToDrive(photoVal, fileName, folderId, fallbackFolderName) {
  if (!photoVal || String(photoVal).indexOf("data:image/") !== 0) {
    return photoVal || "";
  }
  try {
    const parts = photoVal.split(",");
    const mimeType = parts[0].split(";")[0].split(":")[1];
    const base64Data = parts[1];
    const decoded = Utilities.base64Decode(base64Data);
    const ext = mimeType.split("/")[1] || "jpeg";
    
    let folder;
    try {
      folder = DriveApp.getFolderById(folderId);
    } catch (fErr) {
      const folders = DriveApp.getFoldersByName(fallbackFolderName);
      if (folders.hasNext()) {
        folder = folders.next();
      } else {
        folder = DriveApp.createFolder(fallbackFolderName);
      }
    }

    const fullFilename = fileName + "." + ext;
    const blob = Utilities.newBlob(decoded, mimeType, fullFilename);
    
    let file;
    try {
      if (!folder) throw new Error("Folder is null");
      file = folder.createFile(blob);
    } catch (createErr) {
      // If folderId is invalid, deleted, or not a real folder (e.g., throwing parent.mimeType exception),
      // we fallback to creating/locating the fallback folder.
      const folders = DriveApp.getFoldersByName(fallbackFolderName);
      if (folders.hasNext()) {
        folder = folders.next();
      } else {
        folder = DriveApp.createFolder(fallbackFolderName);
      }
      file = folder.createFile(blob);
    }
    
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      try {
        file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (domainShareErr) {
        // Keep private if locked down
      }
    }
    
    return "https://lh3.googleusercontent.com/d/" + file.getId();
  } catch (e) {
    return "업로드 실패: " + e.toString();
  }
}

// 불량 신고된 만큼 "시나리오 오브젝트" 시트의 재고를 차감한다.
// ⚠️ 이 함수는 로봇(시나리오) 오브젝트 전용이다 — 랙 선반 공구 및 부품류(창고물품) 시트는
//    이 함수가 아예 알지도 못하고 절대 건드리지 않는다. 호출하는 쪽(addDefectLog 액션 핸들러)에서도
//    itemCategory === "robot"일 때만 호출하도록 이중으로 막아뒀다.
function decrementScenarioObjectStock_(itemId, qty) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(OBJECT_SHEET_NAME); // "시나리오 오브젝트" — 창고물품 시트가 아니다
  if (!sheet) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  var targetId = padSlot_(String(itemId || "").trim());
  if (!targetId) return null;

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (padSlot_(String(ids[i][0] || "").trim()) !== targetId) continue;
    var rowIndex = i + 2;
    var stockCell = sheet.getRange(rowIndex, 8); // H열: 재고
    if (stockCell.getFormula()) return null; // 재고 열에 수식이 걸려있으면 손대지 않는다 (다른 로직과 동일한 원칙)
    var before = Number(stockCell.getValue()) || 0;
    var after = Math.max(0, before - Number(qty || 0)); // 0 밑으로는 안 내려간다
    stockCell.setValue(after);
    return { itemId: targetId, before: before, after: after, rowIndex: rowIndex };
  }
  return null; // 해당 id를 못 찾으면 아무것도 하지 않는다
}

function addDefectLog(sheet, log) {
  const lastRow = sheet.getLastRow();
  const nextRow = lastRow + 1;
  
  if (sheet.getLastColumn() < 7) {
    sheet.getRange(1, 7).setValue("사진");
  }
  // 파손자 열(H)이 없으면 만들어 둔다
  if (sheet.getLastColumn() < 8 || !String(sheet.getRange(1, 8).getValue() || "").trim()) {
    sheet.getRange(1, 8).setValue("파손자");
  }
  
  // Use original log name exactly as-is (parentheses processing is removed)
  let pName = String(log.name || "알수없음").trim();
  
  // Determine file name format: "제품명_기록 시간_불량 유형"
  const pType = String(log.defectType || "기타불량").trim();
  const rawTs = String(log.timestamp || formatDate(new Date())).replace(/'/g, "").trim();
  const safeTs = rawTs.replace(/[:\/]/g, "-");
  const filename = pName + "_" + safeTs + "_" + pType;

  let photoVal = log.photo || "";
  if (photoVal.indexOf("data:image/") === 0) {
    photoVal = uploadImageToDrive(photoVal, filename, getDefectImageFolderId_(), "Image for Broken Item");
  }
  
  const nowStr = formatDate(new Date());
  const ts = log.timestamp || nowStr;
  const rowValues = [
    pName,
    log.qty === "" || log.qty == null ? "" : Number(log.qty),
    ts.indexOf("'") === 0 ? ts : "'" + ts,
    log.defectType || "",
    log.note || "",
    log.actionTaken || "",
    photoVal
  ];
  
  rowValues.push(String(log.culprit || "").trim()); // H열: 파손자
  sheet.getRange(nextRow, 1, 1, 8).setValues([rowValues]);
  return { rowIndex: nextRow, photo: photoVal };
}

function getRobotObjects(ss) {
  if (!ss) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) return [];
  // (통합 시트) "시나리오 오브젝트"가 기존 "로봇 오브젝트"를 대체 (9열: id~대여)
  const sheet = ss.getSheetByName("시나리오 오브젝트") || ss.getSheetByName("로봇 오브젝트");
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const lastCol = Math.max(sheet.getLastColumn(), 5);
  const range = sheet.getRange(1, 1, lastRow, lastCol); // Row 1 onwards to read headers dynamically
  const values = range.getValues();
  
  // Dynamic header parsing to identify the correct column index for each property
  const headers = values[0].map(function(h) {
    return String(h || "").trim().toLowerCase();
  });
  
  var nameColIdx = -1;
  var idColIdx = -1;
  var locColIdx = -1;
  var specColIdx = -1;
  var noteColIdx = -1;
  
  for (var j = 0; j < headers.length; j++) {
    var h = headers[j];
    if (!h) continue;
    // Look for name/품목명/제품명 column
    if (h === "name" || h.indexOf("품목") !== -1 || h.indexOf("제품") !== -1 || h === "이름" || h === "오브젝트" || h === "명칭") {
      nameColIdx = j;
    } else if (h === "id" || h === "코드" || h === "번호" || h.indexOf("아이디") !== -1) {
      idColIdx = j;
    } else if (h.indexOf("위치") !== -1 || h.indexOf("구역") !== -1 || h.indexOf("장소") !== -1 || h.indexOf("location") !== -1) {
      locColIdx = j;
    } else if (h.indexOf("규격") !== -1 || h.indexOf("서브") !== -1 || h.indexOf("spec") !== -1) {
      specColIdx = j;
    } else if (h.indexOf("비고") !== -1 || h.indexOf("메모") !== -1 || h.indexOf("note") !== -1 || h.indexOf("설명") !== -1) {
      noteColIdx = j;
    }
  }
  
  // Fallback default indices if header name did not match
  if (nameColIdx === -1) {
    nameColIdx = (idColIdx === 0) ? 1 : 0;
  }
  if (idColIdx === -1) {
    idColIdx = (nameColIdx === 0) ? 1 : 0;
  }
  if (locColIdx === -1) locColIdx = 2;
  if (specColIdx === -1) specColIdx = 3;
  if (noteColIdx === -1) noteColIdx = 4;

  const objects = [];
  // Row indices are 1-based, starting with row 2 (index 1 of values array)
  for (var i = 1; i < values.length; i++) {
    const row = values[i];
    const rawName = nameColIdx < row.length ? String(row[nameColIdx] || "").trim() : "";
    const rawId = idColIdx < row.length ? String(row[idColIdx] || "").trim() : "";
    if (!rawName && !rawId) continue;
    
    objects.push({
      rowIndex: i + 1,
      name: rawName || rawId, // fallback to ID if name is empty
      id: rawId,
      location: locColIdx < row.length ? String(row[locColIdx] || "로봇 구역").trim() : "로봇 구역",
      spec: specColIdx < row.length ? String(row[specColIdx] || "").trim() : "",
      note: noteColIdx < row.length ? String(row[noteColIdx] || "").trim() : "",
      stock: "N/A"
    });
  }
  return objects;
}

function getRentLogs(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const range = sheet.getRange(2, 1, lastRow - 1, 7);
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const logs = [];
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    logs.push({
      rowIndex: i + 2,
      timestamp: displayValues[i][0] || "",
      type: String(row[1] || "대여").trim(),
      location: String(row[2] || "").trim(),
      name: String(row[3] || "").trim(),
      qty: row[4] === "" ? 0 : Number(row[4]),
      user: String(row[5] || "").trim(),
      note: String(row[6] || "").trim()
    });
  }
  return logs;
}

// 창고물품 대여로그에서 (위치, 품명)별 순 대여량(대여-반납)을 집계.
// - 이 시트는 헤더 없이 1행부터 데이터이므로 1행부터 직접 읽습니다.
// - 이름 필터는 적용하지 않고 전체 미반납 목록을 반환합니다 (WMS 대여/반납과 동일).
// - name 인자는 하위호환용으로 받되 무시합니다.
/**
 * 창고물품 대여/반납/소모 한 건을 기록하고 재고를 갱신한다.
 * (단건 액션과 묶음 액션이 같은 로직을 쓰도록 분리했다)
 */
function applyWarehouseRentRow_(sheet, rentSheet, payload) {
  addRentLog(rentSheet, payload);

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() !== String(payload.location).trim()) continue;
    if (String(values[i][2]).trim() !== String(payload.name).trim()) continue;

    var rowIdx = i + 2;
    var rawStock = values[i][4];
    var isNaValue = rawStock === "" || rawStock === null || rawStock === undefined
      || rawStock === "N/A" || isNaN(Number(rawStock));

    var nextStock = rawStock;
    if (!isNaValue) {
      var currentStock = Number(rawStock || 0);
      var qtyChange = Number(payload.qty || 0);
      if (payload.type === "대여" || payload.type === "소모") {
        nextStock = Math.max(0, currentStock - qtyChange);
      } else if (payload.type === "반납" && String(payload.note || "").indexOf("[소모완료]") !== -1) {
        // 대여 시 이미 차감됐으므로 재고를 되돌리지 않는다.
        nextStock = currentStock;
      } else if (payload.type === "반납") {
        nextStock = currentStock + qtyChange;
      }
    }

    sheet.getRange(rowIdx, 5, 1, 2).setValues([[
      nextStock === "" || nextStock == null ? "" : nextStock,
      formatDate(new Date())
    ]]);
    return;
  }
}

// 창고물품 대여로그에서 "사람별" 미반납 목록을 만든다.
// - 이 시트는 헤더 없이 1행부터 데이터이므로 1행부터 직접 읽습니다.
// - 예전에는 (위치, 품명)으로만 묶어 대여자 여러 명을 한 문자열로 합쳐 내려보냈는데,
//   화면이 대여자별로 묶는 구조라 "최지훈, 윤원태"가 한 사람처럼 잡히는 문제가 있었습니다.
//   이제 (대여자, 위치, 품명) 단위로 내려보냅니다.
// - 반납은 대여자가 다르게 기록되는 경우가 있어, 품목 단위로 모아 오래된 대여부터
//   차감(FIFO)합니다. 그래야 남의 이름으로 반납해도 유령 미반납이 남지 않습니다.
// - name 인자는 하위호환용으로 받되 무시합니다.
function getWarehouseBorrowedItems_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(RENT_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 1) return [];
  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(1, 1, lastRow, 7).getValues();
  var display = sheet.getRange(1, 1, lastRow, 7).getDisplayValues();

  var groups = {}; // key(위치||품명) → { location, name, borrows: [...], returned: n }
  var order = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var typ = String(row[1] || "").trim();
    var loc = String(row[2] || "").trim();
    var nm = String(row[3] || "").trim();
    if (!loc && !nm) continue; // 빈 줄 / 실수로 남은 헤더 방어

    var q = (row[4] === "" || row[4] == null) ? 0 : Number(row[4]);
    if (isNaN(q) || q <= 0) q = 0;
    var user = String(row[5] || "").trim();
    var note = String(row[6] || "").trim();
    var ts = display[i][0] || "";

    var key = loc + "||" + nm;
    if (!groups[key]) { groups[key] = { location: loc, name: nm, borrows: [], returned: 0 }; order.push(key); }

    // 소모: 대여도 반납도 아님 (재고에서 영구 차감) → 미반납 집계에서 완전히 제외
    if (typ === "소모") continue;

    var isConsumeNote = note.indexOf("[소모완료]") !== -1 || note.indexOf("[즉시반납]") !== -1;
    if (typ === "반납" || isConsumeNote) {
      groups[key].returned += q;
    } else {
      groups[key].borrows.push({ user: user || "(이름 없음)", qty: q, date: ts });
    }
  }

  var result = [];
  order.forEach(function (k) {
    var g = groups[k];
    var remainingReturn = g.returned;

    // 오래된 대여부터 반납 수량을 차감한다 (로그가 시간순으로 쌓이므로 배열 순서가 곧 시간순).
    var perUser = {}, userOrder = [];
    for (var b = 0; b < g.borrows.length; b++) {
      var entry = g.borrows[b];
      var qty = entry.qty;
      if (remainingReturn > 0) {
        var cut = Math.min(remainingReturn, qty);
        qty -= cut;
        remainingReturn -= cut;
      }
      if (qty <= 0) continue;
      if (!perUser[entry.user]) { perUser[entry.user] = { qty: 0, lastDate: "" }; userOrder.push(entry.user); }
      perUser[entry.user].qty += qty;
      if (entry.date) perUser[entry.user].lastDate = entry.date;
    }

    userOrder.forEach(function (u) {
      var e = perUser[u];
      if (e.qty <= 0) return;
      result.push({
        sheetType: "warehouse",
        borrowerName: u,
        location: g.location,
        name: g.name,
        quantity: e.qty,
        itemLabel: (g.location ? "[" + g.location + "] " : "") + g.name + (e.qty > 1 ? " x " + e.qty : ""),
        borrowDate: e.lastDate,
        borrowPurpose: ""
      });
    });
  });

  // 대여자 이름 → 위치 순으로 정렬해 화면에서 사람별로 모이게 한다.
  result.sort(function (a, b) {
    if (a.borrowerName !== b.borrowerName) return a.borrowerName < b.borrowerName ? -1 : 1;
    return compareRackSlot_(a.location, b.location);
  });
  return result;
}

// 위치 "A-01" 를 랙(A~) → 슬롯 숫자 순으로 정렬 비교
function compareRackSlot_(la, lb) {
  var pa = String(la || "").toUpperCase().split("-");
  var pb = String(lb || "").toUpperCase().split("-");
  var ra = pa[0] || "", rb = pb[0] || "";
  if (ra !== rb) return ra < rb ? -1 : 1;
  var sa = parseInt(String(pa[1] || "").replace(/\D/g, ""), 10);
  var sb = parseInt(String(pb[1] || "").replace(/\D/g, ""), 10);
  if (isNaN(sa)) sa = 999999;
  if (isNaN(sb)) sb = 999999;
  return sa - sb;
}

function addRentLog(sheet, log) {  const lastRow = sheet.getLastRow();
  const nextRow = lastRow + 1;
  
  const nowStr = formatDate(new Date());
  const ts = log.timestamp || nowStr;
  const rowValues = [
    ts.indexOf("'") === 0 ? ts : "'" + ts,
    log.type || "대여",
    log.location || "",
    log.name || "",
    log.qty === "" || log.qty == null ? 0 : Number(log.qty),
    log.user || "",
    log.note || ""
  ];
  
  sheet.getRange(nextRow, 1, 1, 7).setValues([rowValues]);
  return nextRow;
}

function addInventoryItem(sheet, item) {
  const lastRow = sheet.getLastRow();
  const nextRow = lastRow + 1;
  const nowStr = formatDate(new Date());
  
  const rawStock = (item.stock === "N/A" || String(item.stock).toUpperCase() === "N/A") 
    ? "N/A" 
    : (item.stock === "" || item.stock == null ? "" : Number(item.stock));

  // 물품 등록 이미지 드라이브 업로드 처리 (이름은 오브젝트 이름으로 지정, 폴더 ID: 1B8VRL7T9cuQIuiSU08ToZnJis576z_wY)
  let photoVal = item.photo || "";
  if (photoVal.indexOf("data:image/") === 0) {
    const fileName = String(item.name || "물품이미지").trim();
    photoVal = uploadImageToDrive(photoVal, fileName, getInventoryImageFolderId_(), "Inventory Images");
  }

  const rowValues = [
    item.location || "",
    item.spec || "", // Column B (서브 분류)
    item.name || "",
    item.link || "",
    rawStock,
    nowStr,
    item.manager || "",
    item.note || "",
    photoVal, // Column I (사진 링크용)
    item.manager2 || "", // Column J (담당자 2) — 보존
    item.keywords || "" // Column K (한글 검색어)
  ];
  
  if (sheet.getMaxColumns() < 11) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 11 - sheet.getMaxColumns());
  }
  sheet.getRange(nextRow, 1, 1, 11).setValues([rowValues]);
  return nextRow;
}

function updateInventoryItem(sheet, item) {
  const rowIndex = Number(item.rowIndex);
  if (!rowIndex || rowIndex < 2) throw new Error("올바르지 않은 행 인덱스: " + rowIndex);
  
  const nowStr = formatDate(new Date());
  if (sheet.getMaxColumns() < 11) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), 11 - sheet.getMaxColumns());
  }
  const range = sheet.getRange(rowIndex, 1, 1, 11);
  const currentValues = range.getValues()[0];
  
  if (item.location !== undefined) currentValues[0] = item.location;
  if (item.spec !== undefined) currentValues[1] = item.spec; // Column B (서브 분류)
  if (item.photo !== undefined) {
    // 물품 수정 이미지 드라이브 업로드 처리 (이름은 오브젝트 이름으로 지정, 폴더 ID: 1B8VRL7T9cuQIuiSU08ToZnJis576z_wY)
    let photoVal = item.photo || "";
    if (photoVal.indexOf("data:image/") === 0) {
      const fileName = String(item.name || currentValues[2] || "물품이미지").trim();
      photoVal = uploadImageToDrive(photoVal, fileName, getInventoryImageFolderId_(), "Inventory Images");
    }
    currentValues[8] = photoVal; // Column I (사진 링크용)만 업데이트합니다.
  }
  if (item.name !== undefined) currentValues[2] = item.name;
  if (item.link !== undefined) currentValues[3] = item.link;
  if (item.stock !== undefined) {
    currentValues[4] = (item.stock === "N/A" || String(item.stock).toUpperCase() === "N/A")
      ? "N/A"
      : (item.stock === "" || item.stock == null ? "" : Number(item.stock));
  }
  currentValues[5] = nowStr;
  if (item.manager !== undefined) currentValues[6] = item.manager;
  if (item.note !== undefined) currentValues[7] = item.note;
  if (item.keywords !== undefined) currentValues[10] = item.keywords; // Column K (한글 검색어)
  
  range.setValues([currentValues]);
}

function deleteInventoryItem(sheet, rowIndex) {
  const idx = Number(rowIndex);
  if (!idx || idx < 2) throw new Error("올바르지 않은 행 인덱스: " + idx);
  sheet.deleteRow(idx);
}

function getSectorLayout() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const data = scriptProperties.getProperty("sector_layout");
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function saveSectorLayout(sectors) {
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperty("sector_layout", JSON.stringify(sectors));
}

function deleteSector(sectorId) {
  const scriptProperties = PropertiesService.getScriptProperties();
  const data = scriptProperties.getProperty("sector_layout");
  if (!data) return;
  try {
    let sectors = JSON.parse(data);
    sectors = sectors.filter(function(s) { return s.id !== sectorId; });
    scriptProperties.setProperty("sector_layout", JSON.stringify(sectors));
  } catch (e) {}
}

function formatDate(date) {
  const pad = function(n) { return String(n).padStart(2, "0"); };
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ══════════ 캐시 유틸 ══════════
 * CacheService는 값 하나당 100KB 제한이 있어, 큰 JSON은 조각내어 저장한다.
 * 조회 시 조각이 하나라도 없으면 캐시 미스로 처리한다(부분 복원 방지).
 */
var CACHE_CHUNK_SIZE_ = 90000;

function cachePutLarge_(key, str, seconds) {
  try {
    var cache = CacheService.getScriptCache();
    var n = Math.ceil(str.length / CACHE_CHUNK_SIZE_);
    if (n > 20) return; // 너무 크면 캐시하지 않는다
    var parts = {};
    for (var i = 0; i < n; i++) {
      parts[key + "_p" + i] = str.substring(i * CACHE_CHUNK_SIZE_, (i + 1) * CACHE_CHUNK_SIZE_);
    }
    parts[key + "_n"] = String(n);
    cache.putAll(parts, seconds);
  } catch (e) { /* 캐시 실패는 무시 */ }
}

function cacheGetLarge_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(key + "_n"), 10);
    if (!n || isNaN(n)) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + "_p" + i);
    var got = cache.getAll(keys);
    var out = "";
    for (var j = 0; j < n; j++) {
      var piece = got[key + "_p" + j];
      if (piece === undefined || piece === null) return null; // 조각 유실 → 미스
      out += piece;
    }
    return out;
  } catch (e) { return null; }
}

function cacheRemoveLarge_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(key + "_n"), 10);
    var keys = [key + "_n"];
    if (n && !isNaN(n)) for (var i = 0; i < n; i++) keys.push(key + "_p" + i);
    cache.removeAll(keys);
  } catch (e) { /* 무시 */ }
}

// ── 데이터 버전 스탬프 ──────────────────────────────────────────
// 대여/반납 등으로 시트가 바뀔 때마다 bumpDataVersion_()으로 값을 올린다.
// 캐시를 다시 채우는 함수들은 "계산을 시작한 시점의 버전"과 "계산이 끝난 시점의 버전"을
// 비교해서, 그 사이 다른 변경이 끼어들었으면 캐시에 쓰지 않는다.
// (그렇게 안 하면: A가 옛 데이터로 계산 중일 때 B가 대여를 기록하고 캐시를 비웠는데,
//  뒤늦게 A의 계산이 끝나면서 옛 데이터로 캐시를 다시 채워버리는 경합이 생긴다.
//  이게 "대여 현황엔 없는데 전체 이력엔 미반납으로 뜨는" 증상의 실제 원인이었다.)
function getDataVersion_() {
  try {
    var v = CacheService.getScriptCache().get("dataVersion_v1");
    return v ? (parseInt(v, 10) || 0) : 0;
  } catch (e) { return 0; }
}
function bumpDataVersion_() {
  try {
    var v = getDataVersion_() + 1;
    CacheService.getScriptCache().put("dataVersion_v1", String(v), 21600);
    return v;
  } catch (e) { return 0; }
}

// 물품 마스터: 여러 엔드포인트가 매번 시트를 다시 읽던 것을 60초 캐시로 묶는다.
function getObjectItemsCached_() {
  var cached = cacheGetLarge_("objectItems_v1");
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* 파싱 실패 시 재계산 */ }
  }
  var items = getObjectItems();
  cachePutLarge_("objectItems_v1", JSON.stringify(items), 60);
  return items;
}

// 좌석 위치 기록도 동일하게 캐시한다.
function getSeatLocationMapCached_(ss) {
  var cached = cacheGetLarge_("seatLocMap_v1");
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* 재계산 */ }
  }
  var map = getSeatLocationMap_(ss);
  cachePutLarge_("seatLocMap_v1", JSON.stringify(map), 60);
  return map;
}

// 대여/반납/교체 등 로그가 바뀌는 작업 뒤에 호출해 관련 캐시를 모두 비운다.
function invalidateLogCaches_() {
  bumpDataVersion_(); // 계산 중이던 다른 요청이 낡은 결과로 캐시를 덮어쓰지 못하게 세대를 올린다
  cacheRemoveLarge_("unreturnedItems_v2");
  cacheRemoveLarge_("objectItems_v1");
  cacheRemoveLarge_("seatLocMap_v1");
  cacheRemoveLarge_("rentedCounts_v1");
  var scopes = ["all", "unreturned", "returned"];
  var days = ["0", "4", "7", "14"];
  for (var d = 0; d < days.length; d++) {
    for (var sc = 0; sc < scopes.length; sc++) {
      cacheRemoveLarge_("scenarioAllLogs_v2_" + days[d] + "_" + scopes[sc] + "_s");
      cacheRemoveLarge_("scenarioAllLogs_v2_" + days[d] + "_" + scopes[sc] + "_f");
    }
  }
  try { CacheService.getScriptCache().remove("leastBorrowed_v1_20"); } catch (e) {}
}

// getAll 캐시를 강제로 비운다. 물품/로그 등 데이터가 바뀌는 모든 쓰기 작업 뒤에 호출해,
// 사용자가 방금 한 변경이 캐시 만료(최대 4초)를 기다리지 않고 바로 반영되게 한다.
function invalidateGetAllCache_() {
  try { CacheService.getScriptCache().remove("getAll_cache_v2"); } catch (e) { /* 무시 */ }
}

function testDrivePermission() {
  try {
    const folders = DriveApp.getFoldersByName("Image for Broken Item");
    if (folders.hasNext()) {
      Logger.log("성공: 구글 드라이브 권한이 정상 승인되었습니다! 기존 폴더를 감지했습니다.");
    } else {
      const folder = DriveApp.createFolder("Image for Broken Item");
      Logger.log("성공: 구글 드라이브 권한이 정상 승인되었습니다! 새 폴더를 생성했습니다.");
    }
  } catch (e) {
    Logger.log("실패: 권한 승인 중 오류가 발생했습니다. 에러: " + e.toString());
  }
}

function serveExternalForm(ss, sheet) {
  const inventory = [];
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
    for (let i = 0; i < values.length; i++) {
      const loc = String(values[i][0] || "").trim();
      const name = String(values[i][2] || "").trim();
      const stock = (values[i][4] === "" || isNaN(Number(values[i][4]))) ? null : Number(values[i][4]);
      if (loc && name) {
        inventory.push({ location: loc, name: name, stock: stock });
      }
    }
  }

  // 가나다 순 정렬
  inventory.sort(function(a, b) { return a.name.localeCompare(b.name); });

  const html = getFormHtml(inventory);
  return HtmlService.createHtmlOutput(html)
    .setTitle("외부인 대여 및 반납 간편 신청서")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function handleExternalFormSubmit(payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getInventorySheet(ss);
    if (!sheet) throw new Error("스프레드시트에서 데이터를 저장/조회할 시트 탭을 찾을 수 없습니다. 시트가 비어있는지 확인하세요.");
    
    let rentSheet = ss.getSheetByName(RENT_SHEET_NAME);
    if (!rentSheet) {
      rentSheet = ss.insertSheet(RENT_SHEET_NAME);
      rentSheet.getRange(1, 1, 1, 7).setValues([["기록 시간", "구분", "위치", "제품명", "수량", "대여자 성함", "메모"]]);
    }
    
    const log = {
      timestamp: formatDate(new Date()),
      type: payload.type,
      location: payload.location,
      name: payload.name,
      qty: Number(payload.qty || 1),
      user: payload.user,
      note: payload.note || "외부인 신청"
    };
    
    const newRowIndex = addRentLog(rentSheet, log);
    
    // 재고 반영
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
      for (let i = 0; i < values.length; i++) {
        if (String(values[i][0]).trim() === String(log.location).trim() && 
            String(values[i][2]).trim() === String(log.name).trim()) {
          const rowIdx = i + 2;
          const rawStock = values[i][4];
          const isNaValue = rawStock === "" || rawStock === null || rawStock === undefined || rawStock === "N/A" || isNaN(Number(rawStock));
          
          let nextStock = rawStock;
          if (!isNaValue) {
            let currentStock = Number(rawStock || 0);
            const qtyChange = Number(log.qty || 0);
            if (log.type === "대여") {
              nextStock = Math.max(0, currentStock - qtyChange);
            } else if (log.type === "반납") {
              nextStock = currentStock + qtyChange;
            }
          }
          
          sheet.getRange(rowIdx, 5, 1, 2).setValues([[
            nextStock === "" || nextStock == null ? "" : nextStock,
            formatDate(new Date())
          ]]);
          break;
        }
      }
    }
    
    return { success: true, rowIndex: newRowIndex };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

function getFormHtml(inventory) {
  const inventoryJson = JSON.stringify(inventory);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>외부인 대여 및 반납 간편 신청서</title>
  <style>
    :root {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text-main: #0f172a;
      --text-dim: #475569;
      --border: #e2e8f0;
      --accent: #4f46e5;
      --accent-hover: #4338ca;
      --rent: #3b82f6;
      --return: #10b981;
      --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background-color: var(--bg); color: var(--text-main); display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .container { width: 100%; max-width: 480px; background: var(--card-bg); border-radius: 16px; border: 1px solid var(--border); box-shadow: var(--shadow); overflow: hidden; padding: 28px 24px; transition: all 0.3s; }
    .header { text-align: center; margin-bottom: 24px; }
    .header h1 { font-size: 20px; font-weight: 800; color: var(--text-main); margin-bottom: 8px; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .header p { font-size: 13px; color: var(--text-dim); line-height: 1.5; }
    
    .form-group { margin-bottom: 20px; position: relative; }
    .form-group label { display: block; font-size: 12.5px; font-weight: 700; color: var(--text-dim); margin-bottom: 6px; }
    
    /* Type Selector Cards */
    .type-container { display: flex; gap: 12px; margin-bottom: 20px; }
    .type-card { flex: 1; border: 2px solid var(--border); border-radius: 10px; padding: 14px; text-align: center; cursor: pointer; font-weight: 800; font-size: 14px; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .type-card.active-rent { border-color: var(--rent); background: rgba(59, 130, 246, 0.08); color: var(--rent); }
    .type-card.active-return { border-color: var(--return); background: rgba(16, 185, 129, 0.08); color: var(--return); }
    
    /* Dropdown search */
    .search-input { width: 100%; padding: 11px 14px; border: 1.5px solid var(--border); border-radius: 8px; font-size: 14px; outline: none; transition: border-color 0.2s; }
    .search-input:focus { border-color: var(--accent); }
    
    .dropdown-list { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: white; border: 1px solid var(--border); border-radius: 8px; max-height: 200px; overflow-y: auto; z-index: 50; box-shadow: var(--shadow); display: none; }
    .dropdown-item { padding: 10px 14px; cursor: pointer; font-size: 13.5px; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
    .dropdown-item:hover { background: #f8fafc; }
    .dropdown-item .stock { font-size: 11px; color: var(--text-dim); background: #f1f5f9; padding: 2px 6px; border-radius: 4px; }
    
    /* Standard inputs */
    input[type="text"], input[type="number"], textarea { width: 100%; padding: 11px 14px; border: 1.5px solid var(--border); border-radius: 8px; font-size: 14px; outline: none; transition: border-color 0.2s; background: #fff; color: var(--text-main); }
    input[type="text"]:focus, input[type="number"]:focus, textarea:focus { border-color: var(--accent); }
    
    /* Qty controls */
    .qty-wrapper { display: flex; align-items: center; gap: 8px; }
    .qty-btn { width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; background: #f1f5f9; border: 1px solid var(--border); border-radius: 8px; font-size: 18px; font-weight: bold; cursor: pointer; user-select: none; transition: background 0.1s; }
    .qty-btn:active { background: #e2e8f0; }
    
    .btn-submit { width: 100%; padding: 13px; background: var(--accent); color: white; border: none; border-radius: 10px; font-size: 14.5px; font-weight: 800; cursor: pointer; transition: background 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 10px; }
    .btn-submit:hover { background: var(--accent-hover); }
    .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }
    
    /* Success Screen */
    .success-screen { display: none; text-align: center; padding: 24px 0; }
    .success-icon { width: 64px; height: 64px; background: rgba(16, 185, 129, 0.1); color: var(--return); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 32px; margin: 0 auto 16px; }
    .success-screen h2 { font-size: 20px; font-weight: 800; color: var(--text-main); margin-bottom: 8px; }
    .success-screen p { font-size: 14px; color: var(--text-dim); line-height: 1.6; margin-bottom: 24px; }
    .btn-reset { width: 100%; padding: 11px; background: #f1f5f9; color: var(--text-main); border: 1px solid var(--border); border-radius: 8px; font-size: 13.5px; font-weight: 700; cursor: pointer; }
    .btn-reset:hover { background: #e2e8f0; }
    
    /* Loading overlay */
    .loading-spinner { border: 3px solid rgba(255,255,255,0.3); border-radius: 50%; border-top: 3px solid #fff; width: 18px; height: 18px; animation: spin 0.8s linear infinite; display: none; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container" id="cardContainer">
    <!-- Form Area -->
    <div id="formArea">
      <div class="header">
        <h1>📦 외부인 대여 / 반납 신청서</h1>
        <p>대여 또는 반납하실 품목과 성함, 수량을 입력하여 실시간 재고에 반영해 주세요.</p>
      </div>
      
      <div class="type-container">
        <div class="type-card active-rent" id="typeRent" onclick="setType('대여')">
          🔵 대여 신청
        </div>
        <div class="type-card" id="typeReturn" onclick="setType('반납')">
          🟢 반납 신청
        </div>
      </div>
      
      <div class="form-group">
        <label>품목 검색 및 선택</label>
        <input type="text" class="search-input" id="searchBar" placeholder="품목 이름을 입력하세요..." onfocus="showDropdown()" oninput="filterDropdown()">
        <input type="hidden" id="selectedLocation">
        <input type="hidden" id="selectedName">
        
        <div class="dropdown-list" id="dropdownList"></div>
      </div>
      
      <div class="form-group">
        <label>수량</label>
        <div class="qty-wrapper">
          <button type="button" class="qty-btn" onclick="adjustQty(-1)">-</button>
          <input type="number" id="qtyInput" value="1" min="1" style="text-align: center; flex: 1;" oninput="validateForm()">
          <button type="button" class="qty-btn" onclick="adjustQty(1)">+</button>
        </div>
      </div>
      
      <div class="form-group">
        <label>신청자 성함</label>
        <input type="text" id="userInput" placeholder="실명을 입력해 주세요" oninput="validateForm()">
      </div>
      
      <div class="form-group">
        <label>메모 / 용도 (선택)</label>
        <textarea id="noteInput" rows="2" placeholder="용도나 남기실 메모를 작성해 주세요"></textarea>
      </div>
      
      <button class="btn-submit" id="btnSubmit" onclick="submitForm()" disabled>
        <div class="loading-spinner" id="btnSpinner"></div>
        <span id="btnText">신청 완료하기</span>
      </button>
    </div>
    
    <!-- Success Area -->
    <div class="success-screen" id="successArea">
      <div class="success-icon">✓</div>
      <h2 id="successTitle">신청이 완료되었습니다!</h2>
      <p id="successMessage">스프레드시트에 정상 등록되었으며 재고 카운트가 즉시 갱신되었습니다.</p>
      <button class="btn-reset" onclick="resetForm()">추가 신청하기</button>
    </div>
  </div>

  <script>
    const inventory = ${inventoryJson};
    let currentType = "대여";
    
    // Initialize dropdown items
    function showDropdown() {
      const list = document.getElementById("dropdownList");
      list.style.display = "block";
      filterDropdown();
    }
    
    // Close dropdown on click outside
    document.addEventListener("click", function(e) {
      const searchBar = document.getElementById("searchBar");
      const list = document.getElementById("dropdownList");
      if (e.target !== searchBar && !list.contains(e.target)) {
        list.style.display = "none";
      }
    });
    
    function filterDropdown() {
      const query = document.getElementById("searchBar").value.toLowerCase().trim();
      const list = document.getElementById("dropdownList");
      list.innerHTML = "";
      
      const filtered = inventory.filter(it => it.name.toLowerCase().includes(query) || it.location.toLowerCase().includes(query));
      
      if (filtered.length === 0) {
        list.innerHTML = '<div style="padding: 12px; font-size: 13px; color: #94a3b8; text-align: center;">검색 결과가 없습니다.</div>';
        return;
      }
      
      filtered.forEach(it => {
        const div = document.createElement("div");
        div.className = "dropdown-item";
        div.innerHTML = '<div><strong>[' + it.location + ']</strong> ' + it.name + '</div><span class="stock">현재고: ' + (it.stock === null ? 'N/A' : it.stock) + '</span>';
        div.onclick = function() {
          document.getElementById("searchBar").value = '[' + it.location + '] ' + it.name;
          document.getElementById("selectedLocation").value = it.location;
          document.getElementById("selectedName").value = it.name;
          list.style.display = "none";
          validateForm();
        };
        list.appendChild(div);
      });
    }
    
    function setType(type) {
      currentType = type;
      const tRent = document.getElementById("typeRent");
      const tReturn = document.getElementById("typeReturn");
      
      if (type === "대여") {
        tRent.className = "type-card active-rent";
        tReturn.className = "type-card";
      } else {
        tRent.className = "type-card";
        tReturn.className = "type-card active-return";
      }
      validateForm();
    }
    
    function adjustQty(amount) {
      const qtyInput = document.getElementById("qtyInput");
      let val = parseInt(qtyInput.value) || 1;
      val = Math.max(1, val + amount);
      qtyInput.value = val;
      validateForm();
    }
    
    function validateForm() {
      const location = document.getElementById("selectedLocation").value;
      const name = document.getElementById("selectedName").value;
      const qty = parseInt(document.getElementById("qtyInput").value) || 0;
      const user = document.getElementById("userInput").value.trim();
      
      const btn = document.getElementById("btnSubmit");
      if (location && name && qty > 0 && user) {
        btn.disabled = false;
      } else {
        btn.disabled = true;
      }
    }
    
    function submitForm() {
      const location = document.getElementById("selectedLocation").value;
      const name = document.getElementById("selectedName").value;
      const qty = parseInt(document.getElementById("qtyInput").value) || 1;
      const user = document.getElementById("userInput").value.trim();
      const note = document.getElementById("noteInput").value.trim();
      
      const btn = document.getElementById("btnSubmit");
      const text = document.getElementById("btnText");
      const spinner = document.getElementById("btnSpinner");
      
      btn.disabled = true;
      text.innerText = "처리 중...";
      spinner.style.display = "inline-block";
      
      const payload = {
        type: currentType,
        location: location,
        name: name,
        qty: qty,
        user: user,
        note: note
      };
      
      google.script.run
        .withSuccessHandler(function(res) {
          spinner.style.display = "none";
          if (res && res.success) {
            document.getElementById("formArea").style.display = "none";
            
            // Set success text
            const sTitle = document.getElementById("successTitle");
            const sMsg = document.getElementById("successMessage");
            sTitle.innerText = currentType + " 신청이 완료되었습니다!";
            sMsg.innerText = "[" + location + "] " + name + " 품목 " + qty + "개가 성공적으로 대장 및 재고에 반영되었습니다.";
            
            document.getElementById("successArea").style.display = "block";
          } else {
            alert("신청 중 오류가 발생했습니다: " + (res ? res.error : "알 수 없는 오류"));
            btn.disabled = false;
            text.innerText = "신청 완료하기";
          }
        })
        .withFailureHandler(function(err) {
          spinner.style.display = "none";
          alert("네트워크 통신 실패: " + err);
          btn.disabled = false;
          text.innerText = "신청 완료하기";
        })
        .handleExternalFormSubmit(payload);
    }
    
    function resetForm() {
      document.getElementById("searchBar").value = "";
      document.getElementById("selectedLocation").value = "";
      document.getElementById("selectedName").value = "";
      document.getElementById("qtyInput").value = "1";
      document.getElementById("userInput").value = "";
      document.getElementById("noteInput").value = "";
      
      document.getElementById("successArea").style.display = "none";
      document.getElementById("formArea").style.display = "block";
      
      const btn = document.getElementById("btnSubmit");
      btn.disabled = true;
      document.getElementById("btnText").innerText = "신청 완료하기";
      
      setType("대여");
    }
  </script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 대여 시스템 모듈 (구 BorrowForm/Code.gs 통합본)
// - 시트명: 통합 스프레드시트 기준 (일반대여 / SID대여 / 시나리오 오브젝트 / ConfigDS계정 / Scenario)
// - 기타계정 시트 제거: 기타 소속은 저장 없이 이름 그대로 Slack에 표기
// - SID별 필요물품 시트 제거: 스크래퍼 upsert는 Scenario 시트로 직접 수행
// - doGet/doPost 없음: 상단 통합 라우팅(doGet/doPost)에서 액션으로 호출됨
// ═══════════════════════════════════════════════════════════════════════════

// ─── Slack 봇 설정 (Incoming Webhook 미사용: 봇 토큰 하나로 일원화) ───
// [새 앱 전환 방법]
//  1) api.slack.com/apps 에서 새 앱 생성 → Bot Token Scopes: chat:write, users:read, users:read.email
//  2) Install to Workspace → 발급된 xoxb- 토큰을 아래 SLACK_BOT_TOKEN 에 붙여넣기
//  3) 테스트 채널을 만들고 봇 초대(/invite @봇이름) → 그 채널 ID를 SLACK_CHANNEL_ID 에 입력
//  4) 메뉴 "물품 관리 → Slack 스레드 댓글 테스트" 로 검증 후, 실채널 ID로 교체
//  ※ Incoming Webhook, 웹훅 URL은 더 이상 필요 없습니다.
var SLACK_BOT_TOKEN = "API Key";
var SLACK_CHANNEL_ID = "C0BBYDMTQUB";
var OBJECT_DETAIL_BASE_URL = "http://scenario-manager.tailb971f6.ts.net/object_detail/";

// ─────────────────────────────────────────────────────────────
// 앱 버전: 문자열을 손으로 고치지 않고, 스크립트 속성에 저장된 값을 사용한다.
// 배포 직후 메뉴 "물품 관리 → 현재 버전을 최신으로 등록"을 한 번 실행하면
// 그 시각으로 새 버전이 발급되고, 열려 있던 구버전 화면들에 경고가 뜬다.
// (Apps Script에는 배포 버전 번호를 코드에서 읽는 API가 없어 이 방식이 가장 확실하다.)
// ─────────────────────────────────────────────────────────────
var PROP_APP_VERSION_ = "CURRENT_APP_VERSION";
var PROP_LATEST_VERSION_ = "LATEST_APP_VERSION";
var PROP_LATEST_URL_ = "LATEST_APP_URL";

var APP_VERSION = (function () {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(PROP_APP_VERSION_);
    if (v && String(v).trim()) return String(v).trim();
  } catch (e) {}
  return "unset"; // 메뉴에서 버전을 한 번도 등록하지 않은 상태
})();

var GENERAL_SHEET_NAME = "일반대여";
var SCENARIO_SHEET_NAME = "SID대여";
var OBJECT_SHEET_NAME = "시나리오 오브젝트";
var CONFIGDS_SHEET_NAME = "ConfigDS계정";
var SCENARIO_DEFINITION_SHEET_NAME = "Scenario";
var OVERDUE_HOURS = 24;
var GENERAL_COL_COUNT = 13;
var SCENARIO_COL_COUNT = 11;
var GENERAL_OPTION_COL = 13;
var SCENARIO_LOG_ITEM_KIND_COL = 12;
var MAX_ACTIVE_ITEM_TYPES = 15; // 한 사람이 동시에 대여할 수 있는 서로 다른 물품 종류 최대 개수

function isOutdatedVersion_() {
  try {
    var latest = String(PropertiesService.getScriptProperties().getProperty(PROP_LATEST_VERSION_) || "");
    return !!latest && latest !== APP_VERSION;
  } catch (e) { return false; }
}

function getAppVersionInfo() {
  var info = { current: APP_VERSION, latest: "", url: "", outdated: false };
  try {
    var props = PropertiesService.getScriptProperties();
    info.latest = String(props.getProperty(PROP_LATEST_VERSION_) || "");
    info.url = String(props.getProperty(PROP_LATEST_URL_) || "");
    info.outdated = !!info.latest && info.latest !== APP_VERSION;
  } catch (e) {
    info.outdated = false;
  }
  return info;
}

// 배포 직후 실행: 현재 시각으로 새 버전을 발급한다.
// 이 값이 바뀌는 순간부터, 열려 있던 옛 화면들은 서버와 버전이 달라져 경고 오버레이를 보게 되고
// 대여/반납 제출도 서버에서 거절된다.
function publishCurrentVersion() {
  var props = PropertiesService.getScriptProperties();
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
  var url = "";
  try { url = ScriptApp.getService().getUrl() || ""; } catch (e) {}
  props.setProperty(PROP_APP_VERSION_, stamp);
  props.setProperty(PROP_LATEST_VERSION_, stamp);
  if (url) props.setProperty(PROP_LATEST_URL_, url);
  var msg = "새 버전을 발급했습니다.\n\n버전: " + stamp
    + "\n(이전 버전: " + APP_VERSION + ")"
    + (url ? "\n주소: " + url : "")
    + "\n\n이제 열려 있던 구버전 화면에는 새로고침 안내가 표시됩니다.";
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

// 프론트엔드(관리자 화면)에서 호출하는 버전 발급.
// 메뉴의 publishCurrentVersion과 같은 일을 하되, 시트 UI 없이 결과만 JSON으로 돌려준다.
function publishAppVersionFromClient_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var previous = APP_VERSION;
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd-HHmmss");
    var url = "";
    try { url = ScriptApp.getService().getUrl() || ""; } catch (e) {}
    props.setProperty(PROP_APP_VERSION_, stamp);
    props.setProperty(PROP_LATEST_VERSION_, stamp);
    if (url) props.setProperty(PROP_LATEST_URL_, url);
    return { success: true, version: stamp, previous: previous, message: "새 버전을 발급했습니다: " + stamp + " (이전: " + previous + ")" };
  } catch (e) {
    return { success: false, message: "버전 발급 실패: " + e.message };
  }
}

// 현재 서버가 인식하고 있는 버전을 확인한다 (진단용).
function 현재버전확인() {
  var msg = "APP_VERSION: " + APP_VERSION;
  if (APP_VERSION === "unset") {
    msg += "\n\n⚠ 아직 버전을 한 번도 등록하지 않았습니다.\n메뉴 [물품 관리 → 현재 버전을 최신으로 등록]을 실행해주세요.";
  }
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function buildObjectLink_(id, name) {
  var label = name || "";
  var cleanId = padObjectId_(id);
  if (cleanId) return "<" + OBJECT_DETAIL_BASE_URL + cleanId + "|" + label + ">";
  return label;
}

function padObjectId_(id) {
  var digits = String(id == null ? "" : id).replace(/\D/g, "");
  if (!digits) return "";
  return digits.length < 6 ? digits.padStart(6, "0") : digits;
}

function buildReqLinkFromLabel_(label) {
  label = String(label || "").trim();
  if (!label) return "";
  var m = label.match(/^\[(\d+)\]\s*(.*)$/);
  if (!m) return label;
  var id = padObjectId_(m[1]);
  var rest = m[2];
  var qm = rest.match(/\s*[x×]\s*\d+\s*$/i);
  var namePart = qm ? rest.substring(0, qm.index) : rest;
  var qtyPart = qm ? qm[0] : "";
  return buildObjectLink_(id, namePart) + qtyPart;
}

var LOCATION_SORT_BANDS_ = [
  { start: 186, end: 251, dir: "asc" },
  { start: 120, end: 185, dir: "desc" },
  { start: 60, end: 119, dir: "asc" },
  { start: 0, end: 59, dir: "desc" },
  { start: 100000, end: 100025, dir: "asc" }
];

function computeLocationSortIndex_(rootSlot) {
  var n = parseInt(String(rootSlot == null ? "" : rootSlot).replace(/\D/g, ""), 10);
  if (isNaN(n)) return Number.MAX_SAFE_INTEGER;
  var offset = 0;
  for (var i = 0; i < LOCATION_SORT_BANDS_.length; i++) {
    var b = LOCATION_SORT_BANDS_[i];
    var size = b.end - b.start + 1;
    if (n >= b.start && n <= b.end) return offset + (b.dir === "asc" ? (n - b.start) : (b.end - n));
    offset += size;
  }
  return offset + n;
}

function getObjectItems() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(OBJECT_SHEET_NAME);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var lastCol = sheet.getLastColumn();
  var colsToRead = Math.min(lastCol, 16); // P열(개인 물품 소유자)까지 읽는다
  if (colsToRead < 1) return [];

  var data = sheet.getRange(2, 1, lastRow - 1, colsToRead).getValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (colsToRead > 0 && !row[0] && (colsToRead <= 1 || !row[1])) continue;

    var id = colsToRead > 0 ? padSlot_(String(row[0]).trim()) : "";
    var name = colsToRead > 1 ? String(row[1]).trim() : "";
    var sector = colsToRead > 2 ? String(row[2]).trim() : "";
    var rootSlot = colsToRead > 3 ? padSlot_(String(row[3]).trim()) : "";
    var category = colsToRead > 4 ? String(row[4] || "").trim() : "";
    var subcategory = colsToRead > 5 ? String(row[5] || "").trim() : "";
    var image = colsToRead > 6 ? String(row[6] || "").trim() : "";
    var stock = 0;
    if (colsToRead > 7) {
      stock = (row[7] !== "" && row[7] !== undefined) ? Number(row[7]) : 0;
    }
    var rented = 0;
    if (colsToRead > 8) {
      rented = (row[8] !== "" && row[8] !== undefined) ? Number(row[8]) : 0;
    }
    var excludeFromRanking = false;
    if (colsToRead > 9) {
      excludeFromRanking = String(row[9] || "").trim().toUpperCase() === "Y";
    }
    // M열(12): 깨질 위험 / N열(13): 화재 위험 / O열(14): 특정 업체 request용 물품(업체명, 빈 값이면 해당 없음)
    // P열(15): 개인 물품 여부(소유자명, 빈 값이면 개인 물품 아님)
    var fragile = colsToRead > 12 ? String(row[12] || "").trim().toUpperCase() === "Y" : false;
    var fireRisk = colsToRead > 13 ? String(row[13] || "").trim().toUpperCase() === "Y" : false;
    var requestFor = colsToRead > 14 ? (String(row[14] || "").trim() || undefined) : undefined;
    var personalOwner = colsToRead > 15 ? (String(row[15] || "").trim() || undefined) : undefined;

    result.push({
      id: id,
      name: name,
      sector: sector,
      rootSlot: rootSlot,
      category: category,
      subcategory: subcategory,
      image: image,
      stock: stock,
      rented: rented,
      excludeFromRanking: excludeFromRanking,
      fragile: fragile,
      fireRisk: fireRisk,
      requestFor: requestFor,
      personalOwner: personalOwner
    });
  }
  // 시트에 수동으로 유지되는 '대여' 카운터 대신, 실제 미반납 로그에서 방금 집계한
  // 값으로 rented를 덮어쓴다 — 어긋날 일이 구조적으로 없어진다.
  var rentedCounts_ = computeRentedCounts_();
  result.forEach(function (o) { o.rented = rentedCounts_[o.id] || 0; });
  result.sort(function (a, b) {
    var na = parseInt(String(a.rootSlot || "").replace(/\D/g, ""), 10);
    var nb = parseInt(String(b.rootSlot || "").replace(/\D/g, ""), 10);
    if (isNaN(na)) na = Number.MAX_SAFE_INTEGER;
    if (isNaN(nb)) nb = Number.MAX_SAFE_INTEGER;
    return na - nb;
  });
  return result;
}

// ─────────────────────────────────────────────
// 시나리오 오브젝트 관리 (WMS 관리자 모드용)
// 시트 열: id(1) name(2) sector(3) root_slot(4) Category(5) Subcategory(6) Image(7) 재고(8) 대여(9) 랭킹제외(10/J열)
//         K/L열은 비워둠 · 깨질위험(13/M열) 화재위험(14/N열) request 대상 업체명(15/O열, 빈값=해당없음)
//         개인 물품 소유자(16/P열, 빈값=개인 물품 아님)
// 사진: 창고물품과 동일하게 data:image/... 가 오면 드라이브 업로드 후 링크 저장
// ─────────────────────────────────────────────
function getScenarioImageFolderId_() {
  return getFolderIdSetting_("SCENARIO_IMAGE_FOLDER_ID", "1QfkmNvsj0zooH5duof1QeqkK2dTjS9Zx");
}

function getScenarioObjectsForAdmin_(forceRefresh) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(OBJECT_SHEET_NAME);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = Math.max(sheet.getLastColumn(), 16);
  var data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  var result = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!row[0] && !row[1]) continue;
    result.push({
      rowIndex: i + 2,
      id: padSlot_(String(row[0]).trim()),
      name: String(row[1]).trim(),
      sector: String(row[2] || "").trim(),
      rootSlot: padSlot_(String(row[3]).trim()),
      category: String(row[4] || "").trim(),
      subcategory: String(row[5] || "").trim(),
      image: String(row[6] || "").trim(),
      stock: (row[7] !== "" && row[7] !== undefined) ? Number(row[7]) : 0,
      rented: (row[8] !== "" && row[8] !== undefined) ? Number(row[8]) : 0,
      excludeFromRanking: String(row[9] || "").trim().toUpperCase() === "Y",
      fragile: String(row[12] || "").trim().toUpperCase() === "Y",
      fireRisk: String(row[13] || "").trim().toUpperCase() === "Y",
      requestFor: String(row[14] || "").trim() || undefined,
      personalOwner: String(row[15] || "").trim() || undefined
    });
  }
  // 시트의 수동 '대여' 카운터 대신 실제 미반납 로그에서 집계한 값으로 덮어쓴다.
  var rentedCounts_ = computeRentedCounts_(forceRefresh);
  result.forEach(function (o) { o.rented = rentedCounts_[o.id] || 0; });
  return result;
}

function resolveScenarioImage_(photoVal, name) {
  photoVal = photoVal || "";
  if (photoVal.indexOf("data:image/") === 0) {
    var fileName = String(name || "시나리오물품").trim();
    return uploadImageToDrive(photoVal, fileName, getScenarioImageFolderId_(), "Scenario Object Images");
  }
  return photoVal;
}

function updateScenarioObject_(item) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(OBJECT_SHEET_NAME);
  if (!sheet) throw new Error("'" + OBJECT_SHEET_NAME + "' 시트를 찾을 수 없습니다.");
  var rowIndex = Number(item.rowIndex);
  if (!rowIndex || rowIndex < 2) throw new Error("올바르지 않은 행 인덱스: " + rowIndex);
  var lastCol = Math.max(sheet.getLastColumn(), 16);
  var range = sheet.getRange(rowIndex, 1, 1, lastCol);
  var cur = range.getValues()[0];

  if (item.id !== undefined) cur[0] = padSlot_(String(item.id).trim());
  if (item.name !== undefined) cur[1] = item.name;
  if (item.sector !== undefined) cur[2] = item.sector;
  if (item.rootSlot !== undefined) cur[3] = padSlot_(String(item.rootSlot).trim());
  if (item.category !== undefined) cur[4] = item.category;
  if (item.subcategory !== undefined) cur[5] = item.subcategory;
  if (item.image !== undefined) cur[6] = resolveScenarioImage_(item.image, item.name || cur[1]);
  // 재고 열은 수식이 있을 수 있으므로 수식이 없을 때만 값 설정
  if (item.stock !== undefined) {
    var stockCell = sheet.getRange(rowIndex, 8);
    if (!stockCell.getFormula()) {
      cur[7] = (item.stock === "" || item.stock == null) ? "" : Number(item.stock);
    }
  }
  if (item.excludeFromRanking !== undefined) {
    cur[9] = item.excludeFromRanking ? "Y" : "N";
  }
  if (item.fragile !== undefined) {
    cur[12] = item.fragile ? "Y" : "N";
  }
  if (item.fireRisk !== undefined) {
    cur[13] = item.fireRisk ? "Y" : "N";
  }
  if (item.requestFor !== undefined) {
    cur[14] = String(item.requestFor || "").trim();
  }
  if (item.personalOwner !== undefined) {
    cur[15] = String(item.personalOwner || "").trim();
  }
  range.setValues([cur]);
  return {
    rowIndex: rowIndex, id: padSlot_(String(cur[0]).trim()), name: String(cur[1]).trim(),
    sector: String(cur[2] || "").trim(), rootSlot: padSlot_(String(cur[3]).trim()),
    category: String(cur[4] || "").trim(), subcategory: String(cur[5] || "").trim(),
    image: String(cur[6] || "").trim(),
    stock: (cur[7] !== "" && cur[7] !== undefined) ? Number(cur[7]) : 0,
    rented: (cur[8] !== "" && cur[8] !== undefined) ? Number(cur[8]) : 0,
    excludeFromRanking: String(cur[9] || "").trim().toUpperCase() === "Y",
    fragile: String(cur[12] || "").trim().toUpperCase() === "Y",
    fireRisk: String(cur[13] || "").trim().toUpperCase() === "Y",
    requestFor: String(cur[14] || "").trim() || undefined,
    personalOwner: String(cur[15] || "").trim() || undefined
  };
}

function addScenarioObject_(item) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(OBJECT_SHEET_NAME);
  if (!sheet) throw new Error("'" + OBJECT_SHEET_NAME + "' 시트를 찾을 수 없습니다.");
  var nextRow = sheet.getLastRow() + 1;
  var img = resolveScenarioImage_(item.image || "", item.name);
  // A~J열 (K, L열은 다른 용도로 이미 쓰이고 있어 이 함수에서는 절대 건드리지 않는다 —
  // 수식이거나 다른 프로세스가 채우는 값일 수 있어 빈 문자열로 덮어쓰면 위험하다)
  var rowValuesAJ = [
    padSlot_(String(item.id || "").trim()),
    item.name || "",
    item.sector || "",
    padSlot_(String(item.rootSlot || "").trim()),
    item.category || "",
    item.subcategory || "",
    img,
    (item.stock === "" || item.stock == null) ? 0 : Number(item.stock),
    0,
    item.excludeFromRanking ? "Y" : "N"
  ];
  sheet.getRange(nextRow, 1, 1, rowValuesAJ.length).setValues([rowValuesAJ]);

  // M~P열: 깨질 위험 / 화재 위험 / request 대상 업체명 / 개인 물품 소유자 — K, L열과 별개 범위로 따로 쓴다
  var rowValuesMP = [
    item.fragile ? "Y" : "N",                // M열: 깨질 위험
    item.fireRisk ? "Y" : "N",               // N열: 화재 위험
    String(item.requestFor || "").trim(),    // O열: request 대상 업체명 (빈 값이면 해당 없음)
    String(item.personalOwner || "").trim()  // P열: 개인 물품 소유자 (빈 값이면 개인 물품 아님)
  ];
  sheet.getRange(nextRow, 13, 1, rowValuesMP.length).setValues([rowValuesMP]);

  var rowValues = rowValuesAJ.concat(["", ""], rowValuesMP); // 반환값 조립용 (실제로 K/L엔 아무것도 안 씀)
  return {
    rowIndex: nextRow, id: rowValues[0], name: rowValues[1], sector: rowValues[2], rootSlot: rowValues[3],
    category: rowValues[4], subcategory: rowValues[5], image: rowValues[6], stock: rowValues[7], rented: 0,
    excludeFromRanking: rowValues[9] === "Y",
    fragile: rowValuesMP[0] === "Y", fireRisk: rowValuesMP[1] === "Y", requestFor: rowValuesMP[2] || undefined,
    personalOwner: rowValuesMP[3] || undefined
  };
}

function deleteScenarioObject_(rowIndex) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(OBJECT_SHEET_NAME);
  if (!sheet) throw new Error("'" + OBJECT_SHEET_NAME + "' 시트를 찾을 수 없습니다.");
  var idx = Number(rowIndex);
  if (!idx || idx < 2) throw new Error("올바르지 않은 행 인덱스: " + idx);
  sheet.deleteRow(idx);
}

function padSlot_(raw) {
  var s = String(raw).trim().replace(/\D/g, "");
  if (!s) return raw;
  return s.length < 6 ? s.padStart(6, "0") : s;
}

function normalizeSid_(sid) { return String(sid || "").trim().toUpperCase().replace(/\s+/g, ""); }

// ─────────────────────────────────────────────
// Scenario 시트 upsert (구 SID별 필요물품 대체)
// 스크래퍼가 보내는 {sid, high_level_en, high_level_ko, items:[{id,name,quantity}]}를
// Scenario 시트(6열)에 직접 upsert합니다.
// ─────────────────────────────────────────────
var SCENARIO_HEADERS = ["SID", "High Level Instruction (EN)", "High Level Instruction (KO)", "Object ID", "Object Name", "Quantity"];

function upsertScenarioRows_(normalizedSid, highLevelEn, highLevelKo, items) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet_(ss, SCENARIO_DEFINITION_SHEET_NAME, SCENARIO_HEADERS);
  var lastRow = sheet.getLastRow();
  var existing = {};
  if (lastRow >= 2) {
    var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    for (var i = 0; i < data.length; i++) {
      var key = normalizeSid_(data[i][0]) + "||" + padSlot_(String(data[i][3] || "").trim());
      existing[key] = i + 2;
    }
  }
  var added = 0, updated = 0;
  items.forEach(function (it) {
    var itemId = padSlot_(String(it.id || "").trim());
    if (!itemId) return;
    var qty = it.quantity || 1;
    var name = it.name || "";
    var key = normalizedSid + "||" + itemId;
    if (existing[key]) {
      sheet.getRange(existing[key], 1, 1, 6).setValues([[normalizedSid, highLevelEn || "", highLevelKo || "", itemId, name, qty]]);
      updated++;
    } else {
      sheet.appendRow([normalizedSid, highLevelEn || "", highLevelKo || "", itemId, name, qty]);
      existing[key] = sheet.getLastRow();
      added++;
    }
  });
  return { added: added, updated: updated };
}

// 통합 doPost에서 호출: 스크래퍼 하위 호환 + upsertScenario 액션
function handleScenarioUpsertPost_(payload) {
  var result = { success: false, message: "" };
  try {
    var sid = normalizeSid_(payload.sid);
    var items = Array.isArray(payload.items) ? payload.items : [];
    if (!sid || items.length === 0) {
      result.message = "sid 또는 items가 비어 있습니다.";
      return responseJSON(result);
    }
    var counts = upsertScenarioRows_(sid, payload.high_level_en, payload.high_level_ko, items);
    result.success = true;
    result.message = sid + ": " + counts.added + "건 추가, " + counts.updated + "건 갱신";
  } catch (err) { result.message = "오류: " + err.message; }
  return responseJSON(result);
}

function resolveBorrowerContact_(borrowInfo) {
  var affiliation = borrowInfo.affiliation || "";

  // 재대여·교체처럼 이미 확인된 이메일이 넘어오면 그대로 쓴다.
  // (소속/사번을 다시 추정할 수 없어 Slack 태깅이 풀리던 문제를 막는다)
  var known = String(borrowInfo.knownEmail || "").trim();
  if (known && known.indexOf("@") !== -1) {
    if (!affiliation) {
      affiliation = /@cfgw-kr\.com$/i.test(known) ? "cfgw" : "configds";
    }
    return { affiliation: affiliation, email: known };
  }

  var email = null;
  if (affiliation === "cfgw") {
    var empId = String(borrowInfo.employeeId || "").trim();
    if (/^\d+$/.test(empId)) email = empId + "@cfgw-kr.com";
  } else if (affiliation === "configds") {
    var found = lookupConfigDsContact_(borrowInfo.borrowerName);
    if (found) email = found.email;
  }

  // 소속을 알 수 없더라도 이름으로 ConfigDS계정 시트를 한 번 더 찾아본다
  if (!email && !affiliation) {
    var fallback = lookupConfigDsContact_(borrowInfo.borrowerName);
    if (fallback && fallback.email) {
      email = fallback.email;
      affiliation = "configds";
    }
  }

  return { affiliation: affiliation, email: email };
}

function isConfigDsRegistered(name) {
  return !!lookupConfigDsContact_(name);
}

function lookupConfigDsContact_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet_(ss, CONFIGDS_SHEET_NAME, ["이름", "이메일", "Slack User ID"]);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var target = String(name || "").trim().toLowerCase();
  if (!target) return null;
  for (var i = 0; i < data.length; i++) {
    var rowName = String(data[i][0] || "").trim().toLowerCase();
    if (rowName === target) return { email: String(data[i][1] || "").trim() || null, slackId: String(data[i][2] || "").trim() || null };
  }
  return null;
}

function lookupConfigDsSlackIdByEmail_(email) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIGDS_SHEET_NAME);
  if (!sheet) return null;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  var target = String(email || "").trim().toLowerCase();
  if (!target) return null;
  for (var i = 0; i < data.length; i++) {
    var rowEmail = String(data[i][1] || "").trim().toLowerCase();
    if (rowEmail === target) return String(data[i][2] || "").trim() || null;
  }
  return null;
}

function buildApplicantLine_(borrowerName, contact) {
  var extra = "";
  if (contact.affiliation === "cfgw") extra = " (Cfgw-kr)";
  else if (contact.affiliation === "configds") extra = " (ConfigDS)";
  else if (contact.affiliation === "other") extra = " (기타)";
  if (contact.email) {
    var slackUserId = lookupSlackIdByEmail_(contact.email);
    if (slackUserId) return "• 대여자: <@" + slackUserId + ">" + extra;
    return "• 대여자: " + borrowerName + extra + " (" + contact.email + ")";
  }
  // 기타 소속: 저장 없이 이름 그대로 표기
  return "• 대여자: " + borrowerName + extra;
}

function buildMentionText_(borrowerName, email, prefix) {
  prefix = (prefix === undefined) ? "반납자: " : prefix;
  if (email) {
    var slackUserId = lookupSlackIdByEmail_(email);
    if (slackUserId) return prefix + "<@" + slackUserId + ">";
    return prefix + borrowerName + " (" + email + ")";
  }
  return prefix + borrowerName;
}

function lookupSlackIdByEmail_(email) {
  if (!email) return null;
  var fromSheet = lookupConfigDsSlackIdByEmail_(email);
  if (fromSheet) return fromSheet;
  return lookupSlackUserId_(email);
}

function lookupSlackUserId_(email) {
  if (!SLACK_BOT_TOKEN) return null;
  var cache = CacheService.getScriptCache();
  var cacheKey = "slackUid_" + email.toLowerCase();
  var cached = cache.get(cacheKey);
  if (cached) return cached === "null" ? null : cached;
  try {
    var response = UrlFetchApp.fetch("https://slack.com/api/users.lookupByEmail?email=" + encodeURIComponent(email), { method: "get", headers: { "Authorization": "Bearer " + SLACK_BOT_TOKEN }, muteHttpExceptions: true });
    var data = JSON.parse(response.getContentText());
    if (data.ok && data.user && data.user.id) { cache.put(cacheKey, data.user.id, 21600); return data.user.id; }
    cache.put(cacheKey, "null", 1800);
    return null;
  } catch (e) { return null; }
}

function getOrCreateSheet_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    var protection = sheet.protect().setDescription(sheetName + " 수정 방지");
    protection.removeEditors(protection.getEditors());
    var owner = ss.getOwner();
    if (owner) protection.addEditor(owner);
  }
  return sheet;
}

function migrateGeneralSheetColumns() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(GENERAL_SHEET_NAME);
  if (sheet) {
    if (sheet.getLastColumn() < 9 || String(sheet.getRange(1, 9).getValue()).trim() !== "이메일") sheet.getRange(1, 9).setValue("이메일");
    if (sheet.getLastColumn() < 10 || String(sheet.getRange(1, 10).getValue()).trim() !== "Slack Thread TS") sheet.getRange(1, 10).setValue("Slack Thread TS");
    if (sheet.getLastColumn() < 11 || String(sheet.getRange(1, 11).getValue()).trim() !== "배치ID") sheet.getRange(1, 11).setValue("배치ID");
    if (sheet.getLastColumn() < 12 || String(sheet.getRange(1, 12).getValue()).trim() !== "신청시각") sheet.getRange(1, 12).setValue("신청시각");
    if (sheet.getLastColumn() < 13 || String(sheet.getRange(1, 13).getValue()).trim() !== "대여구분") sheet.getRange(1, 13).setValue("대여구분");
  }
  var scenarioSheet = ss.getSheetByName(SCENARIO_SHEET_NAME);
  if (scenarioSheet) {
    if (scenarioSheet.getLastColumn() < 8 || String(scenarioSheet.getRange(1, 8).getValue()).trim() !== "이메일") scenarioSheet.getRange(1, 8).setValue("이메일");
    if (scenarioSheet.getLastColumn() < 9 || String(scenarioSheet.getRange(1, 9).getValue()).trim() !== "Slack Thread TS") scenarioSheet.getRange(1, 9).setValue("Slack Thread TS");
    if (scenarioSheet.getLastColumn() < 10 || String(scenarioSheet.getRange(1, 10).getValue()).trim() !== "배치ID") scenarioSheet.getRange(1, 10).setValue("배치ID");
    if (scenarioSheet.getLastColumn() < 11 || String(scenarioSheet.getRange(1, 11).getValue()).trim() !== "신청시각") scenarioSheet.getRange(1, 11).setValue("신청시각");
    if (scenarioSheet.getLastColumn() < 12 || String(scenarioSheet.getRange(1, 12).getValue()).trim() !== "물품 구분") scenarioSheet.getRange(1, 12).setValue("물품 구분");
  }
  try { SpreadsheetApp.getUi().alert("로그 시트 헤더를 보강했습니다."); } catch (e) {}
}

// 봇 토큰으로 채널에 단일 메시지 발송 (구 웹훅 sendSlackNotification 대체)
// 성공 시 메시지 ts를 반환, 실패 시 null (lastSlackError_에 사유 기록)
function sendSlackNotification(message) {
  return postSlackMessage_(message);
}

var lastSlackError_ = "";

function boxWrap_(text) {
  var bar = "━━━━━━━━━━━━━━━━━━━━";
  return bar + "\n" + text + "\n" + bar;
}

function postSlackMessage_(text) {
  lastSlackError_ = "";
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) { lastSlackError_ = "봇 토큰/채널ID 미설정"; return null; }
  try {
    var response = UrlFetchApp.fetch("https://slack.com/api/chat.postMessage", { method: "post", contentType: "application/json; charset=utf-8", headers: { "Authorization": "Bearer " + SLACK_BOT_TOKEN }, payload: JSON.stringify({ channel: SLACK_CHANNEL_ID, text: text }), muteHttpExceptions: true });
    var data = JSON.parse(response.getContentText());
    if (data.ok && data.ts) return data.ts;
    lastSlackError_ = data.error || "unknown";
    return null;
  } catch (e) { lastSlackError_ = e.message; return null; }
}

/**
 * 여러 메시지를 한 번에(병렬로) 보낸다.
 * UrlFetchApp.fetchAll은 요청들을 동시에 처리하므로, N명이어도 왕복 한 번의 시간만 든다.
 * texts: 문자열 배열 → 같은 순서의 ts 배열을 돌려준다 (실패한 자리는 null)
 */
function postSlackMessagesBatch_(texts) {
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID || !texts || !texts.length) {
    return (texts || []).map(function () { return null; });
  }
  var requests = texts.map(function (t) {
    return {
      url: "https://slack.com/api/chat.postMessage",
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: { "Authorization": "Bearer " + SLACK_BOT_TOKEN },
      payload: JSON.stringify({ channel: SLACK_CHANNEL_ID, text: t }),
      muteHttpExceptions: true
    };
  });
  try {
    var responses = UrlFetchApp.fetchAll(requests);
    return responses.map(function (res) {
      try {
        var data = JSON.parse(res.getContentText());
        if (data.ok && data.ts) return data.ts;
        lastSlackError_ = data.error || "unknown";
      } catch (e) { lastSlackError_ = e.message; }
      return null;
    });
  } catch (e) {
    lastSlackError_ = e.message;
    return texts.map(function () { return null; });
  }
}

// 스레드 댓글도 병렬로 보낸다. items: [{ text, ts }]
function postThreadRepliesBatch_(items) {
  var valid = (items || []).filter(function (it) { return it && it.ts && it.text; });
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID || !valid.length) return;
  var requests = valid.map(function (it) {
    return {
      url: "https://slack.com/api/chat.postMessage",
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: { "Authorization": "Bearer " + SLACK_BOT_TOKEN },
      payload: JSON.stringify({ channel: SLACK_CHANNEL_ID, text: it.text, thread_ts: it.ts }),
      muteHttpExceptions: true
    };
  });
  try { UrlFetchApp.fetchAll(requests); } catch (e) { /* 댓글 실패는 무시 */ }
}

/**
 * Admin 시트(D열)에 적힌 슬랙 채널/사용자 ID를 모두 읽는다.
 * 시트 열: ID | PASSWORD | NAME | Slack 채널 ID
 */
function getAdminSlackTargets_() {
  var out = [];
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(USERS_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return out;
    if (sheet.getLastColumn() < 4) return out;
    var data = sheet.getRange(2, 4, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      var id = String(data[i][0] || "").trim();
      if (!id) continue;
      if (out.indexOf(id) === -1) out.push(id);
    }
  } catch (e) { /* 조회 실패 시 빈 목록 */ }
  return out;
}

/**
 * 관리자들에게 DM(또는 지정 채널)으로 같은 메시지를 병렬 발송한다.
 * 대여 흐름을 막지 않도록 실패해도 예외를 던지지 않는다.
 */
function notifyAdminsDm_(text) {
  var targets = getAdminSlackTargets_();
  if (!targets.length || !SLACK_BOT_TOKEN || !text) return 0;
  var requests = targets.map(function (id) {
    return {
      url: "https://slack.com/api/chat.postMessage",
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: { "Authorization": "Bearer " + SLACK_BOT_TOKEN },
      payload: JSON.stringify({ channel: id, text: text }),
      muteHttpExceptions: true
    };
  });
  try {
    var responses = UrlFetchApp.fetchAll(requests);
    var ok = 0;
    responses.forEach(function (res) {
      try {
        var data = JSON.parse(res.getContentText());
        if (data.ok) ok++;
        else Logger.log("notifyAdminsDm_ 실패: " + (data.error || "unknown"));
      } catch (e) { /* 무시 */ }
    });
    return ok;
  } catch (e) {
    Logger.log("notifyAdminsDm_ error: " + e.message);
    return 0;
  }
}

function postThreadReply_(text, threadTs) {
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID || !threadTs) return false;
  try {
    var response = UrlFetchApp.fetch("https://slack.com/api/chat.postMessage", { method: "post", contentType: "application/json; charset=utf-8", headers: { "Authorization": "Bearer " + SLACK_BOT_TOKEN }, payload: JSON.stringify({ channel: SLACK_CHANNEL_ID, text: text, thread_ts: threadTs }), muteHttpExceptions: true });
    var data = JSON.parse(response.getContentText());
    return !!data.ok;
  } catch (e) { return false; }
}

// ── 진단용: Admin 시트 D열에 적힌 관리자들에게 테스트 DM을 보낸다.
// Apps Script 편집기에서 이 함수를 선택하고 ▶ 실행하세요.
function 관리자DM테스트() {
  var targets = getAdminSlackTargets_();
  if (!targets.length) {
    var msg = "Admin 시트 D열에 슬랙 채널/사용자 ID가 없습니다.\n\n"
      + "2행부터 D열에 U... (사용자 ID) 또는 C.../D... (채널 ID)를 입력해주세요.";
    try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
    return;
  }
  var sent = notifyAdminsDm_("🔧 공구 및 부품류 대여 알림 테스트입니다. 이 메시지가 보이면 정상입니다.");
  var result = "대상 " + targets.length + "곳 중 " + sent + "곳 발송 성공\n\n" + targets.join("\n");
  try { SpreadsheetApp.getUi().alert(result); } catch (e) { Logger.log(result); }
}

function testSlackThread() {
  var ui = SpreadsheetApp.getUi();
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) { ui.alert("SLACK_BOT_TOKEN 또는 SLACK_CHANNEL_ID가 비어 있습니다."); return; }
  var mainResp = UrlFetchApp.fetch("https://slack.com/api/chat.postMessage", { method: "post", contentType: "application/json; charset=utf-8", headers: { "Authorization": "Bearer " + SLACK_BOT_TOKEN }, payload: JSON.stringify({ channel: SLACK_CHANNEL_ID, text: "🔧 스레드 테스트 (메인 메시지)" }), muteHttpExceptions: true });
  var mainData = JSON.parse(mainResp.getContentText());
  if (!mainData.ok) { ui.alert("메인 메시지 실패\nSlack 오류: " + (mainData.error || "unknown") + "\n\nnot_in_channel 이면 해당 채널에서 '/invite @봇이름' 으로 봇을 초대하세요."); return; }
  var replyResp = UrlFetchApp.fetch("https://slack.com/api/chat.postMessage", { method: "post", contentType: "application/json; charset=utf-8", headers: { "Authorization": "Bearer " + SLACK_BOT_TOKEN }, payload: JSON.stringify({ channel: SLACK_CHANNEL_ID, text: "🔧 스레드 테스트 (댓글) — 이게 보이면 정상입니다.", thread_ts: mainData.ts }), muteHttpExceptions: true });
  var replyData = JSON.parse(replyResp.getContentText());
  if (!replyData.ok) { ui.alert("메인 메시지는 성공했지만 댓글 실패\nSlack 오류: " + (replyData.error || "unknown")); return; }
  ui.alert("성공! 채널에 메인 메시지와 스레드 댓글이 정상적으로 올라갔습니다. 실제 대여/반납도 댓글이 달립니다.");
}

/**
 * 특정 대여자에게 반납 독촉 DM을 보낸다.
 * payload: { name, email, days, items: [{label, location, days}] }
 * 채널이 아니라 개인 DM으로 가므로, 봇에 chat:write 권한과 상대의 Slack ID가 필요하다.
 */
/**
 * Slack 사용자 목록에서 이름으로 사용자를 찾는다.
 * cfgw-kr 계정은 표시 이름이 "3071_김병우"처럼 사번이 붙어 있어,
 * 이름만 알고 사번을 모를 때 이 경로로 찾는다. (users.list 결과는 6시간 캐시)
 */
function lookupSlackUserIdByName_(name) {
  var target = String(name || "").trim();
  if (!target || !SLACK_BOT_TOKEN) return null;

  var cache = CacheService.getScriptCache();
  var cacheKey = "slackByName_" + target;
  var cached = cache.get(cacheKey);
  if (cached) return cached === "null" ? null : cached;

  try {
    // 사용자 목록을 통째로 받아 캐시해둔다 (여러 명을 연달아 조회해도 호출은 한 번)
    var listRaw = cacheGetLarge_("slackUsers_v1");
    var members = null;
    if (listRaw) {
      try { members = JSON.parse(listRaw); } catch (e) { members = null; }
    }
    if (!members) {
      members = [];
      var cursor = "";
      for (var page = 0; page < 10; page++) { // 최대 10페이지(2000명)
        var url = "https://slack.com/api/users.list?limit=200" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
        var res = UrlFetchApp.fetch(url, {
          method: "get",
          headers: { "Authorization": "Bearer " + SLACK_BOT_TOKEN },
          muteHttpExceptions: true
        });
        var data = JSON.parse(res.getContentText());
        if (!data.ok) break;
        (data.members || []).forEach(function (m) {
          if (m.deleted || m.is_bot) return;
          var prof = m.profile || {};
          members.push({
            id: m.id,
            name: String(m.name || ""),
            real: String(prof.real_name || ""),
            display: String(prof.display_name || ""),
            email: String(prof.email || "")
          });
        });
        cursor = (data.response_metadata && data.response_metadata.next_cursor) || "";
        if (!cursor) break;
      }
      cachePutLarge_("slackUsers_v1", JSON.stringify(members), 21600);
    }

    // 이름이 포함된 계정을 찾는다 ("3071_김병우"에 "김병우"가 들어있는 형태)
    var found = null;
    for (var i = 0; i < members.length; i++) {
      var m = members[i];
      if ([m.real, m.display, m.name].some(function (v) { return v && v.indexOf(target) !== -1; })) {
        found = m.id;
        break;
      }
    }
    cache.put(cacheKey, found || "null", found ? 21600 : 1800);
    return found;
  } catch (e) {
    return null;
  }
}

/**
 * 이름으로 Slack 사용자 ID를 찾는다 (이메일을 모를 때의 마지막 수단).
 * cfgw-kr 계정은 표시 이름이 "3071_김병우"처럼 사번이 붙어 있어, 이름이 포함되면 매칭한다.
 * users.list는 무거우므로 6시간 캐시한다.
 */
function lookupSlackIdByName_(name) {
  var target = String(name || "").trim();
  if (!target || !SLACK_BOT_TOKEN) return null;

  var cache = CacheService.getScriptCache();
  var cacheKey = "slackUidByName_" + target;
  var cached = cache.get(cacheKey);
  if (cached) return cached === "null" ? null : cached;

  try {
    var members = null;
    var listCached = cacheGetLarge_("slackUserList_v1");
    if (listCached) {
      try { members = JSON.parse(listCached); } catch (e) { members = null; }
    }

    if (!members) {
      members = [];
      var cursor = "";
      for (var page = 0; page < 10; page++) { // 최대 2000명
        var url = "https://slack.com/api/users.list?limit=200" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
        var res = UrlFetchApp.fetch(url, {
          method: "get",
          headers: { "Authorization": "Bearer " + SLACK_BOT_TOKEN },
          muteHttpExceptions: true
        });
        var data = JSON.parse(res.getContentText());
        if (!data.ok) break;
        (data.members || []).forEach(function (m) {
          if (m.deleted || m.is_bot) return;
          var prof = m.profile || {};
          members.push({
            id: m.id,
            name: String(m.name || ""),
            real: String(prof.real_name || ""),
            display: String(prof.display_name || "")
          });
        });
        cursor = (data.response_metadata && data.response_metadata.next_cursor) || "";
        if (!cursor) break;
      }
      cachePutLarge_("slackUserList_v1", JSON.stringify(members), 21600);
    }

    // 표시 이름/실명에 한글 이름이 들어 있으면 해당 계정으로 본다
    var matches = members.filter(function (m) {
      return (m.real && m.real.indexOf(target) !== -1)
        || (m.display && m.display.indexOf(target) !== -1)
        || (m.name && m.name.indexOf(target) !== -1);
    });

    // 동명이인이 있으면 잘못 보낼 수 있으니 하나일 때만 인정한다
    var found = matches.length === 1 ? matches[0].id : null;
    cache.put(cacheKey, found || "null", found ? 21600 : 1800);
    return found;
  } catch (e) {
    return null;
  }
}

function sendReturnReminderDm_(payload) {
  var name = String((payload && payload.name) || "").trim();
  var email = String((payload && payload.email) || "").trim();
  if (!name) return { success: false, message: "대여자 이름이 없습니다." };

  var slackId = null;
  var tried = [];

  // 1) 대여 기록에 남은 이메일로 조회 (cfgw-kr은 사번@cfgw-kr.com 형태)
  if (email) { tried.push(email); slackId = lookupSlackIdByEmail_(email); }

  // 2) ConfigDS계정 시트의 Slack User ID 또는 이메일
  if (!slackId) {
    var contact = lookupConfigDsContact_(name);
    if (contact) {
      if (contact.slackId) slackId = contact.slackId;
      else if (contact.email) { tried.push(contact.email); slackId = lookupSlackIdByEmail_(contact.email); }
    }
  }

  // 3) 이름에 사번이 붙어 있으면(예: "3071_김병우") 사번@cfgw-kr.com으로 조회
  if (!slackId) {
    var empMatch = String(name).match(/(\d{3,})/);
    if (empMatch) {
      var guess = empMatch[1] + "@cfgw-kr.com";
      tried.push(guess);
      slackId = lookupSlackIdByEmail_(guess);
    }
  }

  // 4) 마지막으로 Slack 사용자 목록에서 이름으로 찾는다 (사번을 모를 때)
  if (!slackId) slackId = lookupSlackUserIdByName_(name);

  // 4) 이름으로 Slack 사용자 목록에서 직접 찾는다 (이메일을 모를 때)
  if (!slackId) slackId = lookupSlackIdByName_(name);

  if (!slackId) {
    return {
      success: false,
      message: "'" + name + "'님의 Slack 계정을 찾지 못했습니다."
        + (tried.length ? " (시도한 이메일: " + tried.join(", ") + ")" : "")
        + " Slack 사용자 목록에서도 이름으로 찾지 못했습니다."
        + " 대여로그의 이메일 칸을 채우거나, ConfigDS계정 시트에 Slack User ID를 등록해주세요."
    };
  }

  var days = Number((payload && payload.days) || 0);
  var items = (payload && payload.items) || [];
  var lines = [];
  lines.push("📦 *반납 요청*");
  lines.push("");
  lines.push(days >= 7
    ? "대여하신 물품이 *" + days + "일째* 반납되지 않았습니다. 7일 이상 미반납은 *10종류 제한 페널티* 대상입니다."
    : "대여하신 물품이 *" + days + "일째* 반납되지 않았습니다. 확인 부탁드립니다.");

  if (items.length) {
    lines.push("");
    lines.push("*미반납 물품*");
    items.slice(0, 30).forEach(function (it) {
      var label = String((it && it.label) || "").trim();
      var loc = String((it && it.location) || "").trim();
      lines.push("• " + label + (loc ? "  📍 " + loc : ""));
    });
    if (items.length > 30) lines.push("… 외 " + (items.length - 30) + "건");
  }

  try {
    // DM 채널을 먼저 연다. 사용자 ID를 channel에 바로 넣으면 워크스페이스 설정에 따라
    // channel_not_found가 나는 경우가 있어, conversations.open으로 D 채널을 확보한다.
    var dmChannel = slackId;
    try {
      var openRes = UrlFetchApp.fetch("https://slack.com/api/conversations.open", {
        method: "post",
        contentType: "application/json; charset=utf-8",
        headers: { "Authorization": "Bearer " + SLACK_BOT_TOKEN },
        payload: JSON.stringify({ users: slackId }),
        muteHttpExceptions: true
      });
      var openData = JSON.parse(openRes.getContentText());
      if (openData.ok && openData.channel && openData.channel.id) dmChannel = openData.channel.id;
    } catch (openErr) { /* 실패하면 사용자 ID로 바로 시도한다 */ }

    var response = UrlFetchApp.fetch("https://slack.com/api/chat.postMessage", {
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: { "Authorization": "Bearer " + SLACK_BOT_TOKEN },
      payload: JSON.stringify({ channel: dmChannel, text: lines.join("\n") }),
      muteHttpExceptions: true
    });
    var data = JSON.parse(response.getContentText());
    if (!data.ok) {
      var hint = "";
      if (data.error === "missing_scope") hint = " (봇에 im:write / chat:write 권한을 추가한 뒤 재설치해주세요)";
      else if (data.error === "channel_not_found") hint = " (봇이 DM을 열 수 없습니다. im:write 권한을 확인해주세요)";
      else if (data.error === "not_allowed_token_type") hint = " (봇 토큰(xoxb-)인지 확인해주세요)";
      return { success: false, message: "Slack 오류: " + (data.error || "unknown") + hint };
    }
    return { success: true, message: name + "님에게 반납 요청 DM을 보냈습니다." };
  } catch (e) {
    return { success: false, message: "DM 발송 실패: " + e.message };
  }
}

function sendOverdueReminders() {
  var items = getUnreturnedItems();
  var nowMs = new Date().getTime();
  var groups = {}; var order = [];
  items.forEach(function (item) {
    var borrowMs = null;
    if (item.borrowedAtMs) borrowMs = item.borrowedAtMs;
    else if (item.borrowDate) { var d = new Date(item.borrowDate); if (!isNaN(d.getTime())) borrowMs = d.getTime(); }
    if (borrowMs === null) return;
    var elapsedHours = (nowMs - borrowMs) / 3600000;
    if (elapsedHours < OVERDUE_HOURS) return;
    var borrower = item.borrowerName || "(이름 없음)";
    if (!groups[borrower]) { groups[borrower] = { email: item.email || "", entries: [] }; order.push(borrower); }
    if (!groups[borrower].email && item.email) groups[borrower].email = item.email;
    groups[borrower].entries.push({ label: item.itemLabel, hours: Math.floor(elapsedHours) });
  });
  if (order.length === 0) return { success: true, message: "대여 후 " + OVERDUE_HOURS + "시간 이상 경과한 미반납 항목이 없습니다." };
  var locations = buildLocationMap_();
  var failed = 0;
  order.forEach(function (borrower) {
    var g = groups[borrower];
    var mention = buildMentionText_(borrower, g.email, "");
    var mainText = "⏰ " + mention + "님, 대여하신 물품을 빌리신 지 " + OVERDUE_HOURS + "시간이 지났습니다. 반납 부탁드립니다!";
    var itemLines = g.entries.map(function (e) { return "  · " + e.label + " (" + e.hours + "시간 경과)"; }).join("\n");
    var ts = postSlackMessage_(boxWrap_(mainText));
    if (ts) {
      // 위치 정렬된 물품·위치 목록을 스레드 댓글로 첨부
      var parsedItems = g.entries.map(function (e) { return parseItemLabel_(e.label); });
      var locLines = buildMergedLocationLines_(parsedItems, locations);
      if (locLines.length) postThreadReply_("📍 *미반납 물품 · 위치*\n" + locLines.join("\n"), ts);
    } else {
      failed++;
    }
  });
  var note = failed ? " (" + failed + "명은 발송 실패: " + lastSlackError_ + " — 봇을 채널에 초대했는지 확인하세요)" : "";
  return { success: true, message: order.length + "명에게 미반납 알림을 보냈습니다." + note };
}

function sendOverdueRemindersManual() { var res = sendOverdueReminders(); SpreadsheetApp.getUi().alert(res.message); }

function setupDailyReminderTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var exists = triggers.some(function (t) { return t.getHandlerFunction() === "sendOverdueReminders"; });
  if (exists) { SpreadsheetApp.getUi().alert("이미 자동 발송이 설정되어 있습니다."); return; }
  ScriptApp.newTrigger("sendOverdueReminders").timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert("매시간 미반납 여부를 확인해 24시간 경과 시 자동 발송되도록 설정했습니다.");
}

function removeDailyReminderTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  triggers.forEach(function (t) { if (t.getHandlerFunction() === "sendOverdueReminders") { ScriptApp.deleteTrigger(t); removed++; } });
  SpreadsheetApp.getUi().alert(removed > 0 ? "자동 발송을 해제했습니다." : "설정된 자동 발송이 없습니다.");
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("물품 관리")
    .addItem("웹 앱 URL 확인", "openWebAppTest")
    .addSeparator()
    .addItem("미반납 알림 지금 보내기", "sendOverdueRemindersManual")
    .addItem("미반납 알림 자동 발송 설정(매시간)", "setupDailyReminderTrigger")
    .addItem("미반납 알림 자동 발송 해제", "removeDailyReminderTrigger")
    .addSeparator()
    .addItem("Slack 스레드 댓글 테스트", "testSlackThread")
    .addItem("관리자 DM 테스트", "관리자DM테스트")
    .addItem("미반납 응답 진단(시각/시프트)", "미반납응답진단")
    .addItem("현재 버전을 최신으로 등록(배포 직후 실행)", "publishCurrentVersion")
    .addItem("현재 서버 버전 확인", "현재버전확인")
    .addItem("로그 시트 헤더 보강(최초 1회)", "migrateGeneralSheetColumns")
    .addToUi();
}

function openWebAppTest() {
  var ui = SpreadsheetApp.getUi();
  var webAppUrl = ScriptApp.getService().getUrl();
  ui.alert("웹 앱 URL", "아래 URL을 복사하여 브라우저에서 열어보세요:\n" + webAppUrl, ui.ButtonSet.OK);
}

function parseSidParts_(sid) {
  var m = normalizeSid_(sid).match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  return { prefix: m[1], num: parseInt(m[2], 10) };
}

function readScenarioIndex_() {
  var index = { sids: {}, maxNum: -1, maxSid: "" };
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCENARIO_DEFINITION_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return index;
  var col = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  col.forEach(function (r) {
    var sid = normalizeSid_(r[0]);
    if (!sid) return;
    index.sids[sid] = true;
    var parts = parseSidParts_(sid);
    if (!parts) return;
    // 앞자리 0 유무가 다른 표기(예: "S120"과 "S0120")도 같은 SID로 인식되도록 정규화 키를 함께 등록한다.
    index.sids[parts.prefix + parts.num] = true;
    if (parts.num > index.maxNum) { index.maxNum = parts.num; index.maxSid = sid; }
  });
  return index;
}

function evaluateSidUsable_(sid, index) {
  var target = normalizeSid_(sid);
  var res = { blocked: false, reason: "" };
  var parts = parseSidParts_(target);
  var normalizedKey = parts ? (parts.prefix + parts.num) : target;
  if (!target || index.sids[target] || index.sids[normalizedKey]) return res;
  if (!parts) return res;
  if (index.maxNum === undefined || index.maxNum < 0) return res;
  if (parts.num <= index.maxNum) {
    res.blocked = true;
    res.reason = target + " 는 Scenario 시트에 없습니다. 시트에 등록된 마지막 SID(" + (index.maxSid || index.maxNum)
      + ")보다 앞번호이므로 잘못된 SID이거나 삭제된 시나리오입니다. 대여할 수 없습니다.";
  }
  return res;
}

// ── 진단용: 특정 SID가 "Scenario" 시트에서 왜 안 찾아지는지 확인한다.
// Apps Script 편집기에서 이 함수(시나리오SID진단)를 선택하고 ▶ 실행한 뒤,
// "보기 → 실행 기록" 또는 "보기 → 로그"에서 결과를 확인하세요.
// 괄호 안의 SID를 원하는 값으로 바꿔서 실행할 수도 있습니다 (기본값: S0120).
function 시나리오SID진단(sidToCheck) {
  var target = normalizeSid_(sidToCheck || "S0120");
  Logger.log("=== 시나리오 SID 진단: " + target + " ===");
  Logger.log("현재 서버 버전(APP_VERSION): " + APP_VERSION + "  ← 이 값이 화면에서 보이는 버전과 다르면 아직 재배포가 안 된 것입니다.");

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Logger.log("연결된 스프레드시트: " + ss.getName());

  var sheet = ss.getSheetByName(SCENARIO_DEFINITION_SHEET_NAME);
  if (!sheet) {
    Logger.log("❌ '" + SCENARIO_DEFINITION_SHEET_NAME + "' 라는 이름의 시트 탭을 찾지 못했습니다.");
    Logger.log("   실제 시트 탭 이름들: " + ss.getSheets().map(function (s) { return s.getName(); }).join(", "));
    return;
  }
  Logger.log("✅ 시트 탭을 찾았습니다: " + sheet.getName());

  var lastRow = sheet.getLastRow();
  Logger.log("마지막 행 번호(getLastRow): " + lastRow);
  if (lastRow < 2) {
    Logger.log("❌ 데이터가 없습니다 (헤더 행뿐).");
    return;
  }

  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  Logger.log("읽어온 데이터 행 수: " + data.length);

  var targetParts = parseSidParts_(target);
  var exactMatches = [];
  var normMatches = [];
  var sampleFirst5 = [];
  for (var i = 0; i < data.length; i++) {
    var rawCell = data[i][0];
    var rowSid = normalizeSid_(rawCell);
    if (i < 5) sampleFirst5.push("행" + (i + 2) + ": 원본='" + rawCell + "' → 정규화='" + rowSid + "'");
    if (rowSid === target) exactMatches.push(i + 2);
    var rp = parseSidParts_(rowSid);
    if (targetParts && rp && rp.prefix === targetParts.prefix && rp.num === targetParts.num) normMatches.push(i + 2);
  }

  Logger.log("--- A열 처음 5개 샘플 ---");
  sampleFirst5.forEach(function (s) { Logger.log(s); });

  Logger.log("--- 결과 ---");
  Logger.log("문자열 완전일치 행: " + (exactMatches.length ? exactMatches.join(", ") : "없음"));
  Logger.log("접두문자+숫자값 일치 행(0 패딩 무시): " + (normMatches.length ? normMatches.join(", ") : "없음"));

  if (exactMatches.length === 0 && normMatches.length === 0) {
    Logger.log("❌ 이 SID는 '" + SCENARIO_DEFINITION_SHEET_NAME + "' 시트 A열 어디에도 없습니다.");
    Logger.log("   (화면에는 보이는데 이 결과가 나온다면, 탭 이름이 미세하게 다르거나(공백 등),");
    Logger.log("    이 스크립트가 연결된 스프레드시트가 실제 보고 계신 파일과 다른 파일일 수 있습니다.)");
  } else {
    Logger.log("✅ 이 SID는 시트에 존재합니다. 그런데도 화면에서 '동기화가 필요한 SID'가 뜬다면,");
    Logger.log("   Apps Script를 수정만 하고 '배포 → 배포 관리 → 새 버전'으로 재배포하지 않았을 가능성이 매우 높습니다.");
  }
}

/**
 * SID 하나를 받아 "Scenario" 시트(A:SID, B:안내영문, C:안내한글, D:물품ID, E:물품명, F:수량)에서
 * 같은 SID를 가진 행들을 찾아 High Level 안내문과 필요 물품 목록으로 합쳐서 반환한다.
 * 최대한 단순하게: 시트를 읽고, SID가 같은 행만 골라서, 결과를 만든다.
 */
function getScenarioDefinition(sid) {
  var target = normalizeSid_(sid);
  var result = { sid: target, found: false, syncNeeded: true, blocked: false, blockReason: "", highLevelEn: "", highLevelKo: "", items: [], errorMessage: "" };
  if (!target) return result;

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCENARIO_DEFINITION_SHEET_NAME);
    if (!sheet) {
      result.errorMessage = "'" + SCENARIO_DEFINITION_SHEET_NAME + "' 시트를 찾지 못했습니다.";
      return result;
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return result;

    var lastCol = sheet.getLastColumn();
    var colsToRead = Math.min(lastCol, 6);
    if (colsToRead < 1) return result;

    var data = sheet.getRange(2, 1, lastRow - 1, colsToRead).getValues();

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var rowSid = normalizeSid_(row[0]);
      if (rowSid !== target) continue;

      result.found = true;
      result.syncNeeded = false;
      if (colsToRead > 1 && !result.highLevelEn) result.highLevelEn = String(row[1] || "").trim();
      if (colsToRead > 2 && !result.highLevelKo) result.highLevelKo = String(row[2] || "").trim();
      
      var id = "";
      if (colsToRead > 3) id = padSlot_(String(row[3] || "").trim());
      
      var name = "";
      if (colsToRead > 4) name = String(row[4] || "").trim();
      
      var quantity = 1;
      if (colsToRead > 5) quantity = row[5] || 1;

      if (id) result.items.push({ id: id, name: name, quantity: quantity });
    }

    // 물품 마스터와 대조해 위치/재고/이미지 등 부가 정보를 채운다.
    if (result.found) {
      var objectMap = {};
      getObjectItems().forEach(function (object) { objectMap[object.id] = object; });
      result.items.forEach(function (item) {
        var obj = objectMap[item.id];
        if (!obj) return;
        if (!item.name) item.name = obj.name;
        item.rootSlot = obj.rootSlot || "";
        item.category = obj.category || "";
        item.subcategory = obj.subcategory || "";
        item.image = obj.image || "";
        item.stock = obj.stock || 0;
        item.rented = obj.rented || 0;
      });
    }
  } catch (err) {
    result.errorMessage = "getScenarioDefinition 내 오류: " + err.toString();
  }

  return result;
}

function ensureScenarioLogSchema_(sheet) {
  if (sheet.getLastColumn() < SCENARIO_LOG_ITEM_KIND_COL) sheet.insertColumnsAfter(sheet.getLastColumn(), SCENARIO_LOG_ITEM_KIND_COL - sheet.getLastColumn());
  sheet.getRange(1, SCENARIO_LOG_ITEM_KIND_COL).setValue("물품 구분");
}

function ensureGeneralLogSchema_(sheet) {
  if (sheet.getLastColumn() < GENERAL_OPTION_COL) sheet.insertColumnsAfter(sheet.getLastColumn(), GENERAL_OPTION_COL - sheet.getLastColumn());
  sheet.getRange(1, GENERAL_OPTION_COL).setValue("대여구분");
}

/**
 * 이름 끝에 이미 붙어 있는 수량 표기를 떼어낸다.
 * (재대여처럼 라벨을 그대로 이름으로 넘기는 경로에서 "Fork x 3 x 3"이 되는 것을 막는다)
 *
 * 주의: "M3 x 30", "M3 x 10 별나사"처럼 이름 자체에 x가 들어가는 물품이 있다.
 * 그래서 넘어온 수량(qty)과 정확히 같은 숫자일 때만 떼어낸다.
 */
function stripQtySuffix_(name, qty) {
  var text = String(name || "").trim();
  // 앞에 [000617] 같은 ID가 붙어 있으면 함께 제거
  var idm = text.match(/^\[(\d+)\]\s*(.*)$/);
  if (idm) text = idm[2].trim();

  var n = Number(qty);
  if (!n || n <= 1) return text; // 수량이 1이면 애초에 접미사가 붙지 않는다

  var m = text.match(/^(.*?)\s*[x×]\s*(\d+)\s*$/i);
  if (m && parseInt(m[2], 10) === n) return m[1].trim();
  return text;
}

function scenarioItemLabel_(item) {
  var id = item && item.id ? padSlot_(String(item.id).trim()) : "";
  var qty = (item && item.quantity) || 1;
  return (id ? "[" + id + "] " : "") + stripQtySuffix_(item && item.name, qty) + (qty > 1 ? " x " + qty : "");
}

function normalizeDateTimeInput_(value) {
  var text = String(value || "").trim().replace("T", " ");
  if (!text) return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text + " 00:00:00";
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return text + ":00";
  return text;
}

function objectLinks_(items) {
  return (items || []).map(function (item) { return buildObjectLink_(item.id, item.name) + ((item.quantity || 1) > 1 ? " x " + item.quantity : ""); }).join(", ") || "없음";
}

function buildLocationMap_() {
  var map = {};
  getObjectItemsCached_().forEach(function (o) { map[o.id] = o.rootSlot; });
  return map;
}

function objectLocationLine_(id, name, quantity, locations) {
  var padded = padObjectId_(id);
  var loc = padded ? (locations[padded] || "") : "";
  var qtyText = (quantity || 1) > 1 ? " x " + quantity : "";
  var idPrefix = padded ? "[" + padded + "] " : "";
  return "• " + idPrefix + buildObjectLink_(id, name) + qtyText + (loc ? "  📍 " + loc : "  📍 위치 없음");
}

function labelLocationLine_(label, locations) {
  label = String(label || "").trim();
  if (!label) return "";
  var m = label.match(/^\[(\d+)\]/);
  var padded = m ? padObjectId_(m[1]) : "";
  var loc = padded ? (locations[padded] || "") : "";
  var idPrefix = padded ? "[" + padded + "] " : "";
  return "• " + idPrefix + buildReqLinkFromLabel_(label) + (loc ? "  📍 " + loc : "  📍 위치 없음");
}

function parseItemLabel_(label) {
  label = String(label || "").trim();
  var m = label.match(/^\[(\d+)\]\s*(.*)$/);
  var id = "", rest = label;
  if (m) { id = m[1]; rest = m[2]; }
  var qm = rest.match(/\s*[x×]\s*(\d+)\s*$/i);
  var qty = 1, name = rest;
  if (qm) { qty = parseInt(qm[1], 10) || 1; name = rest.substring(0, qm.index); }
  return { id: id, name: name.trim(), quantity: qty };
}

function getSummaryCountText_(items) {
  if (!items || !items.length) return "0개";
  var map = {};
  var totalQty = 0;
  items.forEach(function (it) {
    if (!it) return;
    var pid = padObjectId_(it.id);
    var key = pid || ("name:" + String(it.name || "").toLowerCase());
    if (!pid && !it.name) return;
    var q = Number(it.quantity) || 1;
    totalQty += q;
    map[key] = true;
  });
  var totalTypes = Object.keys(map).length;
  if (totalTypes === 0) return "0개";
  if (totalTypes === totalQty) return totalQty + "개";
  return totalTypes + "종 / " + totalQty + "개";
}

function buildMergedLocationLines_(items, locations) {
  var map = {}, order = [];
  (items || []).forEach(function (it) {
    if (!it) return;
    var pid = padObjectId_(it.id);
    var key = pid || ("name:" + String(it.name || "").toLowerCase());
    if (!pid && !it.name) return;
    if (!map[key]) { map[key] = { id: it.id, name: it.name, quantity: 0 }; order.push(key); }
    map[key].quantity += (it.quantity || 1);
    if (!map[key].name && it.name) map[key].name = it.name;
  });
  var arr = order.map(function (k) { return map[k]; });
  arr.sort(function (a, b) {
    return computeLocationSortIndex_(locations[padObjectId_(a.id)] || "") - computeLocationSortIndex_(locations[padObjectId_(b.id)] || "");
  });
  return arr.map(function (o) { return objectLocationLine_(o.id, o.name, o.quantity, locations); });
}

/**
 * 여러 물품의 재고/대여 수량을 한 번에 갱신한다.
 * changes: { 물품ID(6자리 패딩) : 증감수량 }  (대여는 양수, 반납은 음수)
 *
 * 예전에는 물품 하나마다 updateInventory_를 불러 시트 전체를 다시 읽고 flush까지 했다.
 * 10종을 담으면 전체 읽기 10회 + 강제 반영 10회가 발생해 신청이 매우 느렸다.
 * 여기서는 시트를 한 번만 읽고, 실제로 바뀌는 행만 골라 쓴다.
 * (수식이 걸린 칸은 예전과 동일하게 건드리지 않는다)
 */
function accInventory_(changes, itemId, qty) {
  var id = padSlot_(String(itemId || "").trim());
  if (!id) return;
  changes[id] = (changes[id] || 0) + (Number(qty) || 0);
}

function updateInventoryBatch_(changes) {
  var ids = Object.keys(changes || {});
  if (!ids.length) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(OBJECT_SHEET_NAME);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    var n = lastRow - 1;
    var idCol = sheet.getRange(2, 1, n, 1).getValues();
    var stockRange = sheet.getRange(2, 8, n, 2);          // H:재고, I:대여
    var stockVals = stockRange.getValues();
    var stockFormulas = stockRange.getFormulas();

    // 물품ID → 행 인덱스(0-based)
    var rowOf = {};
    for (var i = 0; i < n; i++) {
      var rid = padSlot_(String(idCol[i][0]).trim());
      if (rid && rowOf[rid] === undefined) rowOf[rid] = i;
    }

    for (var k = 0; k < ids.length; k++) {
      var id = ids[k];
      var delta = Number(changes[id]) || 0;
      if (!delta) continue;
      var idx = rowOf[id];
      if (idx === undefined) continue;

      var newStock = stockFormulas[idx][0] ? null : (Number(stockVals[idx][0]) || 0) - delta;
      var newRented = stockFormulas[idx][1] ? null : (Number(stockVals[idx][1]) || 0) + delta;
      if (newStock === null && newRented === null) continue;

      // 수식이 걸린 칸은 건드리지 않기 위해 행 단위로만 쓴다 (변경된 행 수만큼만 쓰기 발생)
      if (newStock !== null) sheet.getRange(idx + 2, 8).setValue(newStock);
      if (newRented !== null) sheet.getRange(idx + 2, 9).setValue(newRented);
    }
  } catch (e) {
    Logger.log("updateInventoryBatch_ error: " + e.message);
  }
}

// 시나리오 오브젝트 시트의 재고/대여 실시간 갱신 (수식이 있으면 건드리지 않음)
// (하위호환용 단건 함수 — 새 코드는 updateInventoryBatch_를 쓴다)
function updateInventory_(itemId, qtyChange) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(OBJECT_SHEET_NAME);
    if (!sheet) return;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    var range = sheet.getRange(2, 1, lastRow - 1, 9);
    var data = range.getValues();
    for (var i = 0; i < data.length; i++) {
      var rowId = padSlot_(String(data[i][0]).trim());
      if (rowId === padSlot_(itemId)) {
        var cellStock = sheet.getRange(i + 2, 8);
        var cellRented = sheet.getRange(i + 2, 9);

        if (!cellStock.getFormula()) {
          var currentStock = Number(data[i][7]) || 0;
          cellStock.setValue(currentStock - qtyChange);
        }
        if (!cellRented.getFormula()) {
          var currentRented = Number(data[i][8]) || 0;
          cellRented.setValue(currentRented + qtyChange);
        }
        SpreadsheetApp.flush();
        break;
      }
    }
  } catch (e) {
    Logger.log("updateInventory_ error: " + e.message);
  }
}

function getSeatLocationMap_(ss) {
  var locMap = {};
  try {
    var sheet = ss.getSheetByName("대여위치기록");
    if (sheet && sheet.getLastRow() > 1) {
      var lastCol = Math.max(sheet.getLastColumn(), 6);
      var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();
      data.forEach(function (row) {
        var v1 = String(row[0] || "").trim();
        var borrower = String(row[1] || "").trim();
        var floor = String(row[2] || "").trim();
        var unit = String(row[3] || "").trim();
        var v5 = String(row[4] || "").trim();

        var isV1Date = /^\d{4}[.\-\/]/.test(v1) || v1.indexOf("오전") !== -1 || v1.indexOf("오후") !== -1;
        var isV5Date = /^\d{4}[.\-\/]/.test(v5) || v5.indexOf("오전") !== -1 || v5.indexOf("오후") !== -1;

        var primaryBatchId = "";
        var ts = "";

        if (isV1Date && v5) {
          primaryBatchId = v5;
          ts = v1;
        } else if (isV5Date && v1) {
          primaryBatchId = v1;
          ts = v5;
        } else {
          primaryBatchId = v1;
          ts = v5;
        }

        var entry = {
          borrower: borrower,
          floor: floor,
          unit: unit,
          timestamp: formatDateValue_(ts || v1 || v5)
        };

        if (primaryBatchId) locMap[primaryBatchId] = entry;
        if (v1 && v1 !== primaryBatchId) locMap[v1] = entry;
        if (v5 && v5 !== primaryBatchId) locMap[v5] = entry;
      });
    }
  } catch (e) {}
  return locMap;
}

// 좌석배치도에서 ∞(예외 유닛)로 지정된 유닛인지 확인한다.
// 클라이언트가 보낸 플래그를 믿지 않고, 서버가 저장된 좌석배치도를 직접 읽어 판정한다.
function isExemptSeat_(ss, floor, unit) {
  // 공백·괄호·하이픈·대소문자 차이로 매칭이 어긋나지 않도록 느슨하게 비교한다.
  var norm = function (v) {
    return String(v == null ? "" : v).toUpperCase().replace(/[\s()\[\]{}_\-.,\/]/g, "");
  };
  var targetFloor = norm(floor);
  var targetUnit = norm(unit);
  if (!targetFloor || !targetUnit) return false;
  try {
    var map = getSeatMap_(ss);
    var floors = (map && map.floors) || [];
    for (var i = 0; i < floors.length; i++) {
      var f = floors[i];
      if (norm(f.name || f.id) !== targetFloor) continue;
      var units = f.units || [];
      for (var j = 0; j < units.length; j++) {
        if (norm(units[j].label) === targetUnit) return !!units[j].exempt;
      }
    }
  } catch (e) { /* 조회 실패 시 예외 아님으로 처리 (안전한 쪽) */ }
  return false;
}

function recordBorrow(borrowList, clientVersion) {
  if (!Array.isArray(borrowList) || !borrowList.length) return { success: false, message: "대여 요청 정보가 없습니다." };
  if (!clientVersion || clientVersion !== APP_VERSION) {
    return { success: false, message: "구버전 화면을 사용 중입니다. 대여 신청 기능이 작동하지 않습니다. 페이지를 새로고침(F5)하여 최신 버전으로 접속한 뒤 다시 시도해주세요. (현재 버전: " + (clientVersion || "미확인") + ", 최신 버전: " + APP_VERSION + ")" };
  }
  if (isOutdatedVersion_()) {
    return { success: false, message: "구버전에서는 대여 신청을 할 수 없습니다. 최신 버전 주소로 접속한 뒤 다시 시도해주세요." };
  }
  var lockMsg = borrowLockMessage_(borrowList[0].floor, borrowList[0].unit);
  if (lockMsg) return { success: false, message: lockMsg };
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var scenarioSheet = getOrCreateSheet_(ss, SCENARIO_SHEET_NAME, ["대여자", "시나리오 ID", "물품", "대여일", "대여 목적", "반납 여부", "반납일", "이메일", "Slack Thread TS", "배치ID", "신청시각", "물품 구분"]);
    ensureScenarioLogSchema_(scenarioSheet);
    var generalSheet = getOrCreateSheet_(ss, GENERAL_SHEET_NAME, ["대여자", "대여 물품 ID", "대여 물품명", "수량", "대여일", "대여 목적", "반납 여부", "반납일", "이메일", "Slack Thread TS", "배치ID", "신청시각", "대여구분"]);
    ensureGeneralLogSchema_(generalSheet);
    var locationSheet = getOrCreateSheet_(ss, "대여위치기록", ["배치ID", "대여자", "층수", "유닛", "기록시각"]);
    var contact = resolveBorrowerContact_(borrowList[0]);
    if (contact.affiliation === "configds" && !lookupConfigDsContact_(borrowList[0].borrowerName)) {
      return { success: false, message: "'ConfigDS계정' 시트에 등록되지 않은 이름입니다. 관리자에게 계정 등록을 요청한 뒤 다시 시도해주세요." };
    }
    var scenarioIndex = readScenarioIndex_();
    var blockedMsgs = [];
    borrowList.forEach(function (info) {
      if (info.itemType !== "scenario") return;
      var chk = evaluateSidUsable_(info.scenarioId, scenarioIndex);
      if (chk.blocked && blockedMsgs.indexOf(chk.reason) === -1) blockedMsgs.push(chk.reason);
    });
    if (blockedMsgs.length) return { success: false, message: blockedMsgs.join("\n") };

    // Calculate total requested quantity per item ID to validate stock
    var serverRequestedTotals = {};
    var serverAdditionalRecorded = false;
    borrowList.forEach(function (info) {
      if (info.itemType !== "scenario") {
        (info.borrowedItems || []).forEach(function (item) {
          var itemId = padSlot_(String(item.id || "").trim());
          if (!itemId) return;
          if (!serverRequestedTotals[itemId]) {
            serverRequestedTotals[itemId] = { name: item.name, quantity: 0 };
          }
          serverRequestedTotals[itemId].quantity += (item.quantity || 1);
        });
      } else {
        var required = info.requiredObjects || [];
        var additional = serverAdditionalRecorded ? [] : (info.additionalItems || []);
        if (additional.length) serverAdditionalRecorded = true;

        required.forEach(function (item) {
          var itemId = padSlot_(String(item.id || "").trim());
          if (!itemId) return;
          if (!serverRequestedTotals[itemId]) {
            serverRequestedTotals[itemId] = { name: item.name, quantity: 0 };
          }
          serverRequestedTotals[itemId].quantity += (item.quantity || 1);
        });

        additional.forEach(function (item) {
          var itemId = padSlot_(String(item.id || "").trim());
          if (!itemId) return;
          if (!serverRequestedTotals[itemId]) {
            serverRequestedTotals[itemId] = { name: item.name, quantity: 0 };
          }
          serverRequestedTotals[itemId].quantity += (item.quantity || 1);
        });
      }
    });

    // Validate against current stock
    var inventoryItems = getObjectItemsCached_();
    var inventoryMap = {};
    inventoryItems.forEach(function (obj) {
      inventoryMap[obj.id] = obj;
    });

    for (var reqId in serverRequestedTotals) {
      var reqItem = serverRequestedTotals[reqId];
      var invItem = inventoryMap[reqId];
      var availableStock = invItem ? (invItem.stock || 0) : 0;
      if (reqItem.quantity > availableStock) {
        return {
          success: false,
          message: "재고 부족 오류: '" + reqItem.name + "' 물품의 대여 요청 수량(" + reqItem.quantity + "개)이 현재 사용 가능한 재고(" + availableStock + "개)를 초과합니다. 화면을 새로고침하여 재고를 확인하고 다시 시도해주세요."
        };
      }
    }

    // 물품 종류(서로 다른 물품 ID) 최대 보유 개수 제한: 이미 대여 중인 종류 + 이번에 새로 추가되는 종류를 합쳐 MAX_ACTIVE_ITEM_TYPES종류 초과 불가.
    // (프론트엔드에도 같은 체크가 있지만, 새로고침 타이밍 등으로 우회될 수 있으므로 서버에서도 반드시 최종 검증한다.)
    var seatExempt = isExemptSeat_(ss, borrowList[0].floor, borrowList[0].unit);
    var activeTypeInfo = getActiveItemTypeCount_(borrowList[0].borrowerName);
    var activeTypeIdSet = {};
    activeTypeInfo.items.forEach(function (it) { activeTypeIdSet[padSlot_(String(it.id || "").trim())] = true; });
    var newTypeCount = 0;
    for (var checkId in serverRequestedTotals) {
      if (!activeTypeIdSet[checkId]) newTypeCount++;
    }
    var totalTypesAfter = activeTypeInfo.count + newTypeCount;
    var effectiveMax = activeTypeInfo.max; // 페널티가 있으면 이미 낮춰진 값이 들어있다
    if (!seatExempt && totalTypesAfter > effectiveMax) {
      var penaltyNote = activeTypeInfo.penalty
        ? "\n\n※ 현재 페널티가 적용되어 한도가 " + effectiveMax + "종류로 제한되어 있습니다"
          + (activeTypeInfo.penalty.reason ? " (사유: " + activeTypeInfo.penalty.reason + ")" : "")
          + (activeTypeInfo.penalty.until ? " · " + activeTypeInfo.penalty.until + "까지" : "")
          + ". 문의는 관리자에게 해주세요."
        : "";
      return {
        success: false,
        message: "물품 종류 한도 초과: 현재 " + activeTypeInfo.count + "종류를 대여 중이며, 이번 신청에 새로운 " + newTypeCount
          + "종류가 포함되어 있습니다 (합계 " + totalTypesAfter + "종류). 대여할 수 있는 물품 종류는 최대 " + effectiveMax
          + "종류입니다. 기존 물품을 먼저 반납한 뒤 다시 시도해주세요." + penaltyNote
      };
    }

    var applicant = buildApplicantLine_(borrowList[0].borrowerName, contact);
    var scenarioRows = [], generalRows = [], scenarioCount = 0, generalCount = 0;
    var borrowedForThread = [];
    var borrowedSids = [];
    var hasGeneralBorrow = false;
    var generalOption = "";
    var purposeTexts = [];
    var additionalItemsRecorded = false;
    var scenarioRequestBatchId = Utilities.getUuid();
    var additionalBatchId = Utilities.getUuid();
    var scenarioRequestSubmittedAt = new Date();

    var floorVal = borrowList[0].floor || "";
    var unitVal = borrowList[0].unit || "";
    var invChanges = {}; // 재고/대여 변경을 모아 마지막에 한 번에 반영한다

    borrowList.forEach(function (info) {
      var borrowDateTime = normalizeDateTimeInput_(info.borrowDate);
      var purposeText = String(info.borrowPurpose || "").trim();
      if (purposeText && purposeTexts.indexOf(purposeText) === -1) purposeTexts.push(purposeText);
      var itemFloor = info.floor || floorVal || "";
      var itemUnit = info.unit || unitVal || "";

      if (info.itemType !== "scenario") {
        if (info.generalOption) generalOption = info.generalOption;
        var generalPurpose = info.borrowPurpose;
        var generalBatchId = Utilities.getUuid();
        var generalSubmittedAt = new Date();
        if (itemFloor || itemUnit) {
          locationSheet.appendRow([generalBatchId, info.borrowerName, itemFloor, itemUnit, generalSubmittedAt]);
        }
        (info.borrowedItems || []).forEach(function (item) {
          generalSheet.appendRow([info.borrowerName, item.id || "", stripQtySuffix_(item.name, item.quantity), item.quantity || 1, borrowDateTime, generalPurpose, "X", "", contact.email || "", "", generalBatchId, generalSubmittedAt, info.generalOption || ""]);
          generalRows.push(generalSheet.getLastRow()); generalCount += (item.quantity || 1);
          borrowedForThread.push({ id: item.id, name: stripQtySuffix_(item.name, item.quantity), quantity: item.quantity });
          hasGeneralBorrow = true;

          accInventory_(invChanges, item.id, item.quantity || 1);
        });
        return;
      }
      var batchId = scenarioRequestBatchId, now = scenarioRequestSubmittedAt;
      if (itemFloor || itemUnit) {
        locationSheet.appendRow([batchId, info.borrowerName, itemFloor, itemUnit, now]);
        if (info.additionalItems && info.additionalItems.length && !additionalItemsRecorded) {
          locationSheet.appendRow([additionalBatchId, info.borrowerName, itemFloor, itemUnit, now]);
        }
      }
      var required = info.requiredObjects || [];
      var additional = additionalItemsRecorded ? [] : (info.additionalItems || []);
      if (additional.length) additionalItemsRecorded = true;

      required.forEach(function (item) {
        scenarioSheet.appendRow([info.borrowerName, info.scenarioId, scenarioItemLabel_(item), borrowDateTime, info.borrowPurpose, "X", "", contact.email || "", "", batchId, now, "대여 물품"]);
        scenarioRows.push(scenarioSheet.getLastRow());
        borrowedForThread.push({ id: item.id, name: stripQtySuffix_(item.name, item.quantity), quantity: item.quantity });

        accInventory_(invChanges, item.id, item.quantity || 1);
      });
      if (!required.length) {
        scenarioSheet.appendRow([info.borrowerName, info.scenarioId, "", borrowDateTime, info.borrowPurpose, "X", "", contact.email || "", "", batchId, now, "대여 물품"]);
        scenarioRows.push(scenarioSheet.getLastRow());
      }
      scenarioCount++;
      if (borrowedSids.indexOf(info.scenarioId) === -1) borrowedSids.push(info.scenarioId);

      if (additional.length) {
        additional.forEach(function (item) {
          generalSheet.appendRow([info.borrowerName, item.id || "", stripQtySuffix_(item.name, item.quantity), item.quantity || 1, borrowDateTime, info.borrowPurpose, "X", "", contact.email || "", "", additionalBatchId, now, "SID 추가 물품"]);
          generalRows.push(generalSheet.getLastRow()); generalCount += (item.quantity || 1);
          borrowedForThread.push({ id: item.id, name: stripQtySuffix_(item.name, item.quantity), quantity: item.quantity });
          hasGeneralBorrow = true;

          accInventory_(invChanges, item.id, item.quantity || 1);
        });
      }
    });

    // 모아둔 재고 변경을 한 번에 반영 (물품마다 시트를 다시 읽지 않는다)
    updateInventoryBatch_(invChanges);

    var mainLines = ["📦 *물품 대여 신청*", applicant];
    if (borrowedSids.length) mainLines.push("• 시나리오 ID: " + borrowedSids.join(", "));
    if (hasGeneralBorrow) mainLines.push("• 일반 대여" + (generalOption ? ": " + generalOption : ""));
    if (purposeTexts.length) mainLines.push("• 목적: " + purposeTexts.join(" / "));
    // 층수/유닛이 입력된 신청이면 함께 표시 (좌석 배치도 기능)
    if (floorVal || unitVal) mainLines.push("• 위치: " + [floorVal, unitVal].filter(Boolean).join(" · "));
    var mainText = mainLines.join("\n");

    // 메인 메시지와 댓글을 연이어 보낸다.
    // "현재 대여 중인 물품" 댓글은 getUnreturnedItems()를 한 번 더 돌려야 해서 없앴다.
    var locations = buildLocationMap_();
    var objLines = buildMergedLocationLines_(borrowedForThread, locations);
    var borrowedSummary = getSummaryCountText_(borrowedForThread);
    var replyText = "📍 *대여 물품 · 위치* (총 " + borrowedSummary + ")\n" + (objLines.join("\n") || "없음");

    var ts = postSlackMessage_(boxWrap_(mainText));
    var slackNote = "";
    if (ts) {
      generalRows.forEach(function (r) { generalSheet.getRange(r, 10).setValue(ts); });
      scenarioRows.forEach(function (r) { scenarioSheet.getRange(r, 9).setValue(ts); });
      if (objLines.length) postThreadReply_(replyText, ts);
    } else {
      // 봇 메인 메시지 실패 시: 스레드 없이 단일 메시지로라도 재시도
      var combined = postSlackMessage_(boxWrap_(mainText + "\n───────────────\n" + replyText));
      slackNote = combined
        ? " (스레드 없이 단일 메시지로 발송했습니다)"
        : " (Slack 발송 실패: " + lastSlackError_ + " — 봇을 채널에 초대했는지 확인하세요)";
    }
    // 재고변경이력에도 남긴다. 재고(총 보유수량) 자체는 안 바뀌지만, "대여 중" 수량 변화를 추적한다.
    try {
      var borrowerNameForLog = borrowList[0].borrowerName || "-";
      for (var logId in serverRequestedTotals) {
        var logReq = serverRequestedTotals[logId];
        var logInv = inventoryMap[logId];
        var logOldRented = logInv ? (logInv.rented || 0) : 0;
        logStockChange_(ss, "시나리오 물품", logId, logReq.name, logOldRented, logOldRented + logReq.quantity,
          "대여 처리 (" + borrowerNameForLog + ") — 재고 아님, 대여 중 수량 변화", borrowerNameForLog);
      }
    } catch (logErr) { /* 이력 기록 실패는 대여 처리 자체를 막지 않는다 */ }

    return { success: true, message: "SID " + scenarioCount + "건, 일반 물품 " + generalCount + "개를 기록했습니다." + slackNote };
  } catch (e) { return { success: false, message: "대여 기록 중 오류: " + e.message }; }
}

// itemId별로 "지금 실제로 미반납 상태인 수량"을 시트에서 직접 세어본다.
// 시나리오 오브젝트 시트의 '대여'(rented) 칸은 대여/반납/교체마다 수동으로 증감시키는
// 카운터라서, 스왑이나 수동 시트 수정 등 어느 한 경로에서라도 어긋나면 그 뒤로 영영
// 실제 상태와 안 맞을 수 있다 ("반납 완료인데 대여 중 1로 뜨는" 증상의 원인).
// 그래서 표시용 rented는 이 함수로 실측한 값을 쓰고, 시트의 수동 카운터는 참고용으로만 둔다.
function computeRentedCounts_(forceRefresh) {
  if (!forceRefresh) {
    var cached = cacheGetLarge_("rentedCounts_v1");
    if (cached) {
      try { return JSON.parse(cached); } catch (e) { /* 재계산 */ }
    }
  }
  var versionAtStart_ = getDataVersion_();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var counts = {};

  var scenarioSheet = ss.getSheetByName(SCENARIO_SHEET_NAME);
  if (scenarioSheet && scenarioSheet.getLastRow() > 1) {
    var sData = scenarioSheet.getRange(2, 1, scenarioSheet.getLastRow() - 1, 6).getValues();
    sData.forEach(function (row) {
      if (String(row[5]).trim() === "O") return; // 반납 완료는 제외
      var label = row[2] || "";
      var idMatch = String(label).match(/^\[(\d+)\]/);
      if (!idMatch) return;
      var itemId = padSlot_(idMatch[1]);
      var qty = parseItemLabel_(label).quantity || 1;
      counts[itemId] = (counts[itemId] || 0) + qty;
    });
  }

  var generalSheet = ss.getSheetByName(GENERAL_SHEET_NAME);
  if (generalSheet && generalSheet.getLastRow() > 1) {
    var gData = generalSheet.getRange(2, 1, generalSheet.getLastRow() - 1, 7).getValues();
    gData.forEach(function (row) {
      if (String(row[6]).trim() === "O") return;
      var id = String(row[1] || "").trim();
      if (!id) return;
      var itemId = padSlot_(id);
      var qty = Number(row[3]) || 1;
      counts[itemId] = (counts[itemId] || 0) + qty;
    });
  }

  if (getDataVersion_() === versionAtStart_) {
    cachePutLarge_("rentedCounts_v1", JSON.stringify(counts), 60);
  }
  return counts;
}

function getUnreturnedItems(forceRefresh) {
  // 반납 화면이 15초마다 부르는 데다 두 로그 시트를 모두 읽어야 해서 부담이 크다.
  // 대여/반납이 있을 때마다 무효화되므로 짧은 캐시로도 체감이 크게 달라진다.
  // v2: borrowDateTime/shift 계산 시 D·E열(대여일)이 비어 있으면 K·L열(신청시각)로
  //     대체하도록 바뀌어(getBatchDetail_과 동일 패턴), 캐시 형식이 달라져 키를 올렸다.
  // forceRefresh: 관리자가 "새로고침" 버튼을 직접 눌렀을 때 — 시트를 스크립트가 아닌
  //   다른 경로(수동 편집 등)로 바꾼 경우 캐시가 안 비워져 있을 수 있으므로, 이때는
  //   캐시를 아예 무시하고 시트를 다시 읽는다.
  if (!forceRefresh) {
    var unreturnedCached = cacheGetLarge_("unreturnedItems_v2");
    if (unreturnedCached) {
      try { return JSON.parse(unreturnedCached); } catch (e) { /* 파싱 실패 시 재계산 */ }
    }
  }
  var versionAtStart_ = getDataVersion_(); // 계산 도중 다른 변경이 끼어들면 캐시에 안 쓰기 위한 기준점

  var ss = SpreadsheetApp.getActiveSpreadsheet(), result = [];
  var locations = {};
  var objectMap = {};
  getObjectItemsCached_().forEach(function (o) {
    locations[o.id] = o.rootSlot;
    objectMap[o.id] = o;
  });
  var locMap = getSeatLocationMapCached_(ss);
  var scenarioSheet = ss.getSheetByName(SCENARIO_SHEET_NAME);
  if (scenarioSheet && scenarioSheet.getLastRow() > 1) {
    // M열(13번째, index 12): 대여 실물 확인(체크) 완료 시각 — 관리자가 하나하나 확인 후 채워진다.
    var scenarioWidth = Math.max(scenarioSheet.getLastColumn(), SCENARIO_LOG_ITEM_KIND_COL, 13);
    var data = scenarioSheet.getRange(2, 1, scenarioSheet.getLastRow() - 1, scenarioWidth).getValues();
    data.forEach(function (row, i) {
      if (String(row[5]).trim() === "O") return;
      var label = row[2] || "(물품 미등록)";
      var idMatch = String(label).match(/^\[(\d+)\]/);
      var itemId = idMatch ? padSlot_(idMatch[1]) : "";
      var parsedQty = parseItemLabel_(label).quantity || 1;
      var obj = objectMap[itemId] || {};
      var batchId = String(row[9] || "");
      var seatLoc = locMap[batchId] || {};
      // SID대여는 D열(row[3], 대여일)에 시간까지 들어 있는 게 정상이지만,
      // 비어 있을 때는 신청시각인 K열(row[10])로 대체한다.
      var scRaw = row[3] || row[10];
      result.push({ sheetType: "scenario", rowIndex: i + 2, borrowerName: row[0], scenarioId: row[1], itemLabel: label, itemId: itemId, itemKind: row[11] || "추가 대여물품", location: itemId ? (locations[itemId] || "") : "", quantity: parsedQty, borrowDate: formatDateValue_(row[3]), borrowDateTime: (formatDateTimeFull_(row[3]) || formatDateTimeFull_(row[10])), shift: computeShiftFromRaw_(scRaw), borrowPurpose: row[4], email: String(row[7] || "").trim(), batchId: batchId, floor: seatLoc.floor || "", unit: seatLoc.unit || "", image: obj.image || "", stock: obj.stock || 0, rented: obj.rented || 0, pickedUp: String(row[12] || "").trim() || undefined });
    });
  }
  var generalSheet = ss.getSheetByName(GENERAL_SHEET_NAME);
  if (generalSheet && generalSheet.getLastRow() > 1) {
    // N열(14번째, index 13): 대여 실물 확인(체크) 완료 시각.
    var generalWidth = Math.max(generalSheet.getLastColumn(), GENERAL_COL_COUNT, 14);
    var general = generalSheet.getRange(2, 1, generalSheet.getLastRow() - 1, generalWidth).getValues();
    general.forEach(function (row, i) {
      if (String(row[6]).trim() === "O") return;
      var id = String(row[1] || "").trim(), qty = row[3] || 1;
      var pid = padSlot_(id);
      var obj = objectMap[pid] || {};
      var groupInfo = buildGeneralGroupInfo_(row[0], row[11], row[4]);
      var batchId = String(row[10] || "");
      var seatLoc = locMap[batchId] || {};
      // 일반대여는 E열(row[4], 대여일)에 시간까지 들어 있는 게 정상이지만,
      // 비어 있을 때는 신청시각인 L열(row[11])로 대체한다.
      var gnRaw = row[4] || row[11];
      result.push({ sheetType: "general", rowIndex: i + 2, borrowerName: row[0], itemId: pid, itemLabel: (id ? "[" + pid + "] " : "") + row[2] + (qty > 1 ? " x " + qty : ""), location: locations[pid] || "", quantity: qty, borrowDate: formatDateValue_(row[4]), borrowDateTime: (formatDateTimeFull_(row[4]) || formatDateTimeFull_(row[11])), shift: computeShiftFromRaw_(gnRaw), submitGroupKey: groupInfo.key, submitDisplay: groupInfo.display, borrowPurpose: row[5], email: String(row[8] || "").trim(), batchId: batchId, floor: seatLoc.floor || "", unit: seatLoc.unit || "", generalOption: String(row[12] || ""), image: obj.image || "", stock: obj.stock || 0, rented: obj.rented || 0, pickedUp: String(row[13] || "").trim() || undefined });
    });
  }

  // 계산하는 동안 다른 요청이 대여/반납을 기록해 버전이 바뀌었다면, 이 결과는 이미
  // 낡은 스냅샷일 수 있으니 캐시에 쓰지 않는다 (다음 조회가 새로 계산하게 둔다).
  if (getDataVersion_() === versionAtStart_) {
    cachePutLarge_("unreturnedItems_v2", JSON.stringify(result), 60);
  }
  return result;
}

/**
 * "가장 적게 대여된 물품" 랭킹.
 * 예전에는 프론트가 getScenarioAllLogs로 전체 로그를 받아 직접 집계했는데,
 * 실제로 필요한 값은 물품명과 수량뿐인데도 두 시트 전체를 읽고 마스터·좌석과 조인해
 * 수 MB를 내려보내느라 매우 느렸다. 여기서는 필요한 열만 읽어 서버에서 집계하고
 * 상위 N개만 돌려준다. 결과는 자주 바뀌지 않으므로 10분간 캐시한다.
 */
function getLeastBorrowedItems_(ss, limit) {
  limit = limit > 0 ? limit : 20;
  var cacheKey = "leastBorrowed_v1_" + limit;
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (e) { /* 캐시 실패 시 그냥 계산 */ }

  // 1) 카탈로그: 이름을 0으로 깔아둔다 (한 번도 대여 안 된 물품이 상위에 오도록).
  //    랭킹 제외(J열 = "Y") 물품은 아예 제외한다.
  var counts = {};
  var objSheet = ss.getSheetByName(OBJECT_SHEET_NAME);
  if (objSheet && objSheet.getLastRow() > 1) {
    var objRows = objSheet.getRange(2, 1, objSheet.getLastRow() - 1, 10).getValues();
    for (var i = 0; i < objRows.length; i++) {
      var nm = String(objRows[i][1] || "").trim();
      if (!nm) continue;
      if (String(objRows[i][9] || "").trim().toUpperCase() === "Y") continue; // 랭킹 제외
      counts[nm] = 0;
    }
  }

  // 2) SID대여: C열(물품 라벨)만 읽어 이름·수량을 파싱
  var scSheet = ss.getSheetByName(SCENARIO_SHEET_NAME);
  if (scSheet && scSheet.getLastRow() > 1) {
    var labels = scSheet.getRange(2, 3, scSheet.getLastRow() - 1, 1).getValues();
    for (var j = 0; j < labels.length; j++) {
      var label = String(labels[j][0] || "").trim();
      if (!label || label === "(물품 미등록)") continue;
      var parsed = parseItemLabel_(label);
      var pname = String(parsed.name || "").trim();
      if (!pname) continue;
      if (counts[pname] === undefined) continue; // 카탈로그에 없거나 랭킹 제외된 물품
      counts[pname] += (parsed.quantity || 1);
    }
  }

  // 3) 일반대여: C열(물품명), D열(수량)만 읽는다
  var gnSheet = ss.getSheetByName(GENERAL_SHEET_NAME);
  if (gnSheet && gnSheet.getLastRow() > 1) {
    var gnRows = gnSheet.getRange(2, 3, gnSheet.getLastRow() - 1, 2).getValues();
    for (var k = 0; k < gnRows.length; k++) {
      var gname = String(gnRows[k][0] || "").trim();
      if (!gname) continue;
      if (counts[gname] === undefined) continue;
      var q = Number(gnRows[k][1]);
      counts[gname] += (isNaN(q) || q <= 0) ? 1 : q;
    }
  }

  // 4) 적게 대여된 순으로 정렬해 상위 limit개만
  var arr = Object.keys(counts).map(function (n) { return [n, counts[n]]; });
  arr.sort(function (a, b) { return a[1] - b[1] || (a[0] < b[0] ? -1 : 1); });
  var result = arr.slice(0, limit);

  try { CacheService.getScriptCache().put(cacheKey, JSON.stringify(result), 600); } catch (e) { /* 무시 */ }
  return result;
}

/**
 * 배치ID 하나에 속한 대여/반납 기록을 모두 돌려준다.
 * (한 번의 신청에 무엇이 함께 나갔는지 확인하는 용도)
 * SID대여·일반대여 두 시트를 모두 훑고, 반납 완료 건도 포함한다.
 */
function getBatchDetail_(ss, batchId) {
  var target = String(batchId || "").trim();
  if (!target) return [];

  var locations = {};
  getObjectItemsCached_().forEach(function (o) { locations[o.id] = o.rootSlot; });
  var locMap = getSeatLocationMapCached_(ss);
  var seat = locMap[target] || {};
  var result = [];

  var sc = ss.getSheetByName(SCENARIO_SHEET_NAME);
  if (sc && sc.getLastRow() > 1) {
    var scData = sc.getRange(2, 1, sc.getLastRow() - 1, Math.max(sc.getLastColumn(), SCENARIO_LOG_ITEM_KIND_COL)).getValues();
    scData.forEach(function (row, i) {
      if (String(row[9] || "").trim() !== target) return;
      var label = row[2] || "(물품 미등록)";
      var m = String(label).match(/^\[(\d+)\]/);
      var itemId = m ? padSlot_(m[1]) : "";
      var parsed = parseItemLabel_(label);
      result.push({
        sheetType: "scenario", rowIndex: i + 2,
        borrowerName: row[0], scenarioId: row[1],
        itemId: itemId, itemName: parsed.name || label, itemLabel: label,
        // SID대여는 D열(대여일)에 시간까지 들어 있다. 그 값을 우선 쓰고,
        // 비어 있을 때만 신청시각(K열)으로 대체한다.
        borrowDateTime: (formatDateTimeFull_(row[3]) || formatDateTimeFull_(row[10])),
        shift: computeShiftFromRaw_(row[3] || row[10]),
        quantity: parsed.quantity || 1,
        location: itemId ? (locations[itemId] || "") : "",
        borrowDate: formatDateValue_(row[3]),
        borrowPurpose: row[4],
        returned: String(row[5]).trim() === "O",
        returnDate: formatDateTimeFull_(row[6]),
        itemKind: row[11] || "",
        floor: seat.floor || "", unit: seat.unit || ""
      });
    });
  }

  var gn = ss.getSheetByName(GENERAL_SHEET_NAME);
  if (gn && gn.getLastRow() > 1) {
    var gnData = gn.getRange(2, 1, gn.getLastRow() - 1, Math.max(gn.getLastColumn(), GENERAL_COL_COUNT)).getValues();
    gnData.forEach(function (row, i) {
      if (String(row[10] || "").trim() !== target) return;
      var pid = padSlot_(String(row[1] || "").trim());
      var qty = row[3] || 1;
      result.push({
        sheetType: "general", rowIndex: i + 2,
        borrowerName: row[0], scenarioId: "",
        itemId: pid, itemName: row[2],
        // 일반대여는 E열(대여일)에 시간까지 들어 있다.
        borrowDateTime: (formatDateTimeFull_(row[4]) || formatDateTimeFull_(row[11])),
        shift: computeShiftFromRaw_(row[4] || row[11]), itemLabel: (row[1] ? "[" + pid + "] " : "") + row[2] + (qty > 1 ? " x " + qty : ""),
        quantity: qty,
        location: locations[pid] || "",
        borrowDate: formatDateValue_(row[4]),
        borrowPurpose: row[5],
        returned: String(row[6]).trim() === "O",
        returnDate: formatDateTimeFull_(row[7]),
        itemKind: String(row[12] || ""),
        floor: seat.floor || "", unit: seat.unit || ""
      });
    });
  }

  // 위치 순으로 정렬해 창고에서 찾기 쉽게 한다
  result.sort(function (a, b) {
    return computeLocationSortIndex_(a.location || "") - computeLocationSortIndex_(b.location || "");
  });
  return result;
}

/**
 * 창고물품(공구 및 부품류) 대여로그 조회.
 * 이 시트는 헤더 없이 1행부터 데이터이며, 한 줄이 곧 하나의 사건(대여/반납/소모)이다.
 * recentDays를 주면 그 기간 내 기록만 돌려준다.
 */
// 이미 정렬된 로그 배열을 "건수"가 아니라 "사람 수" 기준으로 잘라 돌려준다.
// (한 사람이 여러 건에 걸쳐 흩어져 있을 수 있으므로, 등장 순서대로 사람을 정하고
//  그 사람들의 건은 전부 포함시킨다 — 프론트의 limitByPeople와 동일한 규칙)
function paginateLogsByPeople_(items, getNameFn, offset, limit) {
  if (!limit || limit <= 0) return { items: items, hasMore: false, totalPeople: 0 };
  var order = [];
  var seen = {};
  items.forEach(function (it) {
    var name = String(getNameFn(it) || "").trim() || "(이름 없음)";
    if (!seen[name]) { seen[name] = true; order.push(name); }
  });
  var totalPeople = order.length;
  var pageNames = {};
  order.slice(offset, offset + limit).forEach(function (n) { pageNames[n] = true; });
  var pageItems = items.filter(function (it) {
    var name = String(getNameFn(it) || "").trim() || "(이름 없음)";
    return !!pageNames[name];
  });
  return { items: pageItems, hasMore: offset + limit < totalPeople, totalPeople: totalPeople };
}

function getWarehouseLogs_(ss, recentDays) {
  var sheet = ss.getSheetByName(RENT_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 1) return [];

  var cutoffMs = 0;
  if (recentDays > 0) {
    var cut = new Date();
    cut.setDate(cut.getDate() - recentDays);
    cutoffMs = cut.getTime();
  }

  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(1, 1, lastRow, 7).getValues();
  var display = sheet.getRange(1, 1, lastRow, 7).getDisplayValues();
  var out = [];

  for (var i = 0; i < lastRow; i++) {
    var row = values[i];
    var loc = String(row[2] || "").trim();
    var nm = String(row[3] || "").trim();
    if (!loc && !nm) continue; // 빈 줄 / 실수로 남은 헤더 방어

    var ts = String(display[i][0] || "").replace(/^'/, "").trim();
    if (cutoffMs) {
      var t = Date.parse(ts.replace(" ", "T"));
      if (!isNaN(t) && t < cutoffMs) continue;
    }

    var q = (row[4] === "" || row[4] == null) ? 0 : Number(row[4]);
    if (isNaN(q)) q = 0;
    var note = String(row[6] || "").trim();
    var typ = String(row[1] || "대여").trim();
    // 반납 로그에 [소모완료]가 붙은 건은 실질적으로 소모 처리다.
    if (typ === "반납" && note.indexOf("[소모완료]") !== -1) typ = "소모";

    out.push({
      rowIndex: i + 1,
      timestamp: ts,
      type: typ,
      location: loc,
      name: nm,
      quantity: q,
      user: String(row[5] || "").trim(),
      note: note
    });
  }

  // 최신순
  out.sort(function (a, b) {
    var ta = Date.parse(String(a.timestamp || "").replace(" ", "T"));
    var tb = Date.parse(String(b.timestamp || "").replace(" ", "T"));
    if (isNaN(ta)) ta = 0;
    if (isNaN(tb)) tb = 0;
    return tb - ta || b.rowIndex - a.rowIndex;
  });
  return out;
}

// 시나리오 대여 대장 전체 조회 (반납 완료 항목 포함, 최신순 정렬)
// 반납 여부: SID대여 row[5]='O', 일반대여 row[6]='O'
function getScenarioAllLogs_(recentDays, scope, slim) {
  recentDays = recentDays > 0 ? recentDays : 0;
  scope = (scope === "unreturned" || scope === "returned") ? scope : "all";
  slim = !!slim;
  var cacheKey = "scenarioAllLogs_v2_" + recentDays + "_" + scope + "_" + (slim ? "s" : "f");
  var cachedLogs = cacheGetLarge_(cacheKey);
  if (cachedLogs) {
    try { return JSON.parse(cachedLogs); } catch (e) { /* 파싱 실패 시 재계산 */ }
  }
  var versionAtStart_ = getDataVersion_(); // 계산 도중 다른 변경이 끼어들면 캐시에 안 쓰기 위한 기준점

  var ss = SpreadsheetApp.getActiveSpreadsheet(), result = [];
  // recentDays가 지정되면 반납 완료 건 중 오래된 것은 제외한다.
  // 미반납 건은 아무리 오래됐어도 항상 포함한다 (반납 처리를 해야 하므로).
  var cutoffMs = 0;
  if (recentDays > 0) {
    var cut = new Date();
    cut.setDate(cut.getDate() - recentDays);
    cutoffMs = cut.getTime();
  }
  // scope에 따라 미반납/반납분만 남긴다.
  var inScope_ = function (returned) {
    if (scope === "unreturned") return !returned;
    if (scope === "returned") return !!returned;
    return true;
  };
  var withinCutoff_ = function (returned, returnDateStr, borrowDateStr) {
    if (!cutoffMs || !returned) return true; // 필터 없음 또는 미반납 → 항상 포함
    var basis = String(returnDateStr || borrowDateStr || "").trim();
    if (!basis) return true; // 날짜를 알 수 없으면 안전하게 포함
    var t = Date.parse(basis.replace(" ", "T"));
    if (isNaN(t)) return true;
    return t >= cutoffMs;
  };
  var locations = {}, objectMap = {};
  getObjectItemsCached_().forEach(function (o) { locations[o.id] = o.rootSlot; objectMap[o.id] = o; });
  var locMap = getSeatLocationMapCached_(ss);

  var scenarioSheet = ss.getSheetByName(SCENARIO_SHEET_NAME);
  if (scenarioSheet && scenarioSheet.getLastRow() > 1) {
    var data = scenarioSheet.getRange(2, 1, scenarioSheet.getLastRow() - 1, Math.max(scenarioSheet.getLastColumn(), SCENARIO_LOG_ITEM_KIND_COL)).getValues();
    data.forEach(function (row, i) {
      if (!row[0] && !row[2]) return; // 빈 행
      var returned = String(row[5]).trim() === "O";
      if (!inScope_(returned)) return;
      // 같은 셀을 여러 번 포맷하지 않도록 한 번씩만 계산해서 재사용한다 (행이 많을 때 체감이 크다)
      var borrowDT = formatDateTimeFull_(row[3]);
      var returnDT = formatDateTimeFull_(row[6]);
      if (!withinCutoff_(returned, returnDT, borrowDT)) return;
      var label = row[2] || "(물품 미등록)";
      var idMatch = String(label).match(/^\[(\d+)\]/);
      var itemId = idMatch ? padSlot_(idMatch[1]) : "";
      var parsedLabel = parseItemLabel_(label);
      var parsedQty = parsedLabel.quantity || 1;
      var obj = objectMap[itemId] || {};
      var batchId = String(row[9] || "");
      var seatLoc = locMap[batchId] || {};
      result.push({
        sheetType: "scenario", rowIndex: i + 2, borrowerName: row[0], scenarioId: row[1],
        itemLabel: label, itemKind: row[11] || "추가 대여물품",
        location: itemId ? (locations[itemId] || "") : "", itemId: itemId, itemName: parsedLabel.name || label,
        quantity: parsedQty, borrowDate: formatDateValue_(row[3]), borrowDateTime: (borrowDT || formatDateTimeFull_(row[10])), borrowPurpose: row[4],
        email: String(row[7] || "").trim(), batchId: batchId,
        floor: seatLoc.floor || "", unit: seatLoc.unit || "",
        returned: returned, returnedMark: String(row[5] || "").trim(),
        returnDate: returnDT,
        shift: computeShiftFromRaw_(row[3]),
        image: obj.image || "", stock: obj.stock || 0, rented: obj.rented || 0
      });
    });
  }

  var generalSheet = ss.getSheetByName(GENERAL_SHEET_NAME);
  if (generalSheet && generalSheet.getLastRow() > 1) {
    var general = generalSheet.getRange(2, 1, generalSheet.getLastRow() - 1, Math.max(generalSheet.getLastColumn(), GENERAL_COL_COUNT)).getValues();
    general.forEach(function (row, i) {
      if (!row[0] && !row[2]) return;
      var returned = String(row[6]).trim() === "O";
      if (!inScope_(returned)) return;
      var borrowDT2 = formatDateTimeFull_(row[4]);
      var returnDT2 = formatDateTimeFull_(row[7]);
      if (!withinCutoff_(returned, returnDT2, borrowDT2)) return;
      var id = String(row[1] || "").trim(), qty = row[3] || 1;
      var pid = padSlot_(id);
      var obj = objectMap[pid] || {};
      var groupInfo = buildGeneralGroupInfo_(row[0], row[11], row[4]);
      var batchId = String(row[10] || "");
      var seatLoc = locMap[batchId] || {};
      result.push({
        sheetType: "general", rowIndex: i + 2, borrowerName: row[0],
        itemLabel: (id ? "[" + pid + "] " : "") + row[2] + (qty > 1 ? " x " + qty : ""),
        location: locations[pid] || "", itemId: pid, itemName: row[2],
        quantity: qty, borrowDate: formatDateValue_(row[4]), borrowDateTime: (borrowDT2 || formatDateTimeFull_(row[11])),
        submitGroupKey: groupInfo.key, submitDisplay: groupInfo.display, borrowPurpose: row[5],
        email: String(row[8] || "").trim(), batchId: batchId, generalOption: String(row[12] || ""),
        floor: seatLoc.floor || "", unit: seatLoc.unit || "",
        returned: returned, returnedMark: String(row[6] || "").trim(),
        returnDate: returnDT2,
        shift: computeShiftFromRaw_(row[4]),
        image: obj.image || "", stock: obj.stock || 0, rented: obj.rented || 0
      });
    });
  }

  // 최신 활동순 정렬: 대여일과 반납일 중 더 나중 시각을 기준으로 내림차순 정렬한다.
  // 이렇게 하면 오래 전에 대여된 건이라도 방금 반납 처리되면 목록 맨 위로 올라온다.
  var parseTs_ = function (v) {
    var s = String(v || "").trim();
    if (!s) return 0;
    var t = Date.parse(s.replace(" ", "T"));
    return isNaN(t) ? 0 : t;
  };
  // 대여일은 표시용(borrowDate)이 날짜만 담고 있어 자정으로 취급되므로,
  // 정렬에는 시간까지 살린 borrowDateTime을 쓴다. 그러지 않으면 같은 날 기록에서
  // 반납 건이 항상 대여 건보다 위로 올라간다.
  var activityTs_ = function (row) {
    return Math.max(parseTs_(row.borrowDateTime || row.borrowDate), parseTs_(row.returnDate));
  };
  result.sort(function (a, b) {
    return (activityTs_(b) - activityTs_(a)) || ((b.rowIndex || 0) - (a.rowIndex || 0));
  });

  // slim이면 화면에서 쓰지 않는 필드를 떼어 전송량을 줄인다 (4000행 규모에서 체감이 크다).
  if (slim) {
    for (var s2 = 0; s2 < result.length; s2++) {
      delete result[s2].image;
      delete result[s2].stock;
      delete result[s2].rented;
      delete result[s2].submitGroupKey;
      delete result[s2].submitDisplay;
      delete result[s2].returnedMark;
    }
  }

  // 대여/반납이 있을 때마다 무효화되므로, 짧은 캐시라도 반복 조회에서 큰 차이를 만든다.
  // 단, 계산 도중 다른 변경으로 버전이 바뀌었다면 낡은 결과를 캐시에 남기지 않는다.
  if (getDataVersion_() === versionAtStart_) {
    cachePutLarge_(cacheKey, JSON.stringify(result), 120);
  }
  return result;
}

/**
 * 대여 중인 한 건을 다른 물품으로 교체한다.
 * "기존 물품 반납 + 새 물품 대여"를 한 번의 요청으로 처리하며,
 * 대여자·배치ID·층수/유닛·목적을 그대로 승계해 좌석 조회와 알림이 끊기지 않게 한다.
 *
 * payload: { sheetType, rowIndex, newItemId, newQuantity, reason, clientVersion }
 */
function swapBorrowItem_(ss, payload) {
  if (!payload || !payload.clientVersion || payload.clientVersion !== APP_VERSION) {
    return { success: false, message: "구버전 화면을 사용 중입니다. 새로고침(F5) 후 다시 시도해주세요. (최신 버전: " + APP_VERSION + ")" };
  }
  try {
    var isScenario = payload.sheetType === "scenario";
    var sheet = ss.getSheetByName(isScenario ? SCENARIO_SHEET_NAME : GENERAL_SHEET_NAME);
    if (!sheet) return { success: false, message: "대여 로그 시트를 찾을 수 없습니다." };

    var rowIndex = Number(payload.rowIndex);
    if (!rowIndex || rowIndex < 2 || rowIndex > sheet.getLastRow()) {
      return { success: false, message: "올바르지 않은 행 번호입니다. 목록을 새로고침한 뒤 다시 시도해주세요." };
    }

    var colCount = isScenario ? SCENARIO_LOG_ITEM_KIND_COL : Math.max(sheet.getLastColumn(), GENERAL_COL_COUNT);
    var data = sheet.getRange(rowIndex, 1, 1, colCount).getValues()[0];
    var returnedCol = isScenario ? 6 : 7;
    if (String(data[returnedCol - 1]).trim() === "O") {
      return { success: false, message: "이미 반납 처리된 건입니다. 목록을 새로고침해주세요." };
    }

    // 기존 물품 정보
    var oldItem, borrower, email, batchId, purpose, sid = "", generalOption = "";
    if (isScenario) {
      borrower = data[0]; sid = data[1];
      oldItem = data[2] ? parseItemLabel_(data[2]) : { id: "", name: "", quantity: 1 };
      purpose = data[4]; email = String(data[7] || "").trim(); batchId = String(data[9] || "");
    } else {
      borrower = data[0];
      oldItem = { id: String(data[1] || "").trim(), name: String(data[2] || "").trim(), quantity: data[3] || 1 };
      purpose = data[5]; email = String(data[8] || "").trim(); batchId = String(data[10] || "");
      generalOption = String(data[12] || "").trim();
    }
    var oldQty = Number(oldItem.quantity) || 1;

    // 새 물품 검증
    var newId = padSlot_(String(payload.newItemId || "").trim());
    if (!newId) return { success: false, message: "교체할 물품을 선택해주세요." };
    var newQty = parseInt(payload.newQuantity, 10);
    if (isNaN(newQty) || newQty <= 0) newQty = oldQty;

    if (padSlot_(String(oldItem.id || "").trim()) === newId && newQty === oldQty) {
      return { success: false, message: "기존과 동일한 물품·수량입니다. 변경할 내용이 없습니다." };
    }

    var objectMap = {};
    getObjectItemsCached_().forEach(function (o) { objectMap[o.id] = o; });
    var newObj = objectMap[newId];
    if (!newObj) return { success: false, message: "'" + newId + "' 물품을 시나리오 오브젝트 시트에서 찾을 수 없습니다." };
    if (newQty > (newObj.stock || 0)) {
      return { success: false, message: "재고 부족: '" + newObj.name + "'의 요청 수량(" + newQty + "개)이 사용 가능한 재고(" + (newObj.stock || 0) + "개)를 초과합니다." };
    }

    var now = new Date();
    var today = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    var reason = String(payload.reason || "").trim();
    var swapNote = "[교체] " + (oldItem.name || oldItem.id || "") + " → " + newObj.name + (reason ? " (" + reason + ")" : "");

    // 1) 기존 건 반납 처리
    sheet.getRange(rowIndex, returnedCol).setValue("O");
    sheet.getRange(rowIndex, returnedCol + 1).setValue(today);
    var swapChanges = {};
    if (oldItem.id) accInventory_(swapChanges, oldItem.id, -oldQty);

    // 2) 새 물품을 같은 조건으로 대여 기록 (배치ID·층/유닛 승계)
    var newRow;
    if (isScenario) {
      newRow = [borrower, sid, scenarioItemLabel_({ id: newId, name: newObj.name, quantity: newQty }),
        today, purpose, "X", "", email, "", batchId, now, "교체 물품"];
    } else {
      newRow = [borrower, newId, newObj.name, newQty, today, purpose, "X", "", email, "", batchId, now, generalOption];
    }
    sheet.appendRow(newRow);
    accInventory_(swapChanges, newId, newQty);
    updateInventoryBatch_(swapChanges);

    // 재고변경이력에 두 줄 남긴다 — 기존 물품은 반납(대여 중 감소), 새 물품은 대여(대여 중 증가)
    try {
      if (oldItem.id) {
        var oldObjForLog = objectMap[padSlot_(String(oldItem.id).trim())];
        var oldRentedBefore = oldObjForLog ? (oldObjForLog.rented || 0) : 0;
        logStockChange_(ss, "시나리오 물품", padSlot_(String(oldItem.id).trim()), oldItem.name || "",
          oldRentedBefore, Math.max(0, oldRentedBefore - oldQty),
          "물품 교체로 반납 (" + borrower + ") — 재고 아님, 대여 중 수량 변화", borrower);
      }
      var newRentedBefore = newObj.rented || 0;
      logStockChange_(ss, "시나리오 물품", newId, newObj.name || "",
        newRentedBefore, newRentedBefore + newQty,
        "물품 교체로 대여 (" + borrower + ") — 재고 아님, 대여 중 수량 변화", borrower);
    } catch (logErr) { /* 이력 기록 실패는 교체 처리 자체를 막지 않는다 */ }

    // 3) Slack 알림
    var locations = buildLocationMap_();
    var seatLocMap = getSeatLocationMap_(ss);
    var seatLoc = batchId ? seatLocMap[batchId] : null;
    var mainLines = ["🔄 *대여 물품 교체*", "• 대여자: " + buildMentionText_(borrower, email, "")];
    if (sid) mainLines.push("• 시나리오 ID: " + sid);
    if (seatLoc && (seatLoc.floor || seatLoc.unit)) mainLines.push("• 위치: " + [seatLoc.floor, seatLoc.unit].filter(Boolean).join(" · "));
    if (reason) mainLines.push("• 사유: " + reason);

    var ts = postSlackMessage_(boxWrap_(mainLines.join("\n")));
    var slackNote = "";
    var detail = "➖ *반납 처리된 기존 물품*\n"
      + objectLocationLine_(oldItem.id, oldItem.name, oldQty, locations)
      + "\n\n➕ *새로 대여된 물품*\n"
      + objectLocationLine_(newId, newObj.name, newQty, locations);
    if (ts) {
      postThreadReply_(detail, ts);
    } else {
      var combined = postSlackMessage_(boxWrap_(mainLines.join("\n") + "\n───────────────\n" + detail));
      slackNote = combined ? " (스레드 없이 단일 메시지로 발송했습니다)"
        : " (Slack 발송 실패: " + lastSlackError_ + ")";
    }

    return {
      success: true,
      message: (oldItem.name || oldItem.id) + " " + oldQty + "개를 " + newObj.name + " " + newQty + "개로 교체했습니다." + slackNote,
      note: swapNote
    };
  } catch (e) {
    return { success: false, message: "물품 교체 중 오류: " + e.message };
  }
}

// 대여 실물 확인(체크) 처리 — 반납의 processReturn과 대칭되는 함수다.
// 재고/대여중 수량은 이미 대여 신청 시점에 반영되어 있으므로 여기서는 건드리지 않고,
// "관리자가 실물을 하나하나 확인했다"는 시각만 SID대여는 M열, 일반대여는 N열에 남긴다.
function confirmPickup_(items) {
  if (!Array.isArray(items) || !items.length) return { success: false, message: "확인할 물품을 선택해주세요." };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var scenarioSheet = ss.getSheetByName(SCENARIO_SHEET_NAME);
  var generalSheet = ss.getSheetByName(GENERAL_SHEET_NAME);
  var now = new Date();
  var stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var processed = 0;

  items.forEach(function (it) {
    var isScenario = it.sheetType === "scenario";
    var sheet = isScenario ? scenarioSheet : generalSheet;
    if (!sheet || !it.rowIndex || it.rowIndex < 2) return;
    var returnedCol = isScenario ? 6 : 7; // F열 / G열
    var pickedCol = isScenario ? 13 : 14; // M열 / N열
    var rowVals = sheet.getRange(it.rowIndex, 1, 1, Math.max(returnedCol, pickedCol)).getValues()[0];
    if (String(rowVals[returnedCol - 1] || "").trim() === "O") return; // 이미 반납된 행은 건드리지 않는다
    if (String(rowVals[pickedCol - 1] || "").trim()) return; // 이미 확인된 행은 건너뛴다 (중복 기록 방지)
    sheet.getRange(it.rowIndex, pickedCol).setValue(stamp);
    processed += 1;
  });

  if (processed === 0) return { success: false, message: "확인 처리할 항목을 찾지 못했습니다. (이미 처리되었거나 이미 반납된 건일 수 있습니다)" };
  return { success: true, message: processed + "건을 대여 확인 처리했습니다." };
}

function processReturn(returnRequests, clientVersion) {
  if (!Array.isArray(returnRequests) || !returnRequests.length) return { success: false, message: "반납할 물품을 선택해주세요." };
  if (!clientVersion || clientVersion !== APP_VERSION) {
    return { success: false, message: "구버전 화면을 사용 중입니다. 반납 처리 기능이 작동하지 않습니다. 페이지를 새로고침(F5)하여 최신 버전으로 접속한 뒤 다시 시도해주세요. (현재 버전: " + (clientVersion || "미확인") + ", 최신 버전: " + APP_VERSION + ")" };
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet(), scenarioSheet = ss.getSheetByName(SCENARIO_SHEET_NAME), generalSheet = ss.getSheetByName(GENERAL_SHEET_NAME);
    var now = new Date(), today = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    var locations = buildLocationMap_();
    var groups = {};
    var order = [];
    var processed = 0;
    var invChanges = {};
    var returnedNames = {}; // 이력 기록용 — itemId별 물품명
    var seatLocMap = getSeatLocationMapCached_(ss);

    returnRequests.forEach(function (request) {
      var isScenario = request.sheetType === "scenario";
      var sheet = isScenario ? scenarioSheet : generalSheet;
      if (!sheet || !request.rowIndex || request.rowIndex < 2) return;
      var colCount = isScenario ? SCENARIO_LOG_ITEM_KIND_COL : Math.max(sheet.getLastColumn(), GENERAL_COL_COUNT);
      var data = sheet.getRange(request.rowIndex, 1, 1, colCount).getValues()[0];
      var returnedCol = isScenario ? 6 : 7;
      if (String(data[returnedCol - 1]).trim() === "O") return;

      var borrower, email, item = null, sid = "", isGeneral = false, option = "";
      var returnBatchId = isScenario ? String(data[9] || "") : String(data[10] || "");
      if (isScenario) {
        borrower = data[0]; sid = data[1]; email = String(data[7] || "").trim();
        if (data[2]) item = parseItemLabel_(data[2]);
      } else {
        borrower = data[0]; email = String(data[8] || "").trim(); isGeneral = true;
        item = { id: data[1], name: data[2], quantity: data[3] || 1 };
        option = String(data[12] || "").trim();
      }

      var rowQty = item ? (item.quantity || 1) : 1;
      var reqQty = parseInt(request.quantity, 10);
      if (isNaN(reqQty) || reqQty <= 0) reqQty = rowQty;
      if (reqQty > rowQty) reqQty = rowQty;

      if (reqQty < rowQty) {
        var remainQty = rowQty - reqQty;
        var returnedRow = data.slice();
        returnedRow[returnedCol - 1] = "O";
        returnedRow[returnedCol] = today;
        if (isScenario) {
          sheet.getRange(request.rowIndex, 3).setValue(scenarioItemLabel_({ id: item.id, name: item.name, quantity: remainQty }));
          returnedRow[2] = scenarioItemLabel_({ id: item.id, name: item.name, quantity: reqQty });
        } else {
          sheet.getRange(request.rowIndex, 4).setValue(remainQty);
          returnedRow[3] = reqQty;
        }
        sheet.appendRow(returnedRow);
      } else {
        // 반납여부 + 반납일을 한 번에 쓴다 (setValue 두 번 → setValues 한 번)
        sheet.getRange(request.rowIndex, returnedCol, 1, 2).setValues([["O", today]]);
      }
      processed += reqQty;
      if (item) item = { id: item.id, name: item.name, quantity: reqQty };

      // 반납이므로 음수로 누적 (재고 +, 대여중 −)
      if (item && item.id) {
        accInventory_(invChanges, item.id, -reqQty);
        var loggedPid = padSlot_(String(item.id || "").trim());
        if (loggedPid && !returnedNames[loggedPid]) returnedNames[loggedPid] = item.name;
      }

      if (!groups[borrower]) { groups[borrower] = { borrower: borrower, email: email, sids: [], hasGeneral: false, items: [], options: [], locations: [] }; order.push(borrower); }
      if (!groups[borrower].email && email) groups[borrower].email = email;
      if (sid && groups[borrower].sids.indexOf(sid) === -1) groups[borrower].sids.push(sid);
      if (isGeneral) {
        groups[borrower].hasGeneral = true;
        if (option && groups[borrower].options.indexOf(option) === -1) groups[borrower].options.push(option);
      }
      if (item) groups[borrower].items.push(item);
      // 원래 대여 당시 입력했던 층수/유닛을 batchId로 역추적해 반납 알림에도 표시한다.
      var seatLoc = returnBatchId ? seatLocMap[returnBatchId] : null;
      if (seatLoc && (seatLoc.floor || seatLoc.unit)) {
        var locLabel = [seatLoc.floor, seatLoc.unit].filter(Boolean).join(" · ");
        if (groups[borrower].locations.indexOf(locLabel) === -1) groups[borrower].locations.push(locLabel);
      }
    });

    // 모아둔 재고 변경을 한 번에 반영
    var beforeRented_ = {};
    getObjectItemsCached_().forEach(function (o) { beforeRented_[o.id] = o.rented || 0; });
    updateInventoryBatch_(invChanges);
    invalidateLogCaches_();

    // 재고변경이력에도 남긴다 (재고 자체는 안 바뀌지만, "대여 중" 수량 변화를 추적한다)
    try {
      for (var retId in invChanges) {
        var retOld = beforeRented_[retId] || 0;
        var retNew = Math.max(0, retOld + invChanges[retId]); // invChanges는 반납이라 음수
        logStockChange_(ss, "시나리오 물품", retId, returnedNames[retId] || "", retOld, retNew,
          "반납 처리 — 재고 아님, 대여 중 수량 변화", "-");
      }
    } catch (logErr) { /* 이력 기록 실패는 반납 처리 자체를 막지 않는다 */ }

    // ── Slack: 메인 메시지와 댓글을 연이어 보낸다 ──
    // 예전에는 댓글에 "현재 대여 중인 물품"을 담느라 getUnreturnedItems()를 한 번 더 돌렸는데,
    // 두 시트를 다시 훑는 무거운 작업이라 처리 시간이 길어졌다. 그 댓글은 없앴다.
    // (잔여 현황은 관리자 반납 화면과 연체 DM에서 확인할 수 있다)
    var mainTexts = [];
    var replyTexts = [];
    order.forEach(function (borrower) {
      var g = groups[borrower];
      var mainLines = ["✅ *반납 처리*", "• 반납자: " + buildMentionText_(g.borrower, g.email, "")];
      if (g.sids.length) mainLines.push("• 시나리오 ID: " + g.sids.join(", "));
      if (g.hasGeneral) mainLines.push(g.sids.length ? "• 일반 반납 물품 포함" : "• 일반 반납");
      if (g.options.length) mainLines.push("• 대여구분: " + g.options.join(", "));
      if (g.locations && g.locations.length) mainLines.push("• 위치: " + g.locations.join(", "));
      mainTexts.push(boxWrap_(mainLines.join("\n")));

      var returnLines = buildMergedLocationLines_(g.items, locations);
      var returnSummary = getSummaryCountText_(g.items);
      replyTexts.push("📍 *반납 물품 · 위치* (총 " + returnSummary + ")\n" + (returnLines.join("\n") || "없음") + "\n반납일: " + today);
    });

    var slackNote = "";
    var mainTsList = postSlackMessagesBatch_(mainTexts);

    var replyBatch = [];
    for (var mi = 0; mi < order.length; mi++) {
      if (mainTsList[mi]) {
        replyBatch.push({ ts: mainTsList[mi], text: replyTexts[mi] });
      } else {
        // 메인 메시지가 실패했으면 스레드 없이 하나로 합쳐 남긴다
        var combined = postSlackMessage_(mainTexts[mi] + "\n" + replyTexts[mi]);
        slackNote = combined
          ? " (스레드 없이 단일 메시지로 발송했습니다)"
          : " (Slack 발송 실패: " + lastSlackError_ + " — 봇을 채널에 초대했는지 확인하세요)";
      }
    }
    postThreadRepliesBatch_(replyBatch);

    return { success: true, message: processed + "개 물품의 반납을 처리했습니다." + slackNote };
  } catch (e) { return { success: false, message: "반납 처리 중 오류: " + e.message }; }
}

function getMyBorrowedItems(borrowerName, employeeId) {
  var name = String(borrowerName || "").trim();
  if (!name) return [];
  var expectedEmail = "";
  var empId = String(employeeId || "").trim();
  if (empId && /^\d+$/.test(empId)) expectedEmail = (empId + "@cfgw-kr.com").toLowerCase();

  var all = getUnreturnedItems();
  return all.filter(function (item) {
    var sameName = String(item.borrowerName || "").trim() === name;
    if (!sameName) return false;
    if (!expectedEmail) return true;
    var itemEmail = String(item.email || "").trim().toLowerCase();
    return !itemEmail || itemEmail === expectedEmail;
  });
}

function formatDateValue_(value) {
  if (value instanceof Date) return value.getFullYear() + "-" + String(value.getMonth() + 1).padStart(2, "0") + "-" + String(value.getDate()).padStart(2, "0");
  return value;
}

// 반납일처럼 "언제 처리됐는지"가 정렬 기준이 되는 값은 시간까지 살려서 문자열로 만든다.
// (formatDateValue_는 표시용이라 Date를 날짜만 남기고 시간을 버리기 때문에 정렬에 쓸 수 없다.)
// ⚠️ 이 함수는 로그 조회에서 수천 행을 훑는 반복문 안에서 행마다 여러 번 불린다.
// Utilities.formatDate()/Session.getScriptTimeZone()은 겉보기엔 평범한 함수 같아도
// 내부적으로 Apps Script 서비스 호출(원격 호출과 비슷한 오버헤드)이라, 반복문 안에서
// 수천 번 부르면 그것만으로 수십 초가 걸릴 수 있다. 그래서 순수 JS Date getter로 직접
// 조립한다 — 시트에서 읽은 Date 값은 이미 스크립트 시간대 기준으로 해석되어 있으므로
// getFullYear()/getHours() 등을 그냥 쓰면 Utilities.formatDate()와 결과가 동일하다.
function formatDateTimeFull_(value) {
  if (value instanceof Date) {
    var y = value.getFullYear();
    var mo = String(value.getMonth() + 1).padStart(2, "0");
    var da = String(value.getDate()).padStart(2, "0");
    var hh = String(value.getHours()).padStart(2, "0");
    var mi = String(value.getMinutes()).padStart(2, "0");
    var ss = String(value.getSeconds()).padStart(2, "0");
    return y + "-" + mo + "-" + da + " " + hh + ":" + mi + ":" + ss;
  }
  var text = String(value || "").trim();
  if (!text) return "";
  // "2026. 7. 31 오후 9:40:03" 같은 한국어 표시 문자열도 표준 형식으로 바꾼다
  if (/오전|오후/.test(text)) {
    var km = text.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2}).*?(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (km) {
      var hh2 = parseInt(km[5], 10) % 12;
      if (km[4] === "오후") hh2 += 12;
      var d2 = new Date(
        parseInt(km[1], 10), parseInt(km[2], 10) - 1, parseInt(km[3], 10),
        hh2, parseInt(km[6], 10), parseInt(km[7] || "0", 10)
      );
      if (!isNaN(d2.getTime())) {
        return Utilities.formatDate(d2, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
      }
    }
  }
  // "7/22/2026 23:41:33" 같은 미국식 표기도 표준 형식으로 바꾼다
  var us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (us) {
    var ud = new Date(
      parseInt(us[3], 10), parseInt(us[1], 10) - 1, parseInt(us[2], 10),
      parseInt(us[4] || "0", 10), parseInt(us[5] || "0", 10), parseInt(us[6] || "0", 10)
    );
    if (!isNaN(ud.getTime())) {
      return Utilities.formatDate(ud, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    }
  }

  return text;
}

function formatDateTimeValue_(value) {
  if (value instanceof Date) return (value.getMonth() + 1) + "월 " + value.getDate() + "일 " + String(value.getHours()).padStart(2, "0") + ":" + String(value.getMinutes()).padStart(2, "0") + ":" + String(value.getSeconds()).padStart(2, "0");
  return String(value || "");
}

function buildGeneralGroupInfo_(borrower, submittedAt, borrowDate) {
  var display = "";
  if (submittedAt instanceof Date) {
    display = Utilities.formatDate(submittedAt, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  } else if (submittedAt) {
    display = String(submittedAt).replace("T", " ").slice(0, 16);
  } else {
    display = formatDateValue_(borrowDate) || "";
  }
  return { key: String(borrower || "") + "|" + display, display: display };
}

/* ══════════ 신규 확장 API 헬퍼 함수 ══════════ */

function getStockChangeHistory_(ss, category, targetId, targetName) {
  var sheet = ss.getSheetByName("재고변경이력");
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var range = sheet.getRange(2, 1, lastRow - 1, 9);
  var values = range.getValues();
  var displayValues = range.getDisplayValues();
  var list = [];
  for (var i = values.length - 1; i >= 0; i--) {
    var row = values[i];
    var disp = displayValues[i];
    var rowCat = String(row[1] || "").trim();
    var rowId = String(row[2] || "").trim();
    var rowName = String(row[3] || "").trim();
    // rowCat/rowId가 비어있는 옛날 기록이 있으면(카테고리·id 없이 기록된 경우),
    // "존재하면 비교"식 조건은 그 행을 걸러내지 못하고 무조건 통과시켜버린다.
    // 그래서 특정 물품의 이력을 볼 때 관계없는 다른 물품 기록까지 섞여 나왔다.
    // 대상이 지정됐으면 항상 정확히 일치하는 행만 통과시키고, 안 맞으면(빈 값 포함) 제외한다.
    if (category) {
      var wantCat = category === "inventory" ? "공구 및 부품류" : "시나리오 물품";
      if (rowCat !== wantCat) continue;
    }
    // 공구 및 부품류는 같은 슬롯(위치)에 여러 물품이 같이 놓일 수 있어 위치만으로는
    // 특정 물품을 구분할 수 없다. 그래서 공구류는 물품명으로, 시나리오 물품은
    // (겹칠 일 없는) 고유 ID로 구분한다.
    if (category === "inventory" && targetName) {
      if (rowName.trim().toLowerCase() !== String(targetName).trim().toLowerCase()) continue;
    } else if (targetId) {
      var normalizedTargetId = category === "scenario" ? padSlot_(String(targetId).trim()) : String(targetId).trim().toLowerCase();
      var normalizedRowId = category === "scenario" ? padSlot_(rowId) : rowId.toLowerCase();
      if (normalizedRowId !== normalizedTargetId) continue;
    }
    list.push({
      changedAt: disp[0] || (row[0] instanceof Date ? formatDate(row[0]) : String(row[0] || "").trim()),
      category: rowCat,
      id: rowId,
      itemName: rowName,
      oldStock: Number(row[4] || 0),
      newStock: Number(row[5] || 0),
      diff: Number(row[6] || 0),
      reason: String(row[7] || "").trim(),
      manager: String(row[8] || "").trim()
    });
  }
  return list;
}

function normalizeItemId_(rawId) {
  var s = String(rawId || "").trim();
  if (!s) return "";
  var digits = s.replace(/\D/g, "");
  return digits ? digits.replace(/^0+/, "") : s.toLowerCase();
}

// "재고변경이력" 시트에 한 줄 남긴다. adjustStock_(수동 조정)과 자동 기록(대여/반납/교체/소모)이
// 전부 이 함수를 거치게 해서 기록 형식을 하나로 통일한다.
function logStockChange_(ss, category, itemIdOrLoc, itemName, oldVal, newVal, reason, manager) {
  try {
    var logSheet = getOrCreateSheet_(ss, "재고변경이력", ["변경시각", "구분", "물품ID/위치", "물품명", "기존재고", "변경재고", "증감", "사유", "담당자"]);
    logSheet.appendRow([
      formatDate(new Date()),
      category,
      itemIdOrLoc,
      itemName,
      oldVal,
      newVal,
      newVal - oldVal,
      reason,
      manager || "-"
    ]);
  } catch (e) { /* 이력 기록 실패는 원래 하려던 작업(대여/반납 등)을 막지 않는다 */ }
}

function adjustStock_(ss, payload) {
  var category = payload.category;
  var rowIndex = Number(payload.rowIndex);
  var newStock = Number(payload.newStock);
  // 대여 중 수량도 함께 고칠 수 있다 (값이 안 넘어오면 기존 값을 유지)
  var hasRentedInput = payload.newRented !== undefined && payload.newRented !== null && payload.newRented !== "";
  var newRented = hasRentedInput ? Number(payload.newRented) : null;
  var reason = String(payload.reason || "").trim();
  var manager = String(payload.manager || "").trim();
  var suppliedId = String(payload.id || payload.itemId || "").trim(); // 프론트가 안 보내는 경우가 많아 선택 항목으로 처리

  if (isNaN(newStock) || newStock < 0) {
    return { success: false, error: "새 재고 수량이 유효하지 않습니다.", message: "새 재고 수량이 유효하지 않습니다." };
  }
  if (hasRentedInput && (isNaN(newRented) || newRented < 0)) {
    return { success: false, error: "대여 중 수량이 유효하지 않습니다.", message: "대여 중 수량이 유효하지 않습니다." };
  }
  if (!reason) {
    return { success: false, error: "변경 사유를 입력해야 합니다.", message: "변경 사유를 입력해야 합니다." };
  }

  var targetSheet = null;
  var idColIdx = 1;   // 공구 및 부품류/시나리오 물품 둘 다 A열이 ID(또는 위치)
  var stockColIdx = 0;
  var nameColIdx = 0;
  var isInventory = (category === "inventory" || category === "공구 및 부품류");

  if (isInventory) {
    targetSheet = getInventorySheet(ss);
    if (!targetSheet) return { success: false, error: "창고물품 시트를 찾을 수 없습니다.", message: "창고물품 시트를 찾을 수 없습니다." };
    stockColIdx = 5; nameColIdx = 3;
  } else {
    targetSheet = ss.getSheetByName(OBJECT_SHEET_NAME) || ss.getSheetByName("시나리오 오브젝트") || ss.getSheetByName("Sheet3");
    if (!targetSheet) return { success: false, error: "시나리오 오브젝트 시트를 찾을 수 없습니다.", message: "시나리오 오브젝트 시트를 찾을 수 없습니다." };
    stockColIdx = 8; nameColIdx = 2;
  }

  var lastRow = targetSheet.getLastRow();
  if (lastRow < 2) return { success: false, error: "시트에 데이터가 없습니다.", message: "시트에 데이터가 없습니다." };

  // 1) 넘어온 rowIndex를 우선 신뢰하되, 2) id/itemId가 같이 넘어왔는데 그 행과 안 맞으면
  //    시트 전체에서 같은 ID를 다시 찾아 행 번호를 스스로 보정한다 (행이 삭제/정렬돼 밀린 경우 대비).
  var actualRowIndex = -1;
  if (rowIndex >= 2 && rowIndex <= lastRow) {
    if (!suppliedId) {
      actualRowIndex = rowIndex; // id가 안 넘어왔으면 rowIndex를 그대로 신뢰 (기존 프론트 동작과 동일)
    } else {
      var rowIdVal = String(targetSheet.getRange(rowIndex, idColIdx).getValue() || "").trim();
      if (normalizeItemId_(rowIdVal) === normalizeItemId_(suppliedId)) actualRowIndex = rowIndex;
    }
  }
  if (actualRowIndex === -1 && suppliedId) {
    var allIds = targetSheet.getRange(2, idColIdx, lastRow - 1, 1).getValues();
    var targetNorm = normalizeItemId_(suppliedId);
    for (var i = 0; i < allIds.length; i++) {
      if (normalizeItemId_(allIds[i][0]) === targetNorm) { actualRowIndex = i + 2; break; }
    }
  }
  if (actualRowIndex === -1) {
    return { success: false, error: "올바르지 않은 행 번호입니다.", message: "올바르지 않은 행 번호입니다." };
  }

  var itemIdOrLoc = String(targetSheet.getRange(actualRowIndex, idColIdx).getValue() || "").trim();
  if (!isInventory) itemIdOrLoc = padSlot_(itemIdOrLoc); // 시나리오 물품은 다른 화면들과 동일하게 6자리 0-패딩해서 기록
  var itemName = String(targetSheet.getRange(actualRowIndex, nameColIdx).getValue() || "").trim();
  var stockCell = targetSheet.getRange(actualRowIndex, stockColIdx);
  var rawOld = stockCell.getValue();
  var oldStock = isNaN(Number(rawOld)) ? 0 : Number(rawOld);

  if (stockCell.getFormula()) {
    return { success: false, error: "이 물품의 재고 값은 수식으로 계산되고 있어 직접 변경할 수 없습니다. 시트에서 수식을 먼저 확인해주세요.", message: "이 물품의 재고 값은 수식으로 계산되고 있어 직접 변경할 수 없습니다. 시트에서 수식을 먼저 확인해주세요." };
  }

  var oldRented = 0;
  var rentedChanged = false;
  if (isInventory) {
    targetSheet.getRange(actualRowIndex, stockColIdx, 1, 2).setValues([[newStock, formatDate(new Date())]]); // 재고 + 업데이트일자
  } else {
    stockCell.setValue(newStock);
    // 시나리오 물품은 I열이 "대여 중" 수량이다 (창고물품에는 해당 개념이 없다)
    if (hasRentedInput) {
      var rentedCell = targetSheet.getRange(actualRowIndex, 9);
      var rawRented = rentedCell.getValue();
      oldRented = isNaN(Number(rawRented)) ? 0 : Number(rawRented);
      if (rentedCell.getFormula()) {
        return { success: false, error: "대여 중 수량이 수식으로 계산되고 있어 직접 변경할 수 없습니다.", message: "대여 중 수량이 수식으로 계산되고 있어 직접 변경할 수 없습니다." };
      }
      if (newRented !== oldRented) {
        rentedCell.setValue(newRented);
        rentedChanged = true;
      }
    }
  }

  var diff = newStock - oldStock;

  logStockChange_(
    ss,
    isInventory ? "공구 및 부품류" : "시나리오 물품",
    itemIdOrLoc,
    itemName,
    oldStock,
    newStock,
    reason + (rentedChanged ? " / 대여 중: " + oldRented + " → " + newRented : ""),
    manager
  );

  invalidateGetAllCache_();
  return {
    success: true, oldStock: oldStock, newStock: newStock, diff: diff,
    oldRented: oldRented, newRented: rentedChanged ? newRented : oldRented, rentedChanged: rentedChanged,
    correctedRowIndex: actualRowIndex, wasRowShifted: (rowIndex !== actualRowIndex)
  };
}

/**
 * 물품세트 조회.
 * 시트 형식을 자동으로 판별한다.
 *  (A) 행 단위 형식 — 세트명 | 위치 | 물품명 | 수량   ← 사람이 직접 관리하기 편한 형식
 *  (B) JSON 형식     — 세트명 | 구성물품(JSON)        ← 예전 형식 (하위호환)
 * 같은 세트명의 행들을 묶어 하나의 세트로 만든다.
 */
function getItemSets_(ss) {
  var sheet = ss.getSheetByName("물품세트");
  if (!sheet) {
    // 없으면 행 단위 형식으로 새로 만든다.
    sheet = ss.insertSheet("물품세트");
    sheet.appendRow(["세트명", "위치", "물품명", "수량"]);
    return [];
  }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  var lastCol = Math.max(sheet.getLastColumn(), 2);
  var values = sheet.getRange(2, 1, lastRow - 1, Math.min(lastCol, 4)).getValues();
  var headerB = String(sheet.getRange(1, 2).getValue() || "").trim();
  var isJsonFormat = headerB.indexOf("JSON") !== -1 || headerB.indexOf("구성물품") !== -1;

  var order = [];
  var map = {};

  for (var i = 0; i < values.length; i++) {
    var setName = String(values[i][0] || "").trim();
    if (!setName) continue;
    if (!map[setName]) { map[setName] = { name: setName, items: [] }; order.push(setName); }

    if (isJsonFormat) {
      // (B) 예전 JSON 형식
      var raw = String(values[i][1] || "").trim();
      if (!raw) continue;
      try {
        var parsed = JSON.parse(raw);
        if (Object.prototype.toString.call(parsed) === "[object Array]") {
          for (var j = 0; j < parsed.length; j++) {
            var pit = parsed[j] || {};
            map[setName].items.push({
              location: String(pit.location || "").trim(),
              name: String(pit.name || "").trim(),
              qty: Number(pit.qty) > 0 ? Number(pit.qty) : 1
            });
          }
        }
      } catch (e) { /* 깨진 JSON은 건너뛴다 */ }
    } else {
      // (A) 행 단위 형식: 위치 | 물품명 | 수량
      var loc = String(values[i][1] || "").trim();
      var itemName = String(values[i][2] || "").trim();
      if (!itemName) continue; // 물품명이 없는 줄은 무시
      var qty = Number(values[i][3]);
      if (isNaN(qty) || qty <= 0) qty = 1;
      map[setName].items.push({ location: loc, name: itemName, qty: qty });
    }
  }

  return order.map(function (n) { return map[n]; });
}

// ── 진단용: 물품세트의 각 물품이 창고물품 시트에서 실제로 찾아지는지 확인한다.
// Apps Script 편집기에서 이 함수를 선택하고 ▶ 실행한 뒤 "실행 기록"에서 결과를 확인하세요.
// ── 진단용: 미반납 건의 대여 시각이 실제로 어떤 값인지 확인한다.
// 실제로 화면에 내려가는 값을 그대로 확인한다 (캐시 무시)
function 미반납응답진단() {
  invalidateLogCaches_();
  var items = getUnreturnedItems();
  Logger.log("미반납 " + items.length + "건 — 상위 8건");
  for (var i = 0; i < Math.min(8, items.length); i++) {
    var it = items[i];
    Logger.log((i + 1) + ". " + it.borrowerName + " | " + it.itemLabel
      + "\n    borrowDate=[" + it.borrowDate + "]"
      + "  borrowDateTime=[" + it.borrowDateTime + "]"
      + "  shift=[" + it.shift + "]");
  }
  var msg = "실행 기록(로그)에서 결과를 확인하세요.";
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
}

function 대여시각진단() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SCENARIO_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) { Logger.log("SID대여 시트에 데이터가 없습니다."); return; }
  var n = Math.min(sh.getLastRow() - 1, 8);
  var start = Math.max(2, sh.getLastRow() - n + 1);
  var d = sh.getRange(start, 1, n, 12).getValues();
  Logger.log("=== SID대여 최근 " + n + "행 (D=대여일, K=신청시각) ===");
  for (var i = 0; i < n; i++) {
    Logger.log(
      "대여일(D)=[" + d[i][3] + "] " + (d[i][3] instanceof Date ? "Date" : typeof d[i][3])
      + " | 신청시각(K)=[" + d[i][10] + "] " + (d[i][10] instanceof Date ? "Date" : typeof d[i][10])
      + " | shift=" + computeShiftFromRaw_(d[i][3])
      + " | 사용될 값=" + (formatDateTimeFull_(d[i][10]) || formatDateTimeFull_(d[i][3]))
    );
  }
}

function 세트매칭진단() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sets = getItemSets_(ss);
  var invSheet = getInventorySheet(ss);
  if (!invSheet) { Logger.log("❌ 창고물품 시트를 찾지 못했습니다."); return; }

  var lastRow = invSheet.getLastRow();
  var inv = invSheet.getRange(2, 1, Math.max(0, lastRow - 1), 5).getValues();

  var norm = function (v) { return String(v == null ? "" : v).trim().replace(/\s+/g, " ").toLowerCase(); };
  var tight = function (v) { return String(v == null ? "" : v).toLowerCase().replace(/[\s()\[\]{}_\-.,\/]/g, ""); };

  var byName = {}, byTight = {};
  for (var i = 0; i < inv.length; i++) {
    var loc = String(inv[i][0] || "").trim();
    var nm = String(inv[i][2] || "").trim();
    if (!nm) continue;
    var stock = inv[i][4];
    var rec = { row: i + 2, location: loc, name: nm, stock: stock };
    if (!byName[norm(nm)]) byName[norm(nm)] = rec;
    if (!byTight[tight(nm)]) byTight[tight(nm)] = rec;
  }

  Logger.log("창고물품 " + Object.keys(byName).length + "종 / 세트 " + sets.length + "개");
  sets.forEach(function (set) {
    Logger.log("\n=== 세트: " + set.name + " (" + set.items.length + "종) ===");
    set.items.forEach(function (it) {
      var exact = byName[norm(it.name)];
      var loose = byTight[tight(it.name)];
      if (exact) {
        Logger.log("✅ '" + it.name + "' → 창고 " + exact.row + "행 [" + exact.location + "] 재고=" + exact.stock
          + (String(exact.stock) === "0" ? "  ⚠ 재고 0이라 담기지 않습니다" : ""));
      } else if (loose) {
        Logger.log("△ '" + it.name + "' → 이름이 정확히 일치하진 않지만 공백/기호 무시하면 매칭됨: '"
          + loose.name + "' (창고 " + loose.row + "행, 재고=" + loose.stock + ")");
      } else {
        Logger.log("❌ '" + it.name + "' → 창고물품 시트에서 찾지 못함");
        Logger.log("    세트 쪽 원본 문자코드: " + charCodes_(it.name));
      }
    });
  });
}

function charCodes_(str) {
  var out = [];
  var s2 = String(str || "");
  for (var i = 0; i < s2.length; i++) out.push(s2.charAt(i) + "(" + s2.charCodeAt(i) + ")");
  return out.join(" ");
}

function itemSetsSheetIsJson_(ss) {
  var sheet = ss.getSheetByName("물품세트");
  if (!sheet) return false;
  var headerB = String(sheet.getRange(1, 2).getValue() || "").trim();
  return headerB.indexOf("JSON") !== -1 || headerB.indexOf("구성물품") !== -1;
}

/**
 * 세트 저장. 시트가 행 단위 형식이면 기존 행들을 지우고 다시 쓴다.
 * (JSON 형식 시트라면 예전 방식 그대로 한 행에 JSON으로 저장한다.)
 */
function saveItemSet_(ss, payload) {
  var name = String(payload.name || "").trim();
  var items = payload.items || [];
  var originalName = String(payload.originalName || name).trim();
  if (!name) return { success: false, message: "세트 이름을 입력해주세요." };

  var sheet = ss.getSheetByName("물품세트");
  if (!sheet) {
    sheet = ss.insertSheet("물품세트");
    sheet.appendRow(["세트명", "위치", "물품명", "수량"]);
  }

  if (itemSetsSheetIsJson_(ss)) {
    var lastRowJ = sheet.getLastRow();
    var foundRow = -1;
    if (lastRowJ >= 2) {
      var namesJ = sheet.getRange(2, 1, lastRowJ - 1, 1).getValues();
      for (var i = 0; i < namesJ.length; i++) {
        var existing = String(namesJ[i][0] || "").trim();
        if (existing === originalName || existing === name) { foundRow = i + 2; break; }
      }
    }
    var jsonStr = JSON.stringify(items);
    if (foundRow > 0) sheet.getRange(foundRow, 1, 1, 2).setValues([[name, jsonStr]]);
    else sheet.appendRow([name, jsonStr]);
    return { success: true };
  }

  // 행 단위 형식: 해당 세트의 기존 행을 모두 지우고 새로 추가한다 (아래에서 위로 삭제해야 인덱스가 밀리지 않는다).
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var col = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var r = col.length - 1; r >= 0; r--) {
      var rowName = String(col[r][0] || "").trim();
      if (rowName === originalName || rowName === name) sheet.deleteRow(r + 2);
    }
  }
  if (items.length) {
    var rows = items.map(function (it) {
      return [name, String(it.location || "").trim(), String(it.name || "").trim(), Number(it.qty) > 0 ? Number(it.qty) : 1];
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
  }
  return { success: true };
}

function deleteItemSet_(ss, payload) {
  // 프론트가 문자열만 보내던 예전 호출도 받아준다.
  var targetName = String((payload && payload.name !== undefined ? payload.name : payload) || "").trim();
  if (!targetName) return { success: false };
  var sheet = ss.getSheetByName("물품세트");
  if (!sheet) return { success: true };
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var names = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = names.length - 1; i >= 0; i--) {
      if (String(names[i][0] || "").trim() === targetName) sheet.deleteRow(i + 2);
    }
  }
  return { success: true };
}

function getSeatMap_(ss) {
  // 거의 바뀌지 않는 데이터라 캐시해 응답을 빠르게 한다 (대여 첫 화면에서 바로 필요하다)
  var cached = cacheGetLarge_("seatMap_v1");
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* 깨졌으면 다시 읽는다 */ }
  }
  var sheet = getOrCreateSheet_(ss, "좌석배치도", ["배치도(JSON)"]);
  var val = String(sheet.getRange(2, 1).getValue() || "").trim();
  if (!val) {
    try {
      val = PropertiesService.getScriptProperties().getProperty("SEAT_MAP_JSON") || "";
    } catch (e) {}
  }
  var map = null;
  if (val) {
    try { map = JSON.parse(val); } catch (e) {}
  }
  if (!map || !map.floors || map.floors.length === 0) {
    map = {
      floors: [
        {
          id: "B2",
          name: "B2",
          rows: 4,
          cols: 5,
          units: [
            { row: 0, col: 0, label: "Unit 4 (Franka)" },
            { row: 0, col: 1, label: "Unit 5 (Franka)" },
            { row: 0, col: 2, label: "Unit 7 (Franka)" },
            { row: 2, col: 0, label: "Unit 3 (Franka)" },
            { row: 2, col: 1, label: "Unit 2 (Franka)" },
            { row: 0, col: 3, label: "Unit 8 (Franka)" },
            { row: 3, col: 4, label: "Unit 1 (Franka)" }
          ]
        },
        {
          id: "B1",
          name: "B1",
          rows: 4,
          cols: 4,
          units: [
            { row: 0, col: 0, label: "Unit 9 (Vega)" },
            { row: 1, col: 1, label: "Unit 10 (Vega)" },
            { row: 1, col: 3, label: "Unit 5 (Vega)" },
            { row: 2, col: 3, label: "Unit 6 (Vega)" },
            { row: 3, col: 3, label: "Unit 7 (Vega)" },
            { row: 3, col: 1, label: "Unit 8 (Vega)" }
          ]
        },
        {
          id: "2F",
          name: "2F",
          rows: 5,
          cols: 5,
          units: [
            { row: 0, col: 0, label: "Unit 4" },
            { row: 1, col: 0, label: "Unit 3" },
            { row: 1, col: 1, label: "Unit 1" },
            { row: 4, col: 0, label: "Unit 6" },
            { row: 2, col: 3, label: "Human Unit 5" },
            { row: 3, col: 3, label: "Human Unit 6" },
            { row: 0, col: 4, label: "Human Unit 1" },
            { row: 1, col: 4, label: "Human Unit 2" },
            { row: 2, col: 4, label: "Human Unit 3" },
            { row: 3, col: 4, label: "Human Unit 4" }
          ]
        }
      ]
    };
    try {
      sheet.getRange(2, 1).setValue(JSON.stringify(map));
    } catch (e) {}
  }
  cachePutLarge_("seatMap_v1", JSON.stringify(map), 300);
  return map;
}

function saveSeatMap_(ss, map) {
  var sheet = getOrCreateSheet_(ss, "좌석배치도", ["배치도(JSON)"]);
  var jsonStr = JSON.stringify(map || { floors: [] });
  cacheRemoveLarge_("seatMap_v1"); // 편집 즉시 반영되도록 캐시를 비운다
  sheet.getRange(2, 1).setValue(jsonStr);
  try {
    PropertiesService.getScriptProperties().setProperty("SEAT_MAP_JSON", jsonStr);
  } catch (e) {}
  return { success: true };
}

// 시트 셀의 "원본" 값(formatDateValue_로 시간이 잘리기 전)에서 직접 시프트를 계산한다.
// formatDateValue_는 표시용으로 날짜만 남기고 시간을 버리기 때문에, 그 결과로
// getShiftType_를 돌리면 시간 정보가 없어 항상 "day"로 판정되는 문제가 있었다.
function computeShiftFromRaw_(rawValue) {
  var d = null;
  if (rawValue instanceof Date) {
    d = rawValue;
  } else if (rawValue) {
    // 한국어 표기("오전/오후")나 "yyyy-MM-dd HH:mm:ss" 모두 처리한다
    var normalized = formatDateTimeFull_(rawValue);
    var parsed = new Date(String(normalized).replace(" ", "T"));
    if (!isNaN(parsed.getTime())) d = parsed;
  }
  if (!d) return "day";
  var totalMin = d.getHours() * 60 + d.getMinutes();
  var dayStartMin = 8 * 60 + 50;  // 08:50
  var dayEndMin = 17 * 60 + 45;   // 17:45
  var nightEndMin = 1 * 60 + 0;   // 01:00
  if (totalMin >= dayStartMin && totalMin <= dayEndMin) return "day";
  if (totalMin > dayEndMin || totalMin <= nightEndMin) return "night";
  return "day";
}

function getShiftType_(borrowDateStr) {
  if (!borrowDateStr) return "day";
  var str = String(borrowDateStr).trim();
  var hours = -1;
  var minutes = -1;

  var krTimeMatch = str.match(/(오전|오후)\s*(\d{1,2}):(\d{1,2})/);
  if (krTimeMatch) {
    var isPm = krTimeMatch[1] === "오후";
    var h = parseInt(krTimeMatch[2], 10);
    var m = parseInt(krTimeMatch[3], 10);
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    hours = h;
    minutes = m;
  } else {
    var timeMatch = str.match(/(\d{1,2}):(\d{2})/);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = parseInt(timeMatch[2], 10);
    }
  }

  if (hours < 0) return "day";

  var totalMin = hours * 60 + minutes;
  var dayStartMin = 8 * 60 + 50;  // 08:50 (530)
  var dayEndMin = 17 * 60 + 45;   // 17:45 (1065)
  var nightEndMin = 1 * 60 + 0;   // 01:00 (60)

  if (totalMin >= dayStartMin && totalMin <= dayEndMin) {
    return "day";
  }
  if (totalMin > dayEndMin || totalMin <= nightEndMin) {
    return "night";
  }
  return "day";
}

function getSeatOccupancy_(ss, floor, unit, shift) {
  var allLogs = getScenarioAllLogs_(1); // 반납 완료 항목도 포함해서 조회 (아래에서 24시간으로 다시 좁히므로 1일이면 충분) (미반납만 보던 기존 방식과 달리 반납 여부를 실제로 표시하기 위함)
  var batchMap = {};
  var batchOrder = [];

  var targetFloor = String(floor || "").trim().toUpperCase();
  var targetUnit = String(unit || "").trim().toUpperCase();
  var cleanTargetUnit = targetUnit.replace(/\s*\(.*?\)\s*/g, "").trim();
  var reqShift = String(shift || "").trim().toLowerCase();

  // 좌석 배치도는 최근 24시간 안의 기록만 보여준다 (오래된 기록까지 다 뒤지지 않도록).
  var cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  for (var i = 0; i < allLogs.length; i++) {
    var item = allLogs[i];
    var itemFloor = String(item.floor || "").trim().toUpperCase();
    var itemUnit = String(item.unit || "").trim().toUpperCase();
    var cleanItemUnit = itemUnit.replace(/\s*\(.*?\)\s*/g, "").trim();

    var floorMatch = (itemFloor === targetFloor);
    var unitMatch = (itemUnit === targetUnit) || (cleanItemUnit.length > 0 && cleanItemUnit === cleanTargetUnit);

    if (floorMatch && unitMatch) {
      var whenDate = new Date(String(item.borrowDate || "").replace(" ", "T"));
      if (isNaN(whenDate.getTime()) || whenDate < cutoff) continue;

      var itemShift = item.shift || getShiftType_(item.borrowDate);
      if (reqShift === "day" && itemShift !== "day") continue;
      if (reqShift === "night" && itemShift !== "night") continue;

      var key = item.batchId || (item.borrowerName + "_" + item.borrowDate);
      if (!batchMap[key]) {
        batchMap[key] = {
          timestamp: item.borrowDate,
          borrowerName: item.borrowerName,
          batchId: item.batchId || "",
          sheetType: item.sheetType,
          shift: itemShift,
          items: [],
          allReturned: true
        };
        batchOrder.push(key);
      }
      // 반납 처리에 필요한 행 정보까지 함께 넘긴다 (좌석 배치도에서 바로 반납할 수 있게)
      batchMap[key].items.push({
        name: item.itemLabel,
        qty: item.quantity,
        returned: !!item.returned,
        rowIndex: item.rowIndex,
        sheetType: item.sheetType,
        returnDate: item.returnDate || ""
      });
      if (!item.returned) batchMap[key].allReturned = false;
    }
  }

  return batchOrder.map(function(k) { return batchMap[k]; });
}

/**
 * 개인별 페널티(대여 가능 종류 축소).
 * "페널티" 시트: 이름 | 최대 종류 | 사유 | 만료일(선택)
 *  - 만료일이 비어 있으면 해제할 때까지 계속 적용된다.
 *  - 만료일이 지났으면 무시한다.
 *  - 최대 종류가 0이면 대여를 아예 막는다.
 */
var PENALTY_SHEET_NAME = "페널티";

function getPenalty_(borrowerName) {
  var target = String(borrowerName || "").trim().toLowerCase();
  if (!target) return null;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(PENALTY_SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(PENALTY_SHEET_NAME);
      sheet.appendRow(["이름", "최대 종류", "사유", "만료일"]);
      return null;
    }
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    var data = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
    var today = new Date(); today.setHours(0, 0, 0, 0);

    for (var i = 0; i < data.length; i++) {
      var nm = String(data[i][0] || "").trim().toLowerCase();
      if (!nm || nm !== target) continue;

      var rawMax = data[i][1];
      var maxTypes = Number(rawMax);
      if (rawMax === "" || rawMax === null || isNaN(maxTypes) || maxTypes < 0) continue;

      // 만료일 확인 (Date 또는 "yyyy-MM-dd" 문자열 모두 허용)
      var rawUntil = data[i][3];
      if (rawUntil !== "" && rawUntil !== null && rawUntil !== undefined) {
        var until = (rawUntil instanceof Date) ? rawUntil : new Date(String(rawUntil).replace(" ", "T"));
        if (!isNaN(until.getTime())) {
          until.setHours(23, 59, 59, 999);
          if (until.getTime() < today.getTime()) continue; // 만료됨
        }
      }

      return {
        max: Math.floor(maxTypes),
        reason: String(data[i][2] || "").trim(),
        until: (rawUntil instanceof Date)
          ? Utilities.formatDate(rawUntil, Session.getScriptTimeZone(), "yyyy-MM-dd")
          : String(rawUntil || "").trim()
      };
    }
  } catch (e) { /* 조회 실패 시 페널티 없음으로 처리 */ }
  return null;
}

/* ══════════ 대여 잠금 ══════════
 * 관리자가 대여를 일시 중단할 수 있다. (반납은 계속 가능하다)
 * 스크립트 속성에 보관하므로 시트를 건드리지 않는다.
 */
var PROP_BORROW_LOCK_ = "BORROW_LOCKED";
var PROP_BORROW_LOCK_REASON_ = "BORROW_LOCK_REASON";
var PROP_BORROW_LOCK_AT_ = "BORROW_LOCK_AT";
var PROP_BORROW_LOCK_UNITS_ = "BORROW_LOCK_UNITS"; // ["B2|Unit 4", ...]

// 층/유닛 키를 표기 차이에 흔들리지 않게 정규화한다.
function unitLockKey_(floor, unit) {
  var norm = function (v) { return String(v == null ? "" : v).toUpperCase().replace(/[\s()\[\]{}_\-.,\/]/g, ""); };
  return norm(floor) + "|" + norm(unit);
}

function getBorrowLock_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var rawUnits = String(props.getProperty(PROP_BORROW_LOCK_UNITS_) || "[]");
    var units = [];
    try { units = JSON.parse(rawUnits) || []; } catch (e2) { units = []; }
    return {
      locked: String(props.getProperty(PROP_BORROW_LOCK_) || "") === "1",
      reason: String(props.getProperty(PROP_BORROW_LOCK_REASON_) || ""),
      at: String(props.getProperty(PROP_BORROW_LOCK_AT_) || ""),
      units: units // 유닛 단위 잠금: [{ floor, unit, reason }]
    };
  } catch (e) {
    return { locked: false, reason: "", at: "", units: [] };
  }
}

function setBorrowLock_(payload) {
  try {
    var props = PropertiesService.getScriptProperties();
    var locked = !!(payload && payload.locked);
    props.setProperty(PROP_BORROW_LOCK_, locked ? "1" : "0");
    props.setProperty(PROP_BORROW_LOCK_REASON_, String((payload && payload.reason) || ""));
    props.setProperty(PROP_BORROW_LOCK_AT_, locked ? formatDate(new Date()) : "");
    if (payload && payload.units !== undefined) {
      var list = [];
      (payload.units || []).forEach(function (u) {
        var floor = String((u && u.floor) || "").trim();
        var unit = String((u && u.unit) || "").trim();
        if (!floor || !unit) return;
        list.push({ floor: floor, unit: unit, reason: String((u && u.reason) || "").trim() });
      });
      props.setProperty(PROP_BORROW_LOCK_UNITS_, JSON.stringify(list));
    }
    return { success: true, lock: getBorrowLock_() };
  } catch (e) {
    return { success: false, message: "대여 잠금 설정 실패: " + e.message };
  }
}

// 잠금 상태면 거절 메시지를, 아니면 null을 돌려준다.
// floor/unit을 넘기면 해당 유닛만 잠긴 경우도 함께 판정한다.
function borrowLockMessage_(floor, unit) {
  var lock = getBorrowLock_();
  if (lock.locked) {
    return "현재 관리자가 대여를 일시 중단했습니다."
      + (lock.reason ? "\n\n사유: " + lock.reason : "")
      + "\n\n반납은 정상적으로 가능합니다. 문의는 관리자에게 해주세요.";
  }
  if (floor && unit && lock.units && lock.units.length) {
    var key = unitLockKey_(floor, unit);
    for (var i = 0; i < lock.units.length; i++) {
      var u = lock.units[i];
      if (unitLockKey_(u.floor, u.unit) !== key) continue;
      return "'" + u.floor + " · " + u.unit + "' 유닛은 현재 대여가 중단되었습니다."
        + (u.reason ? "\n\n사유: " + u.reason : "")
        + "\n\n다른 유닛을 선택하거나 관리자에게 문의해주세요. (반납은 가능합니다)";
    }
  }
  return null;
}

/* ══════════ 랜딩 공지 ══════════
 * "공지" 시트 2행에 현재 공지를 보관한다. (작성시각 | 작성자 | 내용)
 * 관리자 화면에서 작성하면 랜딩 페이지 하단에 표시된다.
 */
var NOTICE_SHEET_NAME = "공지";

var NOTICE_MAX_ = 3; // 랜딩에 띄울 공지 최대 개수

// 공지 목록 (최대 3개). 시트 열: 작성시각 | 작성자 | 제목 | 내용
function getNotices_(ss) {
  var out = [];
  try {
    var sheet = ss.getSheetByName(NOTICE_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return out;
    var n = Math.min(sheet.getLastRow() - 1, NOTICE_MAX_);
    var data = sheet.getRange(2, 1, n, 4).getValues();
    for (var i = 0; i < data.length; i++) {
      var title = String(data[i][2] || "").trim();
      var text = String(data[i][3] || "").trim();
      // 예전 3열 형식(작성시각|작성자|내용)과의 호환: 제목이 비고 내용도 비면 3열을 내용으로 본다
      if (!title && !text) continue;
      var at = data[i][0] instanceof Date ? formatDate(data[i][0]) : String(data[i][0] || "").trim();
      out.push({
        title: title || (text ? text.split("\n")[0].slice(0, 40) : ""),
        text: text || title,
        updatedAt: at,
        author: String(data[i][1] || "").trim()
      });
    }
  } catch (e) { /* 조회 실패 시 빈 목록 */ }
  return out;
}

// 하위호환용 단건 조회
function getNotice_(ss) {
  return getNotices_(ss)[0] || { title: "", text: "", updatedAt: "", author: "" };
}

// 공지 목록 저장 (최대 3개). 기존 내용을 지우고 새로 쓴다.
function saveNotices_(ss, payload) {
  try {
    var sheet = getOrCreateSheet_(ss, NOTICE_SHEET_NAME, ["작성시각", "작성자", "제목", "내용"]);
    var author = String((payload && payload.author) || "").trim();
    var at = formatDate(new Date());

    var items = [];
    ((payload && payload.items) || []).forEach(function (n) {
      var title = String((n && n.title) || "").trim();
      var text = String((n && n.text) || "").trim();
      if (!title && !text) return; // 빈 항목은 저장하지 않는다
      items.push([n.updatedAt || at, n.author || author, title, text]);
    });
    items = items.slice(0, NOTICE_MAX_);

    // 기존 행 비우고 다시 쓴다
    var lastRow = sheet.getLastRow();
    if (lastRow >= 2) sheet.getRange(2, 1, lastRow - 1, 4).clearContent();
    if (items.length) sheet.getRange(2, 1, items.length, 4).setValues(items);

    return { success: true, items: getNotices_(ss) };
  } catch (e) {
    return { success: false, message: "공지 저장 실패: " + e.message };
  }
}

// 하위호환: 단건 저장 (첫 번째 공지를 교체)
function saveNotice_(ss, payload) {
  var text = String((payload && payload.text) || "").trim();
  var title = String((payload && payload.title) || "").trim();
  var author = String((payload && payload.author) || "").trim();
  var rest = getNotices_(ss).slice(1);
  var items = [];
  if (title || text) items.push({ title: title, text: text, author: author });
  return saveNotices_(ss, { items: items.concat(rest), author: author });
}

/* ══════════ 대여 잠금 ══════════
 * 관리자가 대여를 일시 중단할 수 있다. (반납은 계속 가능하다)
 * 스크립트 속성에 보관하므로 시트를 건드리지 않는다.
 */
var PROP_BORROW_LOCK_ = "BORROW_LOCKED";
var PROP_BORROW_LOCK_REASON_ = "BORROW_LOCK_REASON";
var PROP_BORROW_LOCK_AT_ = "BORROW_LOCK_AT";
var PROP_BORROW_LOCK_UNITS_ = "BORROW_LOCK_UNITS"; // ["B2|Unit 4", ...]

// 층/유닛 키를 표기 차이에 흔들리지 않게 정규화한다.
function unitLockKey_(floor, unit) {
  var norm = function (v) { return String(v == null ? "" : v).toUpperCase().replace(/[\s()\[\]{}_\-.,\/]/g, ""); };
  return norm(floor) + "|" + norm(unit);
}

function getBorrowLock_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var rawUnits = String(props.getProperty(PROP_BORROW_LOCK_UNITS_) || "[]");
    var units = [];
    try { units = JSON.parse(rawUnits) || []; } catch (e2) { units = []; }
    return {
      locked: String(props.getProperty(PROP_BORROW_LOCK_) || "") === "1",
      reason: String(props.getProperty(PROP_BORROW_LOCK_REASON_) || ""),
      at: String(props.getProperty(PROP_BORROW_LOCK_AT_) || ""),
      units: units // 유닛 단위 잠금: [{ floor, unit, reason }]
    };
  } catch (e) {
    return { locked: false, reason: "", at: "", units: [] };
  }
}

function setBorrowLock_(payload) {
  try {
    var props = PropertiesService.getScriptProperties();
    var locked = !!(payload && payload.locked);
    props.setProperty(PROP_BORROW_LOCK_, locked ? "1" : "0");
    props.setProperty(PROP_BORROW_LOCK_REASON_, String((payload && payload.reason) || ""));
    props.setProperty(PROP_BORROW_LOCK_AT_, locked ? formatDate(new Date()) : "");
    if (payload && payload.units !== undefined) {
      var list = [];
      (payload.units || []).forEach(function (u) {
        var floor = String((u && u.floor) || "").trim();
        var unit = String((u && u.unit) || "").trim();
        if (!floor || !unit) return;
        list.push({ floor: floor, unit: unit, reason: String((u && u.reason) || "").trim() });
      });
      props.setProperty(PROP_BORROW_LOCK_UNITS_, JSON.stringify(list));
    }
    return { success: true, lock: getBorrowLock_() };
  } catch (e) {
    return { success: false, message: "대여 잠금 설정 실패: " + e.message };
  }
}

// 잠금 상태면 거절 메시지를, 아니면 null을 돌려준다.
// floor/unit을 넘기면 해당 유닛만 잠긴 경우도 함께 판정한다.
function borrowLockMessage_(floor, unit) {
  var lock = getBorrowLock_();
  if (lock.locked) {
    return "현재 관리자가 대여를 일시 중단했습니다."
      + (lock.reason ? "\n\n사유: " + lock.reason : "")
      + "\n\n반납은 정상적으로 가능합니다. 문의는 관리자에게 해주세요.";
  }
  if (floor && unit && lock.units && lock.units.length) {
    var key = unitLockKey_(floor, unit);
    for (var i = 0; i < lock.units.length; i++) {
      var u = lock.units[i];
      if (unitLockKey_(u.floor, u.unit) !== key) continue;
      return "'" + u.floor + " · " + u.unit + "' 유닛은 현재 대여가 중단되었습니다."
        + (u.reason ? "\n\n사유: " + u.reason : "")
        + "\n\n다른 유닛을 선택하거나 관리자에게 문의해주세요. (반납은 가능합니다)";
    }
  }
  return null;
}

/* ══════════ 랜딩 공지 ══════════
 * "공지" 시트 2행에 현재 공지를 보관한다. (작성시각 | 작성자 | 내용)
 * 관리자 화면에서 작성하면 랜딩 페이지 하단에 표시된다.
 */
var NOTICE_SHEET_NAME = "공지";

function getNotice_(ss) {
  try {
    var sheet = ss.getSheetByName(NOTICE_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return { text: "", updatedAt: "", author: "" };
    var row = sheet.getRange(2, 1, 1, 3).getValues()[0];
    var at = row[0] instanceof Date ? formatDate(row[0]) : String(row[0] || "").trim();
    return { updatedAt: at, author: String(row[1] || "").trim(), text: String(row[2] || "").trim() };
  } catch (e) {
    return { text: "", updatedAt: "", author: "" };
  }
}

function saveNotice_(ss, payload) {
  try {
    var sheet = getOrCreateSheet_(ss, NOTICE_SHEET_NAME, ["작성시각", "작성자", "내용"]);
    var text = String((payload && payload.text) || "").trim();
    var author = String((payload && payload.author) || "").trim();
    var at = formatDate(new Date());
    if (sheet.getLastRow() < 2) sheet.appendRow([at, author, text]);
    else sheet.getRange(2, 1, 1, 3).setValues([[at, author, text]]);
    return { success: true, notice: { text: text, author: author, updatedAt: at } };
  } catch (e) {
    return { success: false, message: "공지 저장 실패: " + e.message };
  }
}

// 현재 적용 중인 페널티 목록 (만료된 항목은 제외)
function getActivePenalties_(ss) {
  var out = [];
  try {
    var sheet = ss.getSheetByName(PENALTY_SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) return out;
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
    var today = new Date(); today.setHours(0, 0, 0, 0);

    for (var i = 0; i < data.length; i++) {
      var name = String(data[i][0] || "").trim();
      if (!name) continue;
      var rawMax = data[i][1];
      var maxTypes = Number(rawMax);
      if (rawMax === "" || rawMax === null || isNaN(maxTypes) || maxTypes < 0) continue;

      var untilText = "";
      var rawUntil = data[i][3];
      if (rawUntil !== "" && rawUntil !== null && rawUntil !== undefined) {
        var until = (rawUntil instanceof Date) ? rawUntil : new Date(String(rawUntil).replace(" ", "T"));
        if (!isNaN(until.getTime())) {
          var end = new Date(until.getTime()); end.setHours(23, 59, 59, 999);
          if (end.getTime() < today.getTime()) continue; // 만료됨
          untilText = Utilities.formatDate(until, Session.getScriptTimeZone(), "yyyy-MM-dd");
        } else {
          untilText = String(rawUntil).trim();
        }
      }

      out.push({
        name: name,
        max: Math.floor(maxTypes),
        reason: String(data[i][2] || "").trim(),
        until: untilText
      });
    }
  } catch (e) { /* 조회 실패 시 빈 목록 */ }
  return out;
}

function getActiveItemTypeCount_(borrowerName) {
  var items = getUnreturnedItems();
  var nameClean = String(borrowerName || "").trim().toLowerCase();
  var userItems = [];
  var uniqueIds = {};
  for (var i = 0; i < items.length; i++) {
    if (String(items[i].borrowerName || "").trim().toLowerCase() === nameClean) {
      userItems.push({
        id: items[i].itemId || items[i].location,
        name: items[i].itemLabel,
        quantity: items[i].quantity,
        borrowDate: items[i].borrowDate
      });
      uniqueIds[items[i].itemId || items[i].itemLabel] = true;
    }
  }
  // 페널티가 있으면 기본 한도보다 낮은 값을 적용한다.
  var penalty = getPenalty_(borrowerName);
  var effectiveMax = MAX_ACTIVE_ITEM_TYPES;
  if (penalty && penalty.max < effectiveMax) effectiveMax = penalty.max;

  return {
    count: Object.keys(uniqueIds).length,
    max: effectiveMax,
    baseMax: MAX_ACTIVE_ITEM_TYPES,
    penalty: penalty ? { max: penalty.max, reason: penalty.reason, until: penalty.until } : null,
    items: userItems
  };
}

function getStockAuditHistory_(ss, itemId) {
  var sheet = getOrCreateSheet_(ss, "재고실사기록", ["실사시각", "물품ID", "물품명", "시스템재고", "실사재고", "오차", "실사자", "비고"]);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  var displayValues = sheet.getRange(2, 1, lastRow - 1, 8).getDisplayValues();
  var list = [];
  for (var i = values.length - 1; i >= 0; i--) {
    var row = values[i];
    var idVal = String(row[1] || "").trim();
    if (itemId && idVal.toLowerCase() !== String(itemId).trim().toLowerCase()) continue;
    list.push({
      auditedAt: displayValues[i][0] || formatDate(row[0]),
      itemId: idVal,
      itemName: String(row[2] || "").trim(),
      systemStock: Number(row[3] || 0),
      actualCount: Number(row[4] || 0),
      diff: Number(row[5] || 0),
      auditor: String(row[6] || "").trim(),
      note: String(row[7] || "").trim()
    });
  }
  return list;
}

function recordStockAudit_(ss, payload) {
  var sheet = getOrCreateSheet_(ss, "재고실사기록", ["실사시각", "물품ID", "물품명", "시스템재고", "실사재고", "오차", "실사자", "비고"]);
  var auditedAt = formatDate(new Date());
  var diff = Number(payload.actualCount || 0) - Number(payload.systemStock || 0);
  var rec = [
    auditedAt,
    String(payload.itemId || "").trim(),
    String(payload.itemName || "").trim(),
    Number(payload.systemStock || 0),
    Number(payload.actualCount || 0),
    diff,
    String(payload.auditor || "").trim(),
    String(payload.note || "").trim()
  ];
  sheet.appendRow(rec);
  return { success: true, record: { auditedAt: auditedAt, itemId: payload.itemId, itemName: payload.itemName, systemStock: payload.systemStock, actualCount: payload.actualCount, diff: diff, auditor: payload.auditor, note: payload.note } };
}

function getStockFormulaStatus_(ss, itemId) {
  var sheet = getInventorySheet(ss);
  if (!sheet) return { found: false, stockIsFormula: false, rentedIsFormula: false };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { found: false, stockIsFormula: false, rentedIsFormula: false };
  var formulas = sheet.getRange(2, 5, lastRow - 1, 2).getFormulas();
  var locs = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < locs.length; i++) {
    if (String(locs[i][0] || "").trim().toLowerCase() === String(itemId || "").trim().toLowerCase()) {
      return {
        found: true,
        stockIsFormula: !!(formulas[i][0] && String(formulas[i][0]).indexOf("=") === 0),
        rentedIsFormula: !!(formulas[i][1] && String(formulas[i][1]).indexOf("=") === 0)
      };
    }
  }
  return { found: false, stockIsFormula: false, rentedIsFormula: false };
}
