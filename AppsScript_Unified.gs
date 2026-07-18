// AppsScript_Code.gs
// 이 코드를 구글 스프레드시트의 [확장 프로그램] -> [Apps Script]에 붙여넣고 웹앱으로 배포하세요.

const DEFECT_SHEET_NAME = "불량로그";
const RENT_SHEET_NAME = "창고물품 대여로그"; // (통합 시트) 기존 "대여로그"
const USERS_SHEET_NAME = "Admin"; // (통합 시트) 기존 "Users" — ID와 패스워드가 저장될 시트 탭 이름입니다.

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
      defectSheet.getRange(1, 1, 1, 7).setValues([["제품명", "개수", "기록 시간", "불량 유형", "세부 사항", "대처 방안", "사진"]]);
    }
    
    // 대여로그 시트 가져오거나 없으면 자동 생성
    let rentSheet = ss.getSheetByName(RENT_SHEET_NAME);
    if (!rentSheet) {
      rentSheet = ss.insertSheet(RENT_SHEET_NAME);
      rentSheet.getRange(1, 1, 1, 7).setValues([["기록 시간", "구분", "위치", "제품명", "수량", "대여자 성함", "메모"]]);
    }
    
    if (action === "getAll") {
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
      return responseJSON({
        success: true,
        inventory: inventory,
        sectors: sectors,
        users: users,
        defectLogs: defectLogs,
        rentLogs: rentLogs,
        robotObjects: robotObjects
      });
    }
    
    // ─────────────── 대여 시스템(구 BorrowForm) GET 액션 ───────────────
    if (action === "getObjectItems") {
      return responseJSON({ success: true, items: getObjectItems() });
    }
    if (action === "getScenarioDefinition") {
      return responseJSON({ success: true, scenario: getScenarioDefinition(e.parameter.sid) });
    }
    if (action === "getUnreturnedItems") {
      return responseJSON({ success: true, items: getUnreturnedItems() });
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

    return responseJSON({ success: false, error: "알 수 없는 GET 액션입니다." });
  } catch (err) {
    return responseJSON({ success: false, error: err.toString() });
  }
}

