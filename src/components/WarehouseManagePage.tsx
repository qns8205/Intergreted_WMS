import React, { useEffect, useMemo, useState } from "react";
import { InventoryItem, ScenarioObjectItem } from "../types";
import { RackZone } from "../rackConfig";
import { C, secondaryBtnStyle } from "../ui";
import { callGas } from "../api";
import LocationMap from "./LocationMap";
import ZoneDetailPanel from "./ZoneDetailPanel";

interface Props {
  scriptUrl: string;
  inventory: InventoryItem[];
  onBack: () => void;
  onRefreshInventory: () => Promise<void>;
  showToast: (msg: string, type: "ok" | "error" | "warn" | "info") => void;
}

export default function WarehouseManagePage({ scriptUrl, inventory, onBack, onRefreshInventory, showToast }: Props) {
  const [selectedZone, setSelectedZone] = useState<RackZone | null>(null);
  const [scenarioItems, setScenarioItems] = useState<ScenarioObjectItem[]>([]);
  const [scenarioLoading, setScenarioLoading] = useState(false);

  useEffect(() => {
    setScenarioLoading(true);
    callGas(scriptUrl, "borrow_getObjects")
      .then((d) => setScenarioItems(d.items || []))
      .catch((e) => showToast("시나리오 물품 목록 조회 실패: " + e.message, "error"))
      .finally(() => setScenarioLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptUrl]);

  const hasItemsMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    inventory.forEach((it) => {
      const loc = it.location?.trim().toUpperCase();
      if (loc) map[loc[0]] = true;
    });
    return map;
  }, [inventory]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={onBack} style={{ ...secondaryBtnStyle, padding: "8px 12px" }}>
          ← 메뉴로
        </button>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0 }}>창고 관리</h3>
      </div>

      <div style={{ fontSize: 12, color: C.sub, marginBottom: 10 }}>
        랙을 눌러 해당 위치의 물품을 확인·등록·수정·삭제할 수 있습니다. (숫자 랙 = 시나리오 물품, 알파벳 랙 = 창고 공구 및 부품류)
      </div>

      <LocationMap onZoneClick={setSelectedZone} activeZoneId={selectedZone?.id} hasItemsMap={hasItemsMap} />

      {selectedZone && (
        <div
          onClick={() => setSelectedZone(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.35)", zIndex: 80 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "clamp(280px, 60vw, 640px)",
              background: "#fff",
              boxShadow: "-10px 0 30px rgba(0,0,0,0.15)",
              padding: 20,
              overflowY: "auto",
              zIndex: 90,
            }}
          >
            <ZoneDetailPanel
              zone={selectedZone}
              mode="manage"
              scriptUrl={scriptUrl}
              scenarioItems={scenarioItems}
              scenarioItemsLoading={scenarioLoading}
              inventory={inventory}
              onRefreshInventory={onRefreshInventory}
              showToast={showToast}
              onClose={() => setSelectedZone(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
