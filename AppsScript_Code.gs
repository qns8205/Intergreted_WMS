// AppsScript_Code.gs
// 이 코드를 구글 스프레드시트의 [확장 프로그램] -> [Apps Script]에 붙여넣고 웹앱으로 배포하세요.

const DEFECT_SHEET_NAME = "불량로그";
const RENT_SHEET_NAME = "대여로그";
const USERS_SHEET_NAME = "Users"; // ID와 패스워드가 저장될 시트 탭 이름입니다.

// 스마트 시트 찾기 함수: "관리시트", "시트1", "Sheet1" 순서로 시트를 시도하고,
// 검색어가 매칭되는 시트가 없으면 첫 번째 시트를 자동으로 매칭하여 오류를 예방합니다.
function getInventorySheet(ss) {
  if (!ss) {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  }
  if (!ss) return null;
  
  // 1. "관리시트" 검색
  var sheet = ss.getSheetByName("관리시트");
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
  const sheet = ss.getSheetByName("로봇 오브젝트");
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
