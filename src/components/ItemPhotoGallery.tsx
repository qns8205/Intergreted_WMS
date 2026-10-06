import React, { useCallback, useEffect, useState } from "react";
import { Plus, X, Loader2 } from "lucide-react";
import { fetchItemPhotos, postAddItemPhoto, postDeleteItemPhoto, ItemPhotoEntry } from "../utils/borrowApi";
import { resizeAndCompressImage } from "../utils/drive";

// 아직 저장 안 된(신규 등록 중인) 물품에서 사진을 미리 골라두는 용도 — dataUrl을 그대로
// 썸네일로 쓰고, 실제 저장(rowIndex 발급) 후 부모가 이 목록을 순서대로 서버에 올린다.
export interface StagedPhoto {
  localId: string;
  dataUrl: string;
}

interface Props {
  scriptUrl: string;
  category: "scenario" | "warehouse";
  // 아직 저장 안 된(신규 등록 중인) 물품은 itemId가 없다.
  itemId: string | null | undefined;
  isLightMode: boolean;
  showToast: (msg: string, type: "ok" | "error" | "info" | "warn") => void;
  onImageClick?: (url: string) => void;
  // itemId가 없을 때(신규 등록 중) 이 두 개를 같이 주면, "먼저 저장해달라" 안내 대신
  // 로컬에 사진을 스테이징해두는 모드로 동작한다 — 실제 업로드는 부모가 저장 완료 후에 한다.
  stagedPhotos?: StagedPhoto[];
  onStagedPhotosChange?: (photos: StagedPhoto[]) => void;
}

/** 대표 사진과 별개로, 물품 하나에 여러 장을 추가로 등록/삭제하는 작은 갤러리.
 *  COS 물품(ItemFormModal)와 시나리오 오브젝트(ScenarioAdminPage) 편집 폼,
 *  모바일의 편집/등록 화면에서 공통으로 쓴다. */
export default function ItemPhotoGallery({ scriptUrl, category, itemId, isLightMode, showToast, onImageClick, stagedPhotos, onStagedPhotosChange }: Props) {
  const BORDER = isLightMode ? "#e6e9ef" : "#26324a";
  const CARD_SUB = isLightMode ? "#f4f6f9" : "#0f172a";
  const TEXT_DIM = isLightMode ? "#64748b" : "#94a3b8";

  const staging = !itemId && !!stagedPhotos && !!onStagedPhotosChange;

  const [photos, setPhotos] = useState<ItemPhotoEntry[]>([]);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!itemId) return;
    try {
      const items = await fetchItemPhotos(scriptUrl, category, itemId);
      setPhotos(items);
    } catch {
      /* 보조 기능이라 실패해도 조용히 넘어간다 */
    }
  }, [scriptUrl, category, itemId]);

  useEffect(() => { load(); }, [load]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (staging) {
      setUploading(true);
      try {
        const compressed = await resizeAndCompressImage(file);
        onStagedPhotosChange!([...(stagedPhotos || []), { localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, dataUrl: compressed }]);
      } catch (err: any) {
        showToast(`사진 추가 실패: ${err.message}`, "error");
      } finally {
        setUploading(false);
      }
      return;
    }

    if (!itemId) return;
    setUploading(true);
    try {
      const compressed = await resizeAndCompressImage(file);
      const res = await postAddItemPhoto(scriptUrl, category, itemId, compressed);
      if (!res.success) { showToast(res.error || "사진 추가에 실패했습니다.", "error"); return; }
      await load();
    } catch (err: any) {
      showToast(`사진 추가 실패: ${err.message}`, "error");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(id: number) {
    const prev = photos;
    setPhotos((p) => p.filter((x) => x.id !== id));
    try {
      const res = await postDeleteItemPhoto(scriptUrl, id);
      if (!res.success) throw new Error("삭제 실패");
    } catch (err: any) {
      setPhotos(prev); // 실패하면 되돌린다
      showToast(`사진 삭제 실패: ${err.message || ""}`, "error");
    }
  }

  function handleStagedDelete(localId: string) {
    onStagedPhotosChange!((stagedPhotos || []).filter((p) => p.localId !== localId));
  }

  if (!itemId && !staging) {
    return <div style={{ fontSize: "11.5px", color: TEXT_DIM }}>먼저 저장한 뒤에 사진을 추가로 등록할 수 있습니다.</div>;
  }

  const displayList: { key: string; thumb: string; full: string; onDelete: () => void }[] = staging
    ? (stagedPhotos || []).map((p) => ({ key: p.localId, thumb: p.dataUrl, full: p.dataUrl, onDelete: () => handleStagedDelete(p.localId) }))
    : photos.map((p) => ({ key: String(p.id), thumb: p.thumb, full: p.photo, onDelete: () => handleDelete(p.id) }));

  return (
    <div>
      <style>{`@keyframes ipgSpin { to { transform: rotate(360deg); } } .ipg-spin { animation: ipgSpin 0.8s linear infinite; }`}</style>
      {staging ? (
        <div style={{ fontSize: "11px", color: TEXT_DIM, marginBottom: "6px" }}>저장하면 함께 등록됩니다.</div>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {displayList.map((p) => (
          <div key={p.key} style={{ position: "relative", width: "64px", height: "64px", borderRadius: "8px", overflow: "hidden", border: `1px solid ${BORDER}`, flexShrink: 0 }}>
            <img
              src={p.thumb}
              alt=""
              onClick={() => onImageClick && onImageClick(p.full)}
              style={{ width: "100%", height: "100%", objectFit: "cover", cursor: onImageClick ? "zoom-in" : "default", display: "block" }}
            />
            <button
              type="button"
              onClick={p.onDelete}
              title="이 사진 삭제"
              style={{ position: "absolute", top: "2px", right: "2px", width: "18px", height: "18px", borderRadius: "5px", border: "none", background: "rgba(15,23,42,0.72)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <label
          style={{
            width: "64px", height: "64px", borderRadius: "8px", border: `1px dashed ${BORDER}`, background: CARD_SUB, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: uploading ? "default" : "pointer", color: TEXT_DIM,
          }}
        >
          {uploading ? <Loader2 size={16} className="ipg-spin" /> : <Plus size={18} />}
          <input type="file" accept="image/*" onChange={handleFile} disabled={uploading} style={{ display: "none" }} />
        </label>
      </div>
    </div>
  );
}
