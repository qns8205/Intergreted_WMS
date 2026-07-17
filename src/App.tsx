import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ClipboardList, Fingerprint, Link2, Loader2, Warehouse } from "lucide-react";
import { DefectLog, InventoryItem, RentLog, ToastMsg } from "./types";
import { C, Spinner, Toast } from "./ui";
import { clearSavedUrl, fetchAll, getSavedUrl, saveUrl } from "./api";
import InventoryTab from "./components/InventoryTab";
import RentalTab from "./components/RentalTab";
import DefectTab from "./components/DefectTab";
import ScenarioTab from "./components/ScenarioTab";

type Tab = "monitor" | "rental" | "defect" | "scenario";

export default function App() {
  const [scriptUrl, setScriptUrl] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [toast, setToast] = useState<ToastMsg | null>(null);
  const [tab, setTab] = useState<Tab>("monitor");

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
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "monitor", label: "창고 재고", icon: <Warehouse size={14} /> },
    { key: "rental", label: "자재 대여·반납", icon: <ClipboardList size={14} /> },
    { key: "defect", label: "불량로그", icon: <AlertTriangle size={14} /> },
    { key: "scenario", label: "시나리오 대여", icon: <Fingerprint size={14} /> },
  ];

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
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>통합 창고 · 시나리오 물품 관리</h1>
          <p style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>창고 재고 · 자재 대여 · 불량로그 · 시나리오 물품 대여를 한 곳에서</p>
        </div>

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
            상단에 GAS 배포 URL을 넣고 연동하면 창고 재고 · 자재 대여 · 불량로그 · 시나리오 대여를 모두 확인할 수 있습니다.
          </div>
        ) : (
          <>
            {lastSync && (
              <div style={{ fontSize: 11, color: C.sub, marginBottom: 10, textAlign: "right" }}>
                최근 동기화: {lastSync.toLocaleTimeString()}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginBottom: 18, background: "#f1f5f9", padding: 4, borderRadius: 14, flexWrap: "wrap" }}>
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    flex: "1 1 auto",
                    minWidth: 130,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    padding: "10px 8px",
                    borderRadius: 10,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                    background: tab === t.key ? C.card : "transparent",
                    color: tab === t.key ? C.primary : C.sub,
                    boxShadow: tab === t.key ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                  }}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {tab === "monitor" && <InventoryTab scriptUrl={scriptUrl} inventory={inventory} onRefresh={refresh} showToast={showToast} />}
            {tab === "rental" && <RentalTab scriptUrl={scriptUrl} inventory={inventory} rentLogs={rentLogs} onRefresh={refresh} showToast={showToast} />}
            {tab === "defect" && <DefectTab scriptUrl={scriptUrl} defectLogs={defectLogs} onRefresh={refresh} showToast={showToast} />}
            {tab === "scenario" && <ScenarioTab scriptUrl={scriptUrl} showToast={showToast} />}
          </>
        )}
      </div>
    </div>
  );
}
