import React, { useEffect, useMemo, useState } from "react";
import { InventoryItem, ScenarioObjectItem } from "../types";
import { RackZone } from "../rackConfig";
import { C, cardStyle, secondaryBtnStyle } from "../ui";
import { callGas } from "../api";
import LocationMap from "./LocationMap";
import ZoneDetailPanel from "./ZoneDetailPanel";

interface Props {
  scope: "scenario" | "material";
  scriptUrl: string;
  inventory: InventoryItem[];
  onBack: () => void;
  showToast: (msg: string, type: "ok" | "error" | "warn" | "info") => void;
}

export default function LocationBrowsePage({ scope, scriptUrl, inventory, onBack, showToast }: Props) {
  const [selectedZone, setSelectedZone] = useState<RackZone | null>(null);
  const [scenarioItems, setScenarioItems] = useState<ScenarioObjectItem[]>([]);
  const [scenarioLoading, setScenarioLoading] = useState(false);

  useEffect(() => {
    if (scope !== "scenario") return;
    setScenarioLoading(true);
    callGas(scriptUrl, "borrow_getObjects")
      .then((d) => setScenarioItems(d.items || []))
      .catch((e) => showToast("시나리오 물품 목록 조회 실패: " + e.message, "error"))
      .finally(() => setScenarioLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, scriptUrl]);

  const hasItemsMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (scope === "material") {
      inventory.forEach((it) => {
        const loc = it.location?.trim().toUpperCase();
        if (!loc) return;
        const letter = loc[0];
        map[letter] = true;
      });
    } else {
      scenarioItems.forEach((it) => {
        const n = parseInt(it.rootSlot?.replace(/\D/g, "") || "", 10);
        if (isNaN(n)) return;
        // 어느 존에 속하는지는 ZoneDetailPanel에서 계산하므로 여기서는 단순 표시만
      });
    }
    return map;
  }, [scope, inventory, scenarioItems]);

  function handleZoneClick(zone: RackZone) {
    const relevant = scope === "scenario" ? zone.kind === "numeric" : zone.kind === "letter";
    if (!relevant) {
      showToast(scope === "scenario" ? "시나리오 물품은 숫자 랙(I·G·K)에서 확인할 수 있습니다." : "창고 자재는 알파벳 랙(A~E)에서 확인할 수 있습니다.", "info");
      return;
    }
    setSelectedZone(zone);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={onBack} style={{ ...secondaryBtnStyle, padding: "8px 12px" }}>
          ← 메뉴로
        </button>
        <h3 style={{ fontSize: 16, fontWeight: 800, color: C.text, margin: 0 }}>
          위치 열람 · {scope === "scenario" ? "시나리오 물품" : "창고 자재"}
        </h3>
      </div>

      <div style={{ fontSize: 12, color: C.sub, marginBottom: 10 }}>
        {scope === "scenario" ? "숫자로 표시된 I · G · K 랙을 눌러 시나리오 물품 위치를 확인하세요." : "알파벳으로 표시된 A~E 랙을 눌러 창고 자재 위치를 확인하세요."}
      </div>

      <LocationMap onZoneClick={handleZoneClick} activeZoneId={selectedZone?.id} />

      {selectedZone && (
        <div style={{ ...cardStyle, marginTop: 14 }}>
          <ZoneDetailPanel
            zone={selectedZone}
            mode="view"
            scriptUrl={scriptUrl}
            scenarioItems={scenarioItems}
            scenarioItemsLoading={scenarioLoading}
            inventory={inventory}
            onRefreshInventory={async () => {}}
            showToast={showToast}
            onClose={() => setSelectedZone(null)}
          />
        </div>
      )}
    </div>
  );
}
