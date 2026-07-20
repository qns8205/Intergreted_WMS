import React, { useMemo, useState } from "react";
import { Loader2, Plus, Trash2, X } from "lucide-react";
import { InventoryItem, ScenarioObjectItem } from "../types";
import { RackZone, chunkSlots, padSlotId } from "../rackConfig";
import { C, cardStyle, primaryBtn, secondaryBtnStyle, Spinner } from "../ui";
import { callGas } from "../api";
import PhotoThumb from "./PhotoThumb";
import InventoryItemForm from "./InventoryItemForm";

interface Props {
  zone: RackZone;
  mode: "view" | "manage";
  scriptUrl: string;
  scenarioItems: ScenarioObjectItem[];
  scenarioItemsLoading: boolean;
  inventory: InventoryItem[];
  onRefreshInventory: () => Promise<void>;
  showToast: (msg: string, type: "ok" | "error" | "warn" | "info") => void;
  onClose: () => void;
}

export default function ZoneDetailPanel({
  zone, mode, scriptUrl, scenarioItems, scenarioItemsLoading, inventory, onRefreshInventory, showToast, onClose,
}: Props) {
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);

  const slotRows = useMemo(() => {
    if (zone.kind !== "numeric" || zone.start == null || zone.end == null) return [];
    return chunkSlots(zone.start, zone.end, zone.rowSizes || [6]);
  }, [zone]);

  const scenarioItemsInZone = useMemo(() => {
    if (zone.kind !== "numeric") return [];
    return scenarioItems.filter((it) => {
      const n = parseInt(it.rootSlot?.replace(/\D/g, "") || "", 10);
      return !isNaN(n) && n >= (zone.start ?? 0) && n <= (zone.end ?? -1);
    });
  }, [scenarioItems, zone]);

  const slotHasItems = useMemo(() => {
    const set = new Set<number>();
    scenarioItemsInZone.forEach((it) => {
      const n = parseInt(it.rootSlot?.replace(/\D/g, "") || "", 10);
      if (!isNaN(n)) set.add(n);
    });
    return set;
  }, [scenarioItemsInZone]);

  const slotFilteredItems = useMemo(() => {
    if (selectedSlot == null) return scenarioItemsInZone;
    return scenarioItemsInZone.filter((it) => padSlotId(selectedSlot) === it.rootSlot);
  }, [scenarioItemsInZone, selectedSlot]);

  const inventoryInZone = useMemo(() => {
    if (zone.kind !== "letter" || !zone.matchPrefix) return [];
    const prefix = zone.matchPrefix.toUpperCase();
    return inventory.filter((it) => it.location?.trim().toUpperCase().startsWith(prefix));
  }, [inventory, zone]);

  async function handleSaveInventory(payload: any) {
    try {
      if (payload.rowIndex) {
        await callGas(scriptUrl, "updateInventoryItem", payload);
        showToast("물품 정보를 수정했습니다.", "ok");
      } else {
        await callGas(scriptUrl, "addInventoryItem", payload);
        showToast("새 물품을 등록했습니다.", "ok");
      }
      setShowForm(false);
      setEditingItem(null);
      await onRefreshInventory();
    } catch (e: any) {
      showToast("저장 실패: " + e.message, "error");
    }
  }

  async function handleDelete(item: InventoryItem) {
    if (!confirm(`'${item.name}' 항목을 삭제할까요?`)) return;
    try {
      await callGas(scriptUrl, "deleteInventoryItem", { rowIndex: item.rowIndex });
      showToast("삭제되었습니다.", "ok");
      await onRefreshInventory();
    } catch (e: any) {
      showToast("삭제 실패: " + e.message, "error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: C.text }}>{zone.label.replace("\n", " ")}</div>
        <button onClick={onClose} style={{ ...secondaryBtnStyle, padding: 6 }}>
          <X size={14} />
        </button>
      </div>

      {zone.kind === "numeric" && (
        <>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              border: `1px solid ${C.border}`,
              borderRadius: 10,
              padding: 8,
              maxHeight: 180,
              overflowY: "auto",
            }}
          >
            {slotRows.map((row, ri) => (
              <div key={ri} style={{ display: "flex", gap: 4 }}>
                {row.map((n) => (
                  <button
                    key={n}
                    onClick={() => setSelectedSlot(selectedSlot === n ? null : n)}
                    style={{
                      flex: 1,
                      fontSize: 10,
                      fontFamily: "monospace",
                      padding: "6px 2px",
                      borderRadius: 6,
                      border: `1px solid ${selectedSlot === n ? C.primary : C.border}`,
                      background: selectedSlot === n ? C.primaryLight : slotHasItems.has(n) ? "rgba(16,185,129,0.08)" : "#fff",
                      color: C.text,
                      cursor: "pointer",
                    }}
                  >
                    {padSlotId(n).slice(-3)}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.sub }}>
            {selectedSlot != null ? `슬롯 ${padSlotId(selectedSlot)} 물품 (${slotFilteredItems.length}개)` : `이 구역 전체 물품 (${scenarioItemsInZone.length}개)`}
          </div>
        </>
      )}

      {zone.kind === "letter" && mode === "manage" && (
        <button
          style={primaryBtn(false)}
          onClick={() => {
            setEditingItem(null);
            setShowForm(true);
          }}
        >
          <Plus size={14} /> 이 위치에 물품 추가
        </button>
      )}

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {zone.kind === "numeric" &&
          (scenarioItemsLoading ? (
            <div style={{ padding: 20, textAlign: "center", color: C.sub, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Loader2 size={14} className="wms-spin" /> 불러오는 중...
            </div>
          ) : slotFilteredItems.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: C.sub, fontSize: 13 }}>등록된 물품이 없습니다.</div>
          ) : (
            slotFilteredItems.map((it) => (
              <div key={it.id} style={{ ...cardStyle, padding: 10, display: "flex", gap: 10 }}>
                <PhotoThumb src={it.image} alt={it.name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{it.name}</div>
                  <div style={{ fontSize: 11, color: C.sub }}>
                    ID {it.id} · {it.rootSlot}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: C.success, background: "rgba(16,185,129,0.12)", borderRadius: 6, padding: "1px 6px" }}>
                      재고 {it.stock ?? 0}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: C.primary, background: C.primaryLight, borderRadius: 6, padding: "1px 6px" }}>
                      대여중 {it.rented ?? 0}
                    </span>
                  </div>
                </div>
              </div>
            ))
          ))}

        {zone.kind === "letter" &&
          (inventoryInZone.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: C.sub, fontSize: 13 }}>등록된 물품이 없습니다.</div>
          ) : (
            inventoryInZone.map((it) => (
              <div key={it.rowIndex} style={{ ...cardStyle, padding: 10, display: "flex", gap: 10, alignItems: "center" }}>
                <PhotoThumb src={it.photo} alt={it.name} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{it.name}</div>
                  <div style={{ fontSize: 11, color: C.sub }}>
                    {it.location} · 재고 {it.stock ?? "N/A"}
                  </div>
                </div>
                {mode === "manage" && (
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => {
                        setEditingItem(it);
                        setShowForm(true);
                      }}
                      style={{ ...secondaryBtnStyle, padding: "4px 10px", fontSize: 11 }}
                    >
                      수정
                    </button>
                    <button onClick={() => handleDelete(it)} style={{ ...secondaryBtnStyle, padding: "4px 8px", fontSize: 11, color: C.danger }}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))
          ))}
      </div>

      {showForm && (
        <InventoryItemForm
          editing={editingItem}
          defaultLocation={zone.matchPrefix}
          onClose={() => {
            setShowForm(false);
            setEditingItem(null);
          }}
          onSubmit={handleSaveInventory}
          showToast={showToast}
        />
      )}
    </div>
  );
}
