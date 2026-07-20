import React, { useState } from "react";
// @ts-ignore
import scriptCode from "../../AppsScript_Code.gs?raw";


interface SetupModalProps {
  scriptUrl: string;
  setScriptUrl: (url: string) => void;
  connecting: boolean;
  connectError: string;
  connected: boolean;
  onConnect: () => void;
  onClose: () => void;
  onDisconnect: () => void;
}

const PANEL = "var(--panel-bg, #1e293b)";
const PANEL_BORDER = "var(--panel-border, #334155)";
const TEXT_MAIN = "var(--text-main, #f1f5f9)";
const TEXT_DIM = "var(--text-dim, #94a3b8)";
const ACCENT = "#2563eb";
const DANGER = "#f43f5e";
const OK = "#10b981";

export default function SetupModal({
  scriptUrl,
  setScriptUrl,
  connecting,
  connectError,
  connected,
  onConnect,
  onClose,
  onDisconnect,
}: SetupModalProps) {
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const handleCopyShareLink = () => {
    if (!scriptUrl) return;
    try {
      const currentOrigin = window.location.origin + window.location.pathname;
      const shareLink = `${currentOrigin}?script_url=${encodeURIComponent(scriptUrl.trim())}`;
      navigator.clipboard.writeText(shareLink);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy link:", e);
    }
  };

  // scriptCode is now imported dynamically from '../../AppsScript_Code.gs' at build time to prevent code drift and redundancy.


  const handleCopy = () => {
    navigator.clipboard.writeText(scriptCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,10,11,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        backdropFilter: "blur(2px)",
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 560,
          maxWidth: "92vw",
          maxHeight: "86vh",
          overflowY: "auto",
          background: PANEL,
          border: `1px solid ${PANEL_BORDER}`,
          borderRadius: 12,
          padding: 24,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>구글 스프레드시트 실시간 연동 설정</div>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: TEXT_DIM, fontSize: 18, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        <div style={{ fontSize: 13, color: TEXT_DIM, lineHeight: 1.7, marginBottom: 16 }}>
          Google Apps Script 웹앱 URL을 입력하여 스프레드시트의 재고 목록을 실시간으로 관리할 수 있습니다. 
          아래 단계를 따라서 스크립트를 최초 1회 설치 및 배포해 주세요.
        </div>

        <div style={{ marginBottom: 16, background: "var(--input-bg, #0f172a)", padding: 12, borderRadius: 8, border: `1px solid ${PANEL_BORDER}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: OK }}>Apps Script 복사하기</span>
            <button
              onClick={handleCopy}
              style={{
                background: copied ? OK : ACCENT,
                color: "#ffffff",
                border: "none",
                borderRadius: 4,
                padding: "4px 10px",
                fontSize: 11.5,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {copied ? "✓ 복사 완료!" : "코드 복사하기"}
            </button>
          </div>
          <p style={{ fontSize: 11.5, color: TEXT_DIM, margin: 0, lineHeight: 1.5 }}>
            이 코드에는 <b>Column H (특이사항)</b> 매핑, 구글 드라이브 사진 연동 지원, 그리고 <b>'불량로그' 사진 등록(7번째 열) 및 자동 생성, 실시간 양방향 동기화 기능</b>이 완벽하게 반영되어 있습니다. <span style={{ color: OK, fontWeight: "bold" }}>(이미 연동 중이신 분들은 아래의 코드를 다시 복사하여 확장 프로그램 → Apps Script에 붙여넣으신 후, [배포] → [새 배포(또는 새 버전)]로 반드시 업데이트하셔야 사진이 유실되지 않고 정상 저장됩니다!)</span>
          </p>
        </div>

        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 12.5, color: ACCENT, fontWeight: 600, marginBottom: 8 }}>
            설치 가이드 (상세설명 펼치기)
          </summary>
          <ol style={{ fontSize: 12.5, color: TEXT_DIM, lineHeight: 1.9, paddingLeft: 18, marginTop: 10 }}>
            <li>
              구글 시트 접속 후 상단 메뉴의 <b>확장 프로그램 (Extensions) → Apps Script</b>를 선택합니다.
            </li>
            <li>
              위의 <b>[코드 복사하기]</b> 버튼을 눌러 복사한 스크립트를 전체 붙여넣기합니다.
            </li>
            <li>
              <span style={{ color: OK, fontWeight: "bold" }}>[업데이트 완료 - 시트명 자동 감지]</span> 이제 스크립트 상단의 <span className="mono" style={{ color: TEXT_MAIN }}>INVENTORY_SHEET_NAME</span>(시트명)을 수동으로 고칠 필요가 없습니다! 스크립트가 스프레드시트 내 "관리시트", "시트1", "Sheet1" 또는 "재고", "인벤토리" 단어가 들어간 탭을 자동으로 찾아 연동합니다.
            </li>
            <li>
              <b>[구글 드라이브 권한(DriveApp) 승인 팝업 띄우기 (필수)]</b>: 에디터 화면 상단 툴바의 함수 선택 창(기본값: doGet)에서 <b style={{ color: OK }}>testDrivePermission</b>을 선택한 뒤, 바로 왼쪽의 <b style={{ color: OK }}>실행(Run)</b> 단추를 누릅니다.
            </li>
            <li>
              화면에 <b>'권한 승인 필요(Authorization Required)'</b> 팝업창이 나타납니다. <b>[권한 검토]</b> → 계정 선택 → <b>[고급(Advanced)]</b> → <b>[Untitled project(으)로 이동]</b> → <b>[허용(Allow)]</b>을 순서대로 진행하여 권한을 꼭 승인해 주세요. (이 과정을 거쳐야 사진이 구글 드라이브에 정상 저장됩니다!)
            </li>
            <li>
              권한 허용 완료 후, 우측 상단의 <b>배포 (Deploy) → 새 배포 (New Deployment)</b>를 누릅니다. (이미 기존 배포가 있다면, <b>배포 관리 → 수정(연필) → 버전 선택에서 '새 버전' 선택</b>으로 교체하여 배포하셔도 됩니다.)
            </li>
            <li>
              유형 선택 톱니바퀴에서 <b>웹 앱 (Web App)</b>을 고르고, 실행 사용자는 <b>나 (Me)</b>, 액세스할 수 있는 사람은 <b>모든 사람 (Anyone)</b>으로 지정해 배포를 누릅니다.
            </li>
            <li>
              생성된 <b>웹 앱 URL</b>을 아래 입력란에 넣고 연동을 시작합니다.
            </li>
          </ol>
        </details>

        <div style={{ background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.3)", color: "#34d399", borderRadius: "8px", padding: "12px 14px", fontSize: "11.5px", marginBottom: "16px", lineHeight: "1.6" }}>
          🚀 <b>[업데이트 완료: 구글 드라이브(DriveApp) 원본 화질 자동 저장 지원!]</b><br />
          불량로그 등록 시 사진을 선택하거나 드래그앤드롭하면, 무손실 원본 화질의 이미지가 구글 드라이브의 전용 폴더에 안전하게 업로드되어 스프레드시트에 고정 주소로 연동됩니다.<br />
          사내 보안 정책 등으로 인해 전체 공개 링크 생성이 제한되는 기업 계정 환경에서도 도메인 내 공유(setSharing) 권한을 자동으로 시도 및 처리하도록 완벽히 설계되어 안심하고 사용하실 수 있습니다!
        </div>

        <label style={{ fontSize: 12, color: TEXT_DIM, display: "block", marginBottom: 6 }}>
          Apps Script 웹앱 URL (웹 앱 주소)
        </label>
        <input
          value={scriptUrl}
          onChange={(e) => setScriptUrl(e.target.value)}
          placeholder="https://script.google.com/macros/s/AKfycb.../exec"
          style={{
            width: "100%",
            marginBottom: 8,
            background: "var(--input-bg, #0f172a)",
            border: `1px solid ${PANEL_BORDER}`,
            color: "var(--text-main, #f1f5f9)",
            padding: "8px 12px",
            borderRadius: "6px",
            fontSize: "13px"
          }}
        />
        {scriptUrl.includes("docs.google.com") && (
          <div style={{ background: "rgba(244, 63, 94, 0.12)", border: `1px solid ${DANGER}`, color: "#fca5a5", borderRadius: "6px", padding: "10px", fontSize: "12px", marginBottom: "12px", lineHeight: "1.5" }}>
            ⚠️ <b>입력하신 주소는 구글 스프레드시트 자체의 웹 브라우저 주소입니다.</b>
            <br />
            연동을 위해서는 스프레드시트 자체가 아닌, 스프레드시트 내 <b>[확장 프로그램] → [Apps Script]</b>에서 복사한 코드를 넣고 <b>[배포]</b>하여 발급받은 <b>웹 앱 URL(https://script.google.com/macros/s/.../exec)</b>을 입력해 주세요. (위의 설치 가이드를 클릭해 상세 설명을 확인하세요!)
          </div>
        )}
        {connectError && (
          <div style={{ marginTop: 12, marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: DANGER, marginBottom: 10, whiteSpace: "pre-line", background: "rgba(239, 68, 68, 0.08)", padding: 12, borderRadius: 6, border: "1px solid rgba(239, 68, 68, 0.3)" }}>
              ❌ {connectError}
            </div>
            
            <details style={{ background: "rgba(30, 41, 59, 0.7)", border: `1px solid ${PANEL_BORDER}`, borderRadius: 8, padding: 12 }} open>
              <summary style={{ cursor: "pointer", fontSize: 12.5, color: ACCENT, fontWeight: 700, outline: "none" }}>
                🔍 연동 실패 시 5가지 체크리스트 (자가 진단 및 해결 가이드)
              </summary>
              <div style={{ marginTop: 10, fontSize: 12, color: TEXT_DIM, lineHeight: "1.7", display: "flex", flexDirection: "column", gap: 12 }}>
                <div>
                  <b style={{ color: "#f1f5f9" }}>① 웹앱 URL 형식 확인 (가장 흔한 실수!)</b>
                  <br />
                  복사하신 주소 끝이 반드시 <code style={{ color: OK, background: "#0f172a", padding: "1px 4px", borderRadius: 3 }}>/exec</code>로 끝나야 합니다. 만약 주소 끝이 <code style={{ color: DANGER, background: "#0f172a", padding: "1px 4px", borderRadius: 3 }}>/dev</code>로 끝난다면 그것은 임시 테스트용 주소이므로 본인 외에는 접속이 차단되어 CORS 오류가 발생합니다. <b style={{ color: OK }}>[배포] → [새 배포]</b>를 눌러 새 웹앱 주소를 발급받으세요.
                </div>
                
                <div>
                  <b style={{ color: "#f1f5f9" }}>② 회사 / 학교 (Google Workspace) 계정의 특수 보안 정책 우회법</b>
                  <br />
                  단체/기업용 구글 계정은 보안 정책 상 외부 서비스 연동이 사전에 전면 차단되어 있을 수 있습니다.
                  <br />
                  <span style={{ color: OK, fontWeight: "bold" }}>💡 초간단 해결책:</span> 개인 구글 계정(<code style={{ color: OK }}>@gmail.com</code>)으로 새 구글 시트를 만들어 거기서 Apps Script를 배포하세요. 배포 완료 후 해당 스프레드시트를 본인의 <b>회사/학교 계정으로 공유(편집자 권한)</b>하시면, 사내 업무 계정에서 완벽하게 모니터링 및 실시간 동시 관리가 가능합니다!
                </div>
                
                <div>
                  <b style={{ color: "#f1f5f9" }}>③ 액세스할 수 있는 사람 '모든 사람(Anyone)' 지정 누락</b>
                  <br />
                  Apps Script 웹앱 배포 설정창에서 <b style={{ color: "#f1f5f9" }}>'액세스할 수 있는 사람(Who has access)'</b> 항목을 <b style={{ color: OK }}>'모든 사람(Anyone)'</b>으로 변경하셨는지 확인하세요. '나(Only myself)'나 '조직원(Anyone within organization)'으로 되어 있으면 외부 브라우저 통신이 모두 차단됩니다.
                </div>
                
                <div>
                  <b style={{ color: "#f1f5f9" }}>④ 구글 드라이브(사진 업로드용) 권한 승인 누락</b>
                  <br />
                  Apps Script 에디터 화면 상단의 실행 버튼 왼쪽 드롭다운에서 <b style={{ color: OK }}>testDrivePermission</b>을 선택하고 <b style={{ color: OK }}>실행(Run)</b>을 꼭 1회 이상 수동으로 눌러 팝업에서 <b>[고급] → [이동] → [허용]</b> 단계까지 모두 통과해주셔야 데이터 업로드가 작동합니다.
                </div>
                
                <div>
                  <b style={{ color: "#f1f5f9" }}>⑤ 스크립트 수정 후 '새 버전' 배포 업데이트 누락</b>
                  <br />
                  Apps Script 에디터에서 코드를 붙여넣고 저장한 뒤에 <b>[배포 관리] → [수정] → 버전을 반드시 '새 버전(New Version)'으로 선택 및 배포</b>하거나 <b>[새 배포]</b>를 다시 생성해주셔야 구글 서버에 변경된 코드가 최종 반영됩니다. 그냥 저장(디스크 아이콘)만 누르면 반영되지 않습니다.
                </div>
              </div>
            </details>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button
            onClick={onConnect}
            disabled={connecting}
            style={{
              flex: 1,
              background: OK,
              border: `1px solid ${OK}`,
              color: "#020617",
              borderRadius: 7,
              padding: "11px 0",
              fontSize: 13.5,
              fontWeight: 600,
              opacity: connecting ? 0.7 : 1,
              cursor: "pointer",
            }}
          >
            {connecting ? "연동 확인 중..." : connected ? "다시 연동하기" : "연동하기"}
          </button>
          {connected && (
            <button
              onClick={onDisconnect}
              style={{
                flex: 1,
                background: "transparent",
                border: `1px solid ${PANEL_BORDER}`,
                color: TEXT_DIM,
                borderRadius: 7,
                padding: "11px 0",
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              연동 해제 (로컬 모드)
            </button>
          )}
        </div>

        {connected && scriptUrl && (
          <div style={{ marginTop: 20, background: "rgba(37, 99, 235, 0.08)", padding: 14, borderRadius: 10, border: "1px dashed rgba(37, 99, 235, 0.45)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4 }}>
                  👥 타인/동료 기기 동기화 링크
                </div>
                <div style={{ fontSize: 11.5, color: TEXT_DIM, marginTop: 4, lineHeight: 1.5 }}>
                  다른 사용자가 설정 변경 없이 내 구글 스프레드시트와 실시간 연동된 화면을 보게 하려면 아래 링크를 전달하세요!
                </div>
              </div>
              <button
                onClick={handleCopyShareLink}
                style={{
                  background: shareCopied ? OK : ACCENT,
                  color: "#ffffff",
                  border: "none",
                  borderRadius: 6,
                  padding: "8px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "background 0.2s ease",
                  boxShadow: "0 2px 4px rgba(0, 0, 0, 0.15)",
                }}
              >
                {shareCopied ? "✓ 링크 복사 완료" : "공유 링크 복사"}
              </button>
            </div>
          </div>
        )}

        {!connected && (
          <div style={{ fontSize: 11.5, color: TEXT_DIM, marginTop: 14, lineHeight: 1.6, textAlign: "center" }}>
            연동을 하지 않고도 우측 상단의 ✕ 를 눌러 데모 데이터로 가상 테스트를 진행할 수 있습니다.
          </div>
        )}
      </div>
    </div>
  );
}