function doPost(e) {
  try {
    const requestData = JSON.parse(e.postData.contents);
    const action = requestData.action;
    const payload = requestData.payload;

    // ─────────────── 스크래퍼 하위 호환 (action 없이 sid+items가 오면 Scenario 시트 upsert) ───────────────
    if (!action && requestData.sid && Array.isArray(requestData.items)) {
      return handleScenarioUpsertPost_(requestData);
    }

    // ─────────────── 대여 시스템(구 BorrowForm) POST 액션 ───────────────
    if (action === "recordBorrow") {
      return responseJSON(recordBorrow(payload.borrowList, payload.clientVersion));
    }
    if (action === "processReturn") {
      return responseJSON(processReturn(payload.returnRequests, payload.clientVersion));
    }
    if (action === "upsertScenario") {
      return handleScenarioUpsertPost_(payload);
    }
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getInventorySheet(ss);
    if (!sheet) {
      return responseJSON({ success: false, error: "스프레드시트에서 데이터를 저장/조회할 시트 탭을 찾을 수 없습니다. 시트가 비어있는지 확인하세요." });
    }
    
    if (action === "addInventoryItem") {
      const newRowIndex = addInventoryItem(sheet, payload);
      return responseJSON({ success: true, rowIndex: newRowIndex });
    }
    
    if (action === "updateInventoryItem") {
      updateInventoryItem(sheet, payload);
      return responseJSON({ success: true });
    }

    if (action === "updateMultipleInventoryItems") {
      const items = payload.items;
      if (items && Array.isArray(items)) {
        for (let i = 0; i < items.length; i++) {
          updateInventoryItem(sheet, items[i]);
        }
      }
      return responseJSON({ success: true });
    }
    
    if (action === "deleteInventoryItem") {
      deleteInventoryItem(sheet, payload.rowIndex);
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
        defectSheet.getRange(1, 1, 1, 7).setValues([["제품명", "개수", "기록 시간", "불량 유형", "세부 사항", "대처 방안", "사진"]]);
      }
      const result = addDefectLog(defectSheet, payload);
      return responseJSON({ success: true, rowIndex: result.rowIndex, photo: result.photo });
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
              
              if (payload.type === "대여") {
                nextStock = Math.max(0, currentStock - qtyChange);
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
    userSheet.getRange(1, 1, 1, 3).setValues([["ID", "PASSWORD", "NAME"]]);
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
  
  const range = sheet.getRange(2, 1, lastRow - 1, 9);
  const values = range.getValues();
  const displayValues = range.getDisplayValues();
  const richTextValues = range.getRichTextValues();
  const inventory = [];
  
  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const richRow = richTextValues[i];
    const rowIndex = i + 2;
    
    // I열 (index 8, 사진 링크용)에서 이미지 주소 추출 (B열은 참고하지 않음)
    let photoUrl = "";
    if (richRow && richRow[8] && typeof richRow[8].getLinkUrl === "function") {
      photoUrl = richRow[8].getLinkUrl() || "";
      if (!photoUrl && typeof richRow[8].getRuns === "function") {
        const runs = richRow[8].getRuns();
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
    if (richRow && richRow[3] && typeof richRow[3].getLinkUrl === "function") {
      itemLink = richRow[3].getLinkUrl() || "";
      if (!itemLink && typeof richRow[3].getRuns === "function") {
        const runs = richRow[3].getRuns();
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
      updatedAt: displayValues[i][5] || "",
      manager: String(row[6] || "").trim(),
      note: String(row[7] || "").trim(),
      spec: String(row[1] || "").trim() // Column B (서브 분류)
    });
  }
  return inventory;
}

function getDefectLogs(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  
  const lastCol = Math.min(sheet.getLastColumn(), 7);
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
      photo: photoUrl
    });
  }
  return logs;
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

function addDefectLog(sheet, log) {
  const lastRow = sheet.getLastRow();
  const nextRow = lastRow + 1;
  
  if (sheet.getLastColumn() < 7) {
    sheet.getRange(1, 7).setValue("사진");
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
    photoVal = uploadImageToDrive(photoVal, filename, "1gs7NcJWgFY37OZ4aEuG6Z-PNlmAfz6_R", "Image for Broken Item");
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
  
  sheet.getRange(nextRow, 1, 1, 7).setValues([rowValues]);
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

function addRentLog(sheet, log) {
  const lastRow = sheet.getLastRow();
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
    photoVal = uploadImageToDrive(photoVal, fileName, "1B8VRL7T9cuQIuiSU08ToZnJis576z_wY", "Inventory Images");
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
    photoVal // Column I (사진 링크용)
  ];
  
  sheet.getRange(nextRow, 1, 1, 9).setValues([rowValues]);
  return nextRow;
}

function updateInventoryItem(sheet, item) {
  const rowIndex = Number(item.rowIndex);
  if (!rowIndex || rowIndex < 2) throw new Error("올바르지 않은 행 인덱스: " + rowIndex);
  
  const nowStr = formatDate(new Date());
  const range = sheet.getRange(rowIndex, 1, 1, 9);
  const currentValues = range.getValues()[0];
  
  if (item.location !== undefined) currentValues[0] = item.location;
  if (item.spec !== undefined) currentValues[1] = item.spec; // Column B (서브 분류)
  if (item.photo !== undefined) {
    // 물품 수정 이미지 드라이브 업로드 처리 (이름은 오브젝트 이름으로 지정, 폴더 ID: 1B8VRL7T9cuQIuiSU08ToZnJis576z_wY)
    let photoVal = item.photo || "";
    if (photoVal.indexOf("data:image/") === 0) {
      const fileName = String(item.name || currentValues[2] || "물품이미지").trim();
      photoVal = uploadImageToDrive(photoVal, fileName, "1B8VRL7T9cuQIuiSU08ToZnJis576z_wY", "Inventory Images");
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
var SLACK_BOT_TOKEN = "xoxb-8631374157207-11505697586832-f7Ln781J9wJTJL3C3FMFltkW";
var SLACK_CHANNEL_ID = "C0BBYDMTQUB";
var OBJECT_DETAIL_BASE_URL = "http://scenario-manager.tailb971f6.ts.net/object_detail/";

var APP_VERSION = "2026-07-17-01";
var PROP_LATEST_VERSION_ = "LATEST_APP_VERSION";
var PROP_LATEST_URL_ = "LATEST_APP_URL";

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

function publishCurrentVersion() {
  var props = PropertiesService.getScriptProperties();
  var url = "";
  try { url = ScriptApp.getService().getUrl() || ""; } catch (e) {}
  props.setProperty(PROP_LATEST_VERSION_, APP_VERSION);
  if (url) props.setProperty(PROP_LATEST_URL_, url);
  var msg = "최신 버전으로 등록했습니다.\n\n버전: " + APP_VERSION + (url ? "\n최신 주소: " + url : "");
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
  var data = sheet.getRange(2, 1, lastRow - 1, 9).getValues(); // 9 columns
  var result = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (!row[0] && !row[1]) continue;
    result.push({
      id: padSlot_(String(row[0]).trim()),
      name: String(row[1]).trim(),
      sector: String(row[2]).trim(),
      rootSlot: padSlot_(String(row[3]).trim()),
      category: String(row[4] || "").trim(),
      subcategory: String(row[5] || "").trim(),
      image: String(row[6] || "").trim(), // Column G (Image)
      stock: (row[7] !== "" && row[7] !== undefined) ? Number(row[7]) : 0, // Column H (재고)
      rented: (row[8] !== "" && row[8] !== undefined) ? Number(row[8]) : 0 // Column I (대여)
    });
  }
  result.sort(function (a, b) {
    var na = parseInt(String(a.rootSlot || "").replace(/\D/g, ""), 10);
    var nb = parseInt(String(b.rootSlot || "").replace(/\D/g, ""), 10);
    if (isNaN(na)) na = Number.MAX_SAFE_INTEGER;
    if (isNaN(nb)) nb = Number.MAX_SAFE_INTEGER;
    return na - nb;
  });
  return result;
}

function padSlot_(raw) {
  var s = String(raw).trim().replace(/\D/g, "");
  if (!s) return raw;
  return s.length < 6 ? s.padStart(6, "0") : s;
}

function normalizeSid_(sid) { return String(sid || "").trim().toUpperCase(); }

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
  var email = null;
  if (affiliation === "cfgw") {
    var empId = String(borrowInfo.employeeId || "").trim();
    if (/^\d+$/.test(empId)) email = empId + "@cfgw-kr.com";
  } else if (affiliation === "configds") {
    var found = lookupConfigDsContact_(borrowInfo.borrowerName);
    if (found) email = found.email;
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

function postThreadReply_(text, threadTs) {
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID || !threadTs) return false;
  try {
    var response = UrlFetchApp.fetch("https://slack.com/api/chat.postMessage", { method: "post", contentType: "application/json; charset=utf-8", headers: { "Authorization": "Bearer " + SLACK_BOT_TOKEN }, payload: JSON.stringify({ channel: SLACK_CHANNEL_ID, text: text, thread_ts: threadTs }), muteHttpExceptions: true });
    var data = JSON.parse(response.getContentText());
    return !!data.ok;
  } catch (e) { return false; }
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
    .addItem("현재 버전을 최신으로 등록(배포 직후 실행)", "publishCurrentVersion")
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
    if (parts.num > index.maxNum) { index.maxNum = parts.num; index.maxSid = sid; }
  });
  return index;
}

function evaluateSidUsable_(sid, index) {
  var target = normalizeSid_(sid);
  var res = { blocked: false, reason: "" };
  if (!target || index.sids[target]) return res;
  var parts = parseSidParts_(target);
  if (!parts) return res;
  if (index.maxNum === undefined || index.maxNum < 0) return res;
  if (parts.num <= index.maxNum) {
    res.blocked = true;
    res.reason = target + " 는 Scenario 시트에 없습니다. 시트에 등록된 마지막 SID(" + (index.maxSid || index.maxNum)
      + ")보다 앞번호이므로 잘못된 SID이거나 삭제된 시나리오입니다. 대여할 수 없습니다.";
  }
  return res;
}

function getScenarioDefinition(sid) {
  var target = normalizeSid_(sid);
  var empty = { sid: target, found: false, syncNeeded: true, blocked: false, blockReason: "", highLevelEn: "", highLevelKo: "", items: [] };
  if (!target) return empty;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SCENARIO_DEFINITION_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return empty;
  var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 6).getValues();
  var maxNum = -1, maxSid = "";
  data.forEach(function (row) {
    var rowSid = normalizeSid_(row[0]);
    var rp = parseSidParts_(rowSid);
    if (rp && rp.num > maxNum) { maxNum = rp.num; maxSid = rowSid; }
    if (rowSid !== target) return;
    empty.found = true;
    empty.syncNeeded = false;
    empty.highLevelEn = empty.highLevelEn || String(row[1] || "").trim();
    empty.highLevelKo = empty.highLevelKo || String(row[2] || "").trim();
    var id = padSlot_(String(row[3] || "").trim());
    if (id) empty.items.push({ id: id, name: String(row[4] || "").trim(), quantity: row[5] || 1 });
  });

  if (!empty.found) {
    var chk = evaluateSidUsable_(target, { sids: {}, maxNum: maxNum, maxSid: maxSid });
    empty.blocked = chk.blocked;
    empty.blockReason = chk.reason;
  }
  var objectMap = {};
  getObjectItems().forEach(function (object) { objectMap[object.id] = object; });
  empty.items.forEach(function (item) {
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
  return empty;
}

function ensureScenarioLogSchema_(sheet) {
  if (sheet.getLastColumn() < SCENARIO_LOG_ITEM_KIND_COL) sheet.insertColumnsAfter(sheet.getLastColumn(), SCENARIO_LOG_ITEM_KIND_COL - sheet.getLastColumn());
  sheet.getRange(1, SCENARIO_LOG_ITEM_KIND_COL).setValue("물품 구분");
}

function ensureGeneralLogSchema_(sheet) {
  if (sheet.getLastColumn() < GENERAL_OPTION_COL) sheet.insertColumnsAfter(sheet.getLastColumn(), GENERAL_OPTION_COL - sheet.getLastColumn());
  sheet.getRange(1, GENERAL_OPTION_COL).setValue("대여구분");
}

function scenarioItemLabel_(item) {
  var id = item && item.id ? padSlot_(String(item.id).trim()) : "";
  var qty = (item && item.quantity) || 1;
  return (id ? "[" + id + "] " : "") + ((item && item.name) || "") + (qty > 1 ? " x " + qty : "");
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
  getObjectItems().forEach(function (o) { map[o.id] = o.rootSlot; });
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

// 시나리오 오브젝트 시트의 재고/대여 실시간 갱신 (수식이 있으면 건드리지 않음)
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

function recordBorrow(borrowList, clientVersion) {
  if (!Array.isArray(borrowList) || !borrowList.length) return { success: false, message: "대여 요청 정보가 없습니다." };
  if (!clientVersion || clientVersion !== APP_VERSION) {
    return { success: false, message: "구버전 화면을 사용 중입니다. 대여 신청 기능이 작동하지 않습니다. 페이지를 새로고침(F5)하여 최신 버전으로 접속한 뒤 다시 시도해주세요. (현재 버전: " + (clientVersion || "미확인") + ", 최신 버전: " + APP_VERSION + ")" };
  }
  if (isOutdatedVersion_()) {
    return { success: false, message: "구버전에서는 대여 신청을 할 수 없습니다. 최신 버전 주소로 접속한 뒤 다시 시도해주세요." };
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var scenarioSheet = getOrCreateSheet_(ss, SCENARIO_SHEET_NAME, ["대여자", "시나리오 ID", "물품", "대여일", "대여 목적", "반납 여부", "반납일", "이메일", "Slack Thread TS", "배치ID", "신청시각", "물품 구분"]);
    ensureScenarioLogSchema_(scenarioSheet);
    var generalSheet = getOrCreateSheet_(ss, GENERAL_SHEET_NAME, ["대여자", "대여 물품 ID", "대여 물품명", "수량", "대여일", "대여 목적", "반납 여부", "반납일", "이메일", "Slack Thread TS", "배치ID", "신청시각", "대여구분"]);
    ensureGeneralLogSchema_(generalSheet);
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
    var inventoryItems = getObjectItems();
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

    borrowList.forEach(function (info) {
      var borrowDateTime = normalizeDateTimeInput_(info.borrowDate);
      var purposeText = String(info.borrowPurpose || "").trim();
      if (purposeText && purposeTexts.indexOf(purposeText) === -1) purposeTexts.push(purposeText);

      if (info.itemType !== "scenario") {
        if (info.generalOption) generalOption = info.generalOption;
        var generalPurpose = info.borrowPurpose;
        var generalBatchId = Utilities.getUuid();
        var generalSubmittedAt = new Date();
        (info.borrowedItems || []).forEach(function (item) {
          generalSheet.appendRow([info.borrowerName, item.id || "", item.name || "", item.quantity || 1, borrowDateTime, generalPurpose, "X", "", contact.email || "", "", generalBatchId, generalSubmittedAt, info.generalOption || ""]);
          generalRows.push(generalSheet.getLastRow()); generalCount += (item.quantity || 1);
          borrowedForThread.push({ id: item.id, name: item.name, quantity: item.quantity });
          hasGeneralBorrow = true;

          updateInventory_(item.id, item.quantity || 1);
        });
        return;
      }
      var batchId = scenarioRequestBatchId, now = scenarioRequestSubmittedAt;
      var required = info.requiredObjects || [];
      var additional = additionalItemsRecorded ? [] : (info.additionalItems || []);
      if (additional.length) additionalItemsRecorded = true;

      required.forEach(function (item) {
        scenarioSheet.appendRow([info.borrowerName, info.scenarioId, scenarioItemLabel_(item), borrowDateTime, info.borrowPurpose, "X", "", contact.email || "", "", batchId, now, "대여 물품"]);
        scenarioRows.push(scenarioSheet.getLastRow());
        borrowedForThread.push({ id: item.id, name: item.name, quantity: item.quantity });

        updateInventory_(item.id, item.quantity || 1);
      });
      if (!required.length) {
        scenarioSheet.appendRow([info.borrowerName, info.scenarioId, "", borrowDateTime, info.borrowPurpose, "X", "", contact.email || "", "", batchId, now, "대여 물품"]);
        scenarioRows.push(scenarioSheet.getLastRow());
      }
      scenarioCount++;
      if (borrowedSids.indexOf(info.scenarioId) === -1) borrowedSids.push(info.scenarioId);

      if (additional.length) {
        additional.forEach(function (item) {
          generalSheet.appendRow([info.borrowerName, item.id || "", item.name || "", item.quantity || 1, borrowDateTime, info.borrowPurpose, "X", "", contact.email || "", "", additionalBatchId, now, "추가 물품 대여"]);
          generalRows.push(generalSheet.getLastRow()); generalCount += (item.quantity || 1);
          borrowedForThread.push({ id: item.id, name: item.name, quantity: item.quantity });
          hasGeneralBorrow = true;

          updateInventory_(item.id, item.quantity || 1);
        });
      }
    });

    var mainLines = ["📦 *물품 대여 신청*", applicant];
    if (borrowedSids.length) mainLines.push("• 시나리오 ID: " + borrowedSids.join(", "));
    if (hasGeneralBorrow) mainLines.push("• 일반 대여" + (generalOption ? ": " + generalOption : ""));
    if (purposeTexts.length) mainLines.push("• 목적: " + purposeTexts.join(" / "));
    var mainText = mainLines.join("\n");

    var locations = buildLocationMap_();
    var objLines = buildMergedLocationLines_(borrowedForThread, locations);
    var replyText = "📍 *대여 물품 · 위치*\n" + (objLines.join("\n") || "없음");

    var ts = postSlackMessage_(boxWrap_(mainText));
    var slackNote = "";
    if (ts) {
      generalRows.forEach(function (r) { generalSheet.getRange(r, 10).setValue(ts); });
      scenarioRows.forEach(function (r) { scenarioSheet.getRange(r, 9).setValue(ts); });
      if (objLines.length) postThreadReply_(replyText, ts);
    } else {
      // 봇 메인 메시지 실패 시: 스레드 없이 단일 메시지로라도 재시도 (웹훅 미사용)
      var combined = postSlackMessage_(boxWrap_(mainText + "\n───────────────\n" + replyText));
      slackNote = combined
        ? " (스레드 없이 단일 메시지로 발송했습니다)"
        : " (Slack 발송 실패: " + lastSlackError_ + " — 봇을 채널에 초대했는지 확인하세요)";
    }
    return { success: true, message: "SID " + scenarioCount + "건, 일반 물품 " + generalCount + "개를 기록했습니다." + slackNote };
  } catch (e) { return { success: false, message: "대여 기록 중 오류: " + e.message }; }
}

function getUnreturnedItems() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), result = [];
  var locations = {};
  var objectMap = {};
  getObjectItems().forEach(function (o) {
    locations[o.id] = o.rootSlot;
    objectMap[o.id] = o;
  });
  var scenarioSheet = ss.getSheetByName(SCENARIO_SHEET_NAME);
  if (scenarioSheet && scenarioSheet.getLastRow() > 1) {
    var data = scenarioSheet.getRange(2, 1, scenarioSheet.getLastRow() - 1, Math.max(scenarioSheet.getLastColumn(), SCENARIO_LOG_ITEM_KIND_COL)).getValues();
    data.forEach(function (row, i) {
      if (String(row[5]).trim() === "O") return;
      var label = row[2] || "(물품 미등록)";
      var idMatch = String(label).match(/^\[(\d+)\]/);
      var itemId = idMatch ? padSlot_(idMatch[1]) : "";
      var parsedQty = parseItemLabel_(label).quantity || 1;
      var obj = objectMap[itemId] || {};
      result.push({ sheetType: "scenario", rowIndex: i + 2, borrowerName: row[0], scenarioId: row[1], itemLabel: label, itemKind: row[11] || "추가 대여물품", location: itemId ? (locations[itemId] || "") : "", quantity: parsedQty, borrowDate: formatDateValue_(row[3]), borrowPurpose: row[4], email: String(row[7] || "").trim(), batchId: String(row[9] || ""), image: obj.image || "", stock: obj.stock || 0, rented: obj.rented || 0 });
    });
  }
  var generalSheet = ss.getSheetByName(GENERAL_SHEET_NAME);
  if (generalSheet && generalSheet.getLastRow() > 1) {
    var general = generalSheet.getRange(2, 1, generalSheet.getLastRow() - 1, Math.max(generalSheet.getLastColumn(), GENERAL_COL_COUNT)).getValues();
    general.forEach(function (row, i) {
      if (String(row[6]).trim() === "O") return;
      var id = String(row[1] || "").trim(), qty = row[3] || 1;
      var pid = padSlot_(id);
      var obj = objectMap[pid] || {};
      var groupInfo = buildGeneralGroupInfo_(row[0], row[11], row[4]);
      result.push({ sheetType: "general", rowIndex: i + 2, borrowerName: row[0], itemLabel: (id ? "[" + pid + "] " : "") + row[2] + (qty > 1 ? " x " + qty : ""), location: locations[pid] || "", quantity: qty, borrowDate: formatDateValue_(row[4]), submitGroupKey: groupInfo.key, submitDisplay: groupInfo.display, borrowPurpose: row[5], email: String(row[8] || "").trim(), batchId: String(row[10] || ""), generalOption: String(row[12] || ""), image: obj.image || "", stock: obj.stock || 0, rented: obj.rented || 0 });
    });
  }
  return result;
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

    returnRequests.forEach(function (request) {
      var isScenario = request.sheetType === "scenario";
      var sheet = isScenario ? scenarioSheet : generalSheet;
      if (!sheet || !request.rowIndex || request.rowIndex < 2) return;
      var colCount = isScenario ? SCENARIO_LOG_ITEM_KIND_COL : Math.max(sheet.getLastColumn(), GENERAL_COL_COUNT);
      var data = sheet.getRange(request.rowIndex, 1, 1, colCount).getValues()[0];
      var returnedCol = isScenario ? 6 : 7;
      if (String(data[returnedCol - 1]).trim() === "O") return;

      var borrower, email, item = null, sid = "", isGeneral = false, option = "";
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
        sheet.getRange(request.rowIndex, returnedCol).setValue("O");
        sheet.getRange(request.rowIndex, returnedCol + 1).setValue(today);
      }
      processed += reqQty;
      if (item) item = { id: item.id, name: item.name, quantity: reqQty };

      // REAL-TIME INVENTORY UPDATE (on Return, qtyChange is negative!)
      if (item && item.id) {
        updateInventory_(item.id, -reqQty);
      }

      if (!groups[borrower]) { groups[borrower] = { borrower: borrower, email: email, sids: [], hasGeneral: false, items: [], options: [] }; order.push(borrower); }
      if (!groups[borrower].email && email) groups[borrower].email = email;
      if (sid && groups[borrower].sids.indexOf(sid) === -1) groups[borrower].sids.push(sid);
      if (isGeneral) {
        groups[borrower].hasGeneral = true;
        if (option && groups[borrower].options.indexOf(option) === -1) groups[borrower].options.push(option);
      }
      if (item) groups[borrower].items.push(item);
    });

    var remainingByBorrower = {};
    getUnreturnedItems().forEach(function (u) {
      var b = u.borrowerName || "";
      var parsed = parseItemLabel_(u.itemLabel);
      if (!parsed.id && !parsed.name) return;
      if (!remainingByBorrower[b]) remainingByBorrower[b] = [];
      remainingByBorrower[b].push(parsed);
    });

    var slackNote = "";
    order.forEach(function (borrower) {
      var g = groups[borrower];
      var mainLines = ["✅ *반납 처리*", "• 반납자: " + buildMentionText_(g.borrower, g.email, "")];
      if (g.sids.length) mainLines.push("• 시나리오 ID: " + g.sids.join(", "));
      if (g.hasGeneral) mainLines.push(g.sids.length ? "• 일반 반납 물품 포함" : "• 일반 반납");
      if (g.options.length) mainLines.push("• 대여구분: " + g.options.join(", "));
      var mainText = mainLines.join("\n");

      var returnLines = buildMergedLocationLines_(g.items, locations);
      var replyText = "📍 *반납 물품 · 위치*\n" + (returnLines.join("\n") || "없음") + "\n반납일: " + today;

      var remaining = remainingByBorrower[borrower] || [];
      var remainingLines = buildMergedLocationLines_(remaining, locations);
      var remainingText = "📦 *현재 대여 중인 물품 · 위치*\n" + (remainingLines.join("\n") || "없음 (모두 반납 완료)");

      var ts = postSlackMessage_(boxWrap_(mainText));
      if (ts) {
        postThreadReply_(replyText, ts);
        postThreadReply_(remainingText, ts);
      } else {
        var combined = postSlackMessage_(boxWrap_(mainText + "\n───────────────\n" + replyText + "\n───────────────\n" + remainingText));
        slackNote = combined
          ? " (스레드 없이 단일 메시지로 발송했습니다)"
          : " (Slack 발송 실패: " + lastSlackError_ + " — 봇을 채널에 초대했는지 확인하세요)";
      }
    });

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
