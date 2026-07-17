import React, { useCallback, useEffect, useState } from "react";
import { Fingerprint, Link2, MapPin, Package, Undo2, Warehouse } from "lucide-react";
import { DefectLog, InventoryItem, RentLog, ToastMsg } from "./types";
import { C, cardStyle, Spinner, Toast } from "./ui";
import { clearSavedUrl, fetchAll, getSavedUrl, saveUrl } from "./api";
import RentalTab from "./components/RentalTab";
import ScenarioTab from "./components/ScenarioTab";
import LocationBrowsePage from "./components/LocationBrowsePage";
import WarehouseManagePage from "./components/WarehouseManagePage";

type Screen =
  | "landing"
  | "scenario-menu"
  | "scenario-location"
  | "scenario-borrow"
  | "scenario-return"
  | "material-menu"
  | "material-location"
  | "material-borrow"
  | "material-return"
  | "warehouse-manage";

// 가명이었던 두 카테고리 이름 - 여기 두 줄만 바꾸면 화면 전체 문구가 바뀝니다.
const SCENARIO_LABEL = "시나리오 물품 대여/반납";
const MATERIAL_LABEL = "창고 자재 대여/반납";

export default function App() {
  const [scriptUrl, setScriptUrl] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const [screen, setScreen] = useState<Screen>("landing");

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [rentLogs, setRentLogs] = useState<RentLog[]>([]);
  const [defectLogs, setDefectLogs] = useState<DefectLog[]>([]);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  function showToast(msg: string, type: ToastMsg["type"]) {
    setToast({ msg, type });
    window.setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    const saved = getSavedUrl();
    if (saved) setUrlDraft(saved);
  }, []);

  const refresh = useCallback(async () => {
    if (!scriptUrl) return;
    const data = await fetchAll(scriptUrl);
    setInventory(data.inventory || []);
    setRentLogs(data.rentLogs || []);
    setDefectLogs(data.defectLogs || []);
    setLastSync(new Date());
  }, [scriptUrl]);

  async function connect() {
    const url = urlDraft.trim();
    if (!url) {
      showToast("GAS 배포 URL을 입력해주세요.", "warn");
      return;
    }
    setConnecting(true);
    try {
      const data = await fetchAll(url);
      setScriptUrl(url);
      setConnected(true);
      saveUrl(url);
      setInventory(data.inventory || []);
      setRentLogs(data.rentLogs || []);
      setDefectLogs(data.defectLogs || []);
      setLastSync(new Date());
      showToast(`연동되었습니다. (재고 ${((data.inventory || []) as unknown[]).length}건 로드)`, "ok");
    } catch (e: any) {
      showToast("연동 실패: " + e.message, "error");
    } finally {
      setConnecting(false);
    }
  }

  function disconnect() {
    setConnected(false);
    setScriptUrl("");
    clearSavedUrl();
    setInventory([]);
    setRentLogs([]);
    setDefectLogs([]);
    setScreen("landing");
  }

  function TopBar() {
    return (
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 16,
          padding: 14,
          marginBottom: 16,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <Link2 size={16} style={{ color: C.sub, flexShrink: 0 }} />
        <input
          style={{
            flex: 1,
            padding: "9px 11px",
            borderRadius: 9,
            border: `1.5px solid ${C.border}`,
            background: C.inputBg,
            fontSize: 12,
            outline: "none",
          }}
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          placeholder="GAS 배포 URL (.../exec) 붙여넣기"
          onKeyDown={(e) => e.key === "Enter" && connect()}
        />
        {connected ? (
          <button
            onClick={disconnect}
            style={{ background: "#f1f5f9", color: C.sub, border: "none", borderRadius: 9, padding: "9px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}
          >
            연동 해제
          </button>
        ) : (
          <button
            onClick={connect}
            disabled={connecting}
            style={{
              background: connecting ? C.border : C.primary,
              color: "#fff",
              border: "none",
              borderRadius: 9,
              padding: "9px 16px",
              fontSize: 12,
              fontWeight: 700,
              cursor: connecting ? "not-allowed" : "pointer",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {connecting ? <Spinner size={13} /> : null}
            연동
          </button>
        )}
      </div>
    );
  }

  function MenuCard({ icon, title, sub, color, onClick }: { icon: React.ReactNode; title: string; sub: string; color: string; onClick: () => void }) {
    return (
      <div onClick={onClick} style={{ ...cardStyle, padding: 20, display: "flex", alignItems: "center", gap: 16, cursor: "pointer" }}>
        <div style={{ width: 48, height: 48, borderRadius: 14, background: `${color}1f`, color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>{title}</div>
          <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{sub}</div>
        </div>
      </div>
    );
  }

  // 첫 화면 - 3버튼
  function LandingMenu() {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <MenuCard
          icon={<Fingerprint size={20} />}
          title={SCENARIO_LABEL}
          sub="위치 열람 · 대여 · 반납"
          color={C.primary}
          onClick={() => setScreen("scenario-menu")}
        />
        <MenuCard
          icon={<Package size={20} />}
          title={MATERIAL_LABEL}
          sub="위치 열람 · 대여 · 반납"
          color={C.success}
          onClick={() => setScreen("material-menu")}
        />
        <MenuCard
          icon={<Warehouse size={20} />}
          title="창고 관리"
          sub="랙별 물품을 등록·수정·삭제합니다 (관리자용)"
          color={C.warn}
          onClick={() => setScreen("warehouse-manage")}
        />
      </div>
    );
  }

  // 시나리오/자재 공통 서브메뉴 - 위치 열람 / 대여 / 반납
  function SubMenu({
    title, onBack, onLocation, onBorrow, onReturn, color,
  }: {
    title: string; onBack: () => void; onLocation: () => void; onBorrow: () => void; onReturn: () => void; color: string;
  }) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <button onClick={onBack} style={{ background: "#f1f5f9", color: C.sub, border: "none", borderRadius: 10, padding: "8px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            ← 처음으로
          </button>
          <h3 style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0 }}>{title}</h3>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <MenuCard icon={<MapPin size={20} />} title="위치 열람" sub="랙 배치도에서 물품 위치와 사진을 확인합니다" color={color} onClick={onLocation} />
          <MenuCard icon={<Package size={20} />} title="대여" sub="물품을 대여 신청합니다" color={color} onClick={onBorrow} />
          <MenuCard icon={<Undo2 size={20} />} title="반납" sub="대여 중인 물품을 반납합니다" color={color} onClick={onReturn} />
        </div>
      </div>
    );
  }

  function renderScreen() {
    switch (screen) {
      case "landing":
        return <LandingMenu />;

      case "scenario-menu":
        return (
          <SubMenu
            title={SCENARIO_LABEL}
            color={C.primary}
            onBack={() => setScreen("landing")}
            onLocation={() => setScreen("scenario-location")}
            onBorrow={() => setScreen("scenario-borrow")}
            onReturn={() => setScreen("scenario-return")}
          />
        );
      case "scenario-location":
        return (
          <LocationBrowsePage
            scope="scenario"
            scriptUrl={scriptUrl}
            inventory={inventory}
            onBack={() => setScreen("scenario-menu")}
            showToast={showToast}
          />
        );
      case "scenario-borrow":
        return <ScenarioTab scriptUrl={scriptUrl} showToast={showToast} startMode="borrow" onExitToMenu={() => setScreen("scenario-menu")} />;
      case "scenario-return":
        return <ScenarioTab scriptUrl={scriptUrl} showToast={showToast} startMode="return" onExitToMenu={() => setScreen("scenario-menu")} />;

      case "material-menu":
        return (
          <SubMenu
            title={MATERIAL_LABEL}
            color={C.success}
            onBack={() => setScreen("landing")}
            onLocation={() => setScreen("material-location")}
            onBorrow={() => setScreen("material-borrow")}
            onReturn={() => setScreen("material-return")}
          />
        );
      case "material-location":
        return (
          <LocationBrowsePage
            scope="material"
            scriptUrl={scriptUrl}
            inventory={inventory}
            onBack={() => setScreen("material-menu")}
            showToast={showToast}
          />
        );
      case "material-borrow":
        return (
          <RentalTab
            scriptUrl={scriptUrl}
            inventory={inventory}
            rentLogs={rentLogs}
            onRefresh={refresh}
            showToast={showToast}
            initialType="대여"
            title={`${MATERIAL_LABEL} · 대여`}
            onBack={() => setScreen("material-menu")}
          />
        );
      case "material-return":
        return (
          <RentalTab
            scriptUrl={scriptUrl}
            inventory={inventory}
            rentLogs={rentLogs}
            onRefresh={refresh}
            showToast={showToast}
            initialType="반납"
            title={`${MATERIAL_LABEL} · 반납`}
            onBack={() => setScreen("material-menu")}
          />
        );

      case "warehouse-manage":
        return (
          <WarehouseManagePage
            scriptUrl={scriptUrl}
            inventory={inventory}
            onBack={() => setScreen("landing")}
            onRefreshInventory={refresh}
            showToast={showToast}
          />
        );
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "system-ui, -apple-system, 'Malgun Gothic', sans-serif" }}>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; }
        .wms-spin { animation: wms-spin-kf 1s linear infinite; }
        @keyframes wms-spin-kf { to { transform: rotate(360deg); } }
        input:focus, textarea:focus { border-color: ${C.primary} !important; }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 16px 60px" }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>통합 창고 · 물품 관리</h1>
          <p style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>
            {SCENARIO_LABEL} · {MATERIAL_LABEL} · 창고 관리를 한 곳에서
          </p>
        </div>

        <TopBar />

        {toast && <Toast msg={toast.msg} type={toast.type} />}

        {!connected ? (
          <div
            style={{
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.25)",
              borderRadius: 14,
              padding: 20,
              fontSize: 13,
              color: C.warn,
              fontWeight: 700,
              textAlign: "center",
            }}
          >
            상단에 GAS 배포 URL을 넣고 연동해주세요.
          </div>
        ) : (
          <>
            {lastSync && screen === "landing" && (
              <div style={{ fontSize: 11, color: C.sub, marginBottom: 10, textAlign: "right" }}>최근 동기화: {lastSync.toLocaleTimeString()}</div>
            )}
            {renderScreen()}
          </>
        )}
      </div>
    </div>
  );
}
