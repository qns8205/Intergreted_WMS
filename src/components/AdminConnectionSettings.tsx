import React, { useEffect, useState } from "react";
import { X, Users, ShieldAlert, FileSpreadsheet, Trash2, Plus, Upload, Download, ScrollText, Search, ChevronLeft, ChevronRight, UserCheck, Check } from "lucide-react";
import { fetchScenarioObjectsForAdmin, ScenarioObjectAdmin } from "../utils/borrowApi";
import { smartMatch } from "../utils/search";
import { adminHeaders as tokenHeaders } from "../utils/adminAuth";

// 프론트엔드는 항상 로컬 API 서버 하나만 보므로 scriptUrl은 고정값이다(App.tsx도 동일하게 고정).
const GAS_URL = "/api/gas";

interface AdminConnectionSettingsProps {
  /** 모달로 띄울 때만 사용 (별개 메뉴 페이지로 임베드할 때는 생략) */
  onClose?: () => void;
  /** true면 오버레이/배경/닫기 버튼 없이 패널 내용만 그린다 (사이드바 메뉴의 일반 페이지처럼 사용) */
  embedded?: boolean;
  isLightMode: boolean;
  showToast: (msg: string, type?: "info" | "ok" | "warn" | "error") => void;
  /** 다른 설정 페이지가 이 컴포넌트의 일부 탭만 가져다 쓸 때 사용한다. */
  initialTab?: Tab;
  visibleTabs?: Tab[];
  showHeader?: boolean;
  showTabs?: boolean;
}

type Tab = "signups" | "admins" | "borrowers" | "penalties" | "scenarios" | "import";

interface AdminUser {
  id: number;
  loginId: string;
  name: string | null;
}

interface RegisteredUser {
  employee_id: string;
  name: string;
  active: number;
  imported_at: string | null;
  source?: string | null;
}

interface SignupRequest {
  id: number;
  employee_id: string;
  name: string;
  created_at: string;
  /** 예전에 지운 사번이면 그때의 이름 */
  previousName: string;
}

interface AdminSignupRequest {
  id: number;
  login_id: string;
  name: string;
  created_at: string;
}

interface Penalty {
  id: number;
  name: string | null;
  max_types: number | null;
  reason: string | null;
  expires_at: string | null;
  /** 원인으로 연결한 대여·반납 기록 수 */
  link_count?: number;
}

/** 페널티의 원인으로 연결하는 대여·반납 기록 한 줄(= 물품 하나). cause가 있으면 연결된 것이다. */
type LinkCause = "rental" | "return";
interface PenaltyRentalRow {
  sheetType: "scenario" | "general";
  rowId: number;
  itemName: string;
  variantName: string;
  qty: number;
  requestCode: string;
  appliedAt: string;
  pickedUpAt: string;
  returnedAt: string;
  state: string;
}
interface PenaltyLink extends PenaltyRentalRow { cause: LinkCause }
const CAUSE_LABEL: Record<LinkCause, string> = { rental: "대여 때문", return: "반납 때문" };
const CAUSE_COLOR: Record<LinkCause, string> = { rental: "#2563eb", return: "#d97706" };

/** 무인 모드 자동 페널티가 어떤 대여 때문에 생겼는지(서버 penaltyDetails). */
interface PenaltyDetailItem {
  name: string; qty: number; appliedAt: string; pickedUpAt: string; returnedAt: string;
  state: string; exempt: boolean; deadlineAt: string; missed: boolean; overMinutes: number;
}
interface PenaltyDetailEvent {
  eventType: string; label: string; requestCode: string; borrowerName: string; employeeId: string;
  sourceAt: string; deadlineAt: string; occurredAt: string; items: PenaltyDetailItem[];
}
type PenaltyDetailState = { loading: true } | { error: string } | { events: PenaltyDetailEvent[]; links: PenaltyLink[] };

// "2026-10-03 13:01:40" → "10/03 13:01"
const shortTime = (value: string) => (value ? value.slice(5, 16).replace("-", "/") : "");
const overText = (minutes: number) => {
  if (minutes < 60) return `${minutes}분`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ""}`;
  return `${Math.floor(minutes / 1440)}일${Math.floor((minutes % 1440) / 60) ? ` ${Math.floor((minutes % 1440) / 60)}시간` : ""}`;
};

/** 연결된 기록 한 줄의 설명: "신청 261004-001 · 대여 10/04 09:00 → 반납 10/05 12:00 · 반납 완료" */
const rentalMeta = (r: PenaltyRentalRow) =>
  [r.requestCode ? `신청 ${r.requestCode}` : "", `대여 ${shortTime(r.appliedAt) || "-"}${r.returnedAt ? ` → 반납 ${shortTime(r.returnedAt)}` : ""}`, r.state]
    .filter(Boolean).join(" · ");
const rentalTitle = (r: PenaltyRentalRow) => `${r.itemName}${r.variantName ? ` · ${r.variantName}` : ""} ×${r.qty}`;
const linkKey = (r: { sheetType: string; rowId: number }) => `${r.sheetType}:${r.rowId}`;

interface PickerColors { text: string; dim: string; border: string; panel: string; input: string; accent: string }

/**
 * 페널티의 원인이 된 대여·반납 기록을 고른다. 이름(또는 사번)으로 그 사람의 기록 줄을 불러오고,
 * 줄마다 "대여 때문"/"반납 때문"을 누르면 연결된다(같은 버튼을 다시 누르면 해제).
 * 이미 연결된 줄은 불러오기 전에도 맨 위에 보인다.
 */
function PenaltyLinkPicker({ name, value, onChange, colors, load }: {
  name: string;
  value: PenaltyLink[];
  onChange: (next: PenaltyLink[]) => void;
  colors: PickerColors;
  load: (name: string) => Promise<PenaltyRentalRow[]>;
}) {
  const [candidates, setCandidates] = useState<PenaltyRentalRow[]>([]);
  const [loadedFor, setLoadedFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function fetchRows() {
    const key = name.trim();
    if (!key) return;
    setLoading(true);
    setError("");
    try {
      setCandidates(await load(key));
      setLoadedFor(key);
    } catch (err: any) {
      setError(err.message || "기록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const selected = new Map(value.map((l) => [linkKey(l), l]));
  // 연결된 줄을 먼저, 그 아래에 아직 연결하지 않은 후보를 보여준다.
  const rows: PenaltyRentalRow[] = [...value, ...candidates.filter((c) => !selected.has(linkKey(c)))];

  function pick(row: PenaltyRentalRow, cause: LinkCause) {
    const current = selected.get(linkKey(row));
    if (current?.cause === cause) onChange(value.filter((l) => linkKey(l) !== linkKey(row)));
    else if (current) onChange(value.map((l) => (linkKey(l) === linkKey(row) ? { ...l, cause } : l)));
    else onChange([...value, { ...row, cause }]);
  }

  return (
    <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 12 }}>대여·반납 기록 연결 <span style={{ color: colors.dim, fontWeight: 500 }}>(선택)</span></strong>
        <span style={{ fontSize: 11, color: colors.dim, flex: 1, minWidth: 140 }}>어느 기록의 어느 물품 때문인지 남기면 랜딩의 페널티 상세에도 표시됩니다.</span>
        <button
          type="button"
          onClick={fetchRows}
          disabled={!name.trim() || loading}
          style={{ background: "transparent", color: colors.accent, border: `1px solid ${colors.accent}66`, borderRadius: 7, padding: "5px 10px", fontSize: 11.5, fontWeight: 800, cursor: !name.trim() || loading ? "not-allowed" : "pointer", opacity: !name.trim() ? 0.5 : 1 }}
        >
          {loading ? "불러오는 중…" : loadedFor ? "다시 불러오기" : "이 사람의 기록 불러오기"}
        </button>
      </div>
      {!name.trim() ? <div style={{ fontSize: 11.5, color: colors.dim }}>위에서 이름(또는 4자리 사번)을 먼저 입력하세요.</div> : null}
      {error ? <div style={{ fontSize: 11.5, color: "#ef4444" }}>{error}</div> : null}
      {loadedFor && !candidates.length && !error ? <div style={{ fontSize: 11.5, color: colors.dim }}>'{loadedFor}'의 대여 기록이 없습니다.</div> : null}
      {rows.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
          {rows.map((row) => {
            const current = selected.get(linkKey(row));
            return (
              <div key={linkKey(row)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 8, background: current ? `${CAUSE_COLOR[current.cause]}14` : colors.input, border: `1px solid ${current ? CAUSE_COLOR[current.cause] + "88" : colors.border}` }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 800, overflowWrap: "anywhere" }}>{rentalTitle(row)}</div>
                  <div style={{ fontSize: 11, color: colors.dim }}>{rentalMeta(row)}</div>
                </div>
                <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                  {(["rental", "return"] as LinkCause[]).map((cause) => {
                    const on = current?.cause === cause;
                    return (
                      <button
                        key={cause}
                        type="button"
                        onClick={() => pick(row, cause)}
                        aria-pressed={on}
                        style={{ padding: "5px 9px", borderRadius: 7, fontSize: 11.5, fontWeight: 800, cursor: "pointer", border: `1px solid ${CAUSE_COLOR[cause]}${on ? "" : "66"}`, background: on ? CAUSE_COLOR[cause] : "transparent", color: on ? "#fff" : CAUSE_COLOR[cause] }}
                      >
                        {CAUSE_LABEL[cause]}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {value.length ? <div style={{ fontSize: 11.5, color: colors.dim }}>{value.length}건 연결됨</div> : null}
    </div>
  );
}

interface SidSummary {
  sid: string;
  instructionKo: string;
  objectCount: number;
}

interface SidObjectRow {
  objectId: string;
  objectName: string;
  quantity: number | "";
}

interface SidDetail {
  sid: string;
  found: boolean;
  instructionEn: string;
  instructionKo: string;
  objects: SidObjectRow[];
}

function adminHeaders(): HeadersInit {
  return tokenHeaders({ "Content-Type": "application/json" });
}

async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: adminHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `요청 실패 (HTTP ${res.status})`);
  return data;
}

export default function AdminConnectionSettings({
  onClose, embedded, isLightMode, showToast,
  initialTab = "admins", visibleTabs, showHeader = true, showTabs = true,
}: AdminConnectionSettingsProps) {
  const [tab, setTab] = useState<Tab>(initialTab);

  const TEXT_MAIN = isLightMode ? "#0f172a" : "#f1f5f9";
  const TEXT_DIM = isLightMode ? "#64748b" : "#94a3b8";
  const PANEL_BG = isLightMode ? "#ffffff" : "#1e293b";
  const INPUT_BG = isLightMode ? "#f8fafc" : "#0f172a";
  const BORDER_COLOR = isLightMode ? "#e2e8f0" : "#334155";
  const ACCENT = "#2563eb";

  // ── Admin users ──
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [newAdmin, setNewAdmin] = useState({ loginId: "", password: "", name: "" });

  // ── WMS 대여자 계정(사번 명부) ──
  const [borrowers, setBorrowers] = useState<RegisteredUser[]>([]);
  const [newBorrower, setNewBorrower] = useState({ name: "", employeeId: "" });
  const [editingBorrowerId, setEditingBorrowerId] = useState<string | null>(null);
  const [editBorrowerName, setEditBorrowerName] = useState("");
  const [borrowerSearch, setBorrowerSearch] = useState("");

  // ── 가입 신청 ──
  const [signups, setSignups] = useState<SignupRequest[]>([]);
  const [signupNames, setSignupNames] = useState<Record<number, string>>({});
  const [signupBusy, setSignupBusy] = useState<number | null>(null);
  // 관리자 계정 가입 신청(로그인 화면에서 Scenario Manager 계정으로 신청한 것)
  const [adminSignups, setAdminSignups] = useState<AdminSignupRequest[]>([]);
  const [adminSignupNames, setAdminSignupNames] = useState<Record<number, string>>({});
  const [adminSignupBusy, setAdminSignupBusy] = useState<number | null>(null);

  // ── Penalties ──
  const [penalties, setPenalties] = useState<Penalty[]>([]);
  const [newPenalty, setNewPenalty] = useState({ name: "", maxTypes: "", reason: "", expiresAt: "" });
  // 새 페널티의 원인으로 연결할 대여·반납 기록
  const [newPenaltyLinks, setNewPenaltyLinks] = useState<PenaltyLink[]>([]);
  // 이미 등록된 페널티의 연결을 고치는 중인 것
  const [editLinks, setEditLinks] = useState<{ id: number; links: PenaltyLink[] } | null>(null);
  const [savingLinks, setSavingLinks] = useState(false);
  const [openPenaltyId, setOpenPenaltyId] = useState<number | null>(null);
  const [penaltyDetails, setPenaltyDetails] = useState<Record<number, PenaltyDetailState>>({});

  // ── SID(시나리오) 편집 ──
  const [sidList, setSidList] = useState<SidSummary[]>([]);
  const [sidListLoaded, setSidListLoaded] = useState(false);
  const [sidSearch, setSidSearch] = useState("");
  const [newSidInput, setNewSidInput] = useState("");
  const [selectedSid, setSelectedSid] = useState<string | null>(null);
  const [sidDetail, setSidDetail] = useState<SidDetail | null>(null);
  const [sidDetailLoading, setSidDetailLoading] = useState(false);
  const [sidSaving, setSidSaving] = useState(false);
  // 오브젝트 추가용 카탈로그(시나리오 물품 전체) — SID 편집 탭을 처음 열 때 한 번만 불러온다.
  const [objCatalog, setObjCatalog] = useState<ScenarioObjectAdmin[]>([]);
  const [objCatalogLoaded, setObjCatalogLoaded] = useState(false);
  const [objSearch, setObjSearch] = useState("");

  // ── xlsx import ──
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importSummary, setImportSummary] = useState<any>(null);

  useEffect(() => {
    refreshSignups();
    refreshAdminSignups();
    refreshAdmins();
    refreshBorrowers();
    refreshPenalties();
  }, []); // eslint-disable-line

  function refreshAdmins() {
    api("GET", "/api/admin/users")
      .then((data) => setAdmins(data.users || []))
      .catch((err) => showToast("관리자 목록 불러오기 실패: " + err.message, "error"));
  }

  function refreshSignups() {
    api("GET", "/api/admin/signup-requests")
      .then((data) => {
        const list: SignupRequest[] = data.requests || [];
        setSignups(list);
        setSignupNames(Object.fromEntries(list.map((r) => [r.id, r.name])));
      })
      .catch((err) => showToast("가입 신청 목록 불러오기 실패: " + err.message, "error"));
  }

  function refreshAdminSignups() {
    api("GET", "/api/admin/admin-signup-requests")
      .then((data) => {
        const list: AdminSignupRequest[] = data.requests || [];
        setAdminSignups(list);
        setAdminSignupNames(Object.fromEntries(list.map((r) => [r.id, r.name])));
      })
      .catch((err) => showToast("관리자 가입 신청 목록 불러오기 실패: " + err.message, "error"));
  }

  async function resolveAdminSignup(req: AdminSignupRequest, action: "approve" | "reject") {
    const name = (adminSignupNames[req.id] || "").trim();
    if (action === "approve" && !name) { showToast("이름을 입력해 주세요.", "warn"); return; }
    const question = action === "approve"
      ? `'${req.login_id}' 계정을 관리자로 승인할까요?\n승인하면 재고 수정, 계정 관리 등 모든 관리자 기능을 쓸 수 있습니다.`
      : `관리자 신청 '${req.login_id}' · ${req.name} 을(를) 거절할까요?`;
    if (!window.confirm(question)) return;
    setAdminSignupBusy(req.id);
    try {
      await api("POST", `/api/admin/admin-signup-requests/${req.id}/${action}`, action === "approve" ? { name } : {});
      showToast(action === "approve" ? `${req.login_id} 님을 관리자로 등록했습니다.` : "신청을 거절했습니다.", action === "approve" ? "ok" : "info");
      refreshAdminSignups();
      if (action === "approve") refreshAdmins();
      window.dispatchEvent(new Event("wms-signups-changed"));
    } catch (err: any) {
      showToast((action === "approve" ? "승인 실패: " : "거절 실패: ") + err.message, "error");
    } finally {
      setAdminSignupBusy(null);
    }
  }

  async function resolveSignup(req: SignupRequest, action: "approve" | "reject") {
    const name = (signupNames[req.id] || "").trim();
    if (action === "approve" && !name) { showToast("이름을 입력해 주세요.", "warn"); return; }
    if (action === "reject" && !window.confirm(`사번 ${req.employee_id} · ${req.name} 신청을 거절할까요?`)) return;
    setSignupBusy(req.id);
    try {
      await api("POST", `/api/admin/signup-requests/${req.id}/${action}`, action === "approve" ? { name } : {});
      showToast(action === "approve" ? `${name}(${req.employee_id}) 님을 대여자로 등록했습니다.` : "신청을 거절했습니다.", action === "approve" ? "ok" : "info");
      refreshSignups();
      if (action === "approve") refreshBorrowers();
      window.dispatchEvent(new Event("wms-signups-changed"));
    } catch (err: any) {
      showToast((action === "approve" ? "승인 실패: " : "거절 실패: ") + err.message, "error");
    } finally {
      setSignupBusy(null);
    }
  }

  function refreshBorrowers() {
    api("GET", "/api/registered-users")
      .then((data) => setBorrowers(data.users || []))
      .catch((err) => showToast("대여자 계정 목록 불러오기 실패: " + err.message, "error"));
  }

  async function addBorrower() {
    if (!/^\d{4}$/.test(newBorrower.employeeId) || newBorrower.employeeId === "0000") {
      showToast("사번은 0000을 제외한 4자리 숫자로 입력해 주세요.", "warn");
      return;
    }
    if (!newBorrower.name.trim()) {
      showToast("이름을 입력해 주세요.", "warn");
      return;
    }
    try {
      await api("POST", "/api/registered-users", newBorrower);
      setNewBorrower({ name: "", employeeId: "" });
      refreshBorrowers();
      showToast("대여자 계정이 등록되었습니다.", "ok");
    } catch (err: any) {
      showToast("등록 실패: " + err.message, "error");
    }
  }

  function startEditBorrower(user: RegisteredUser) {
    setEditingBorrowerId(user.employee_id);
    setEditBorrowerName(user.name || "");
  }

  async function saveEditBorrower(employeeId: string) {
    if (!editBorrowerName.trim()) {
      showToast("이름을 입력해 주세요.", "warn");
      return;
    }
    try {
      await api("PUT", `/api/registered-users/${encodeURIComponent(employeeId)}`, { name: editBorrowerName });
      setEditingBorrowerId(null);
      refreshBorrowers();
      showToast("수정되었습니다.", "ok");
    } catch (err: any) {
      showToast("수정 실패: " + err.message, "error");
    }
  }

  async function deleteBorrower(employeeId: string) {
    if (!window.confirm("이 대여자 계정을 삭제하시겠습니까? 기존 대여·반납 기록은 유지됩니다.")) return;
    try {
      await api("DELETE", `/api/registered-users/${encodeURIComponent(employeeId)}`);
      refreshBorrowers();
      showToast("삭제되었습니다.", "info");
    } catch (err: any) {
      showToast("삭제 실패: " + err.message, "error");
    }
  }

  const loadPenaltyRentals = (name: string): Promise<PenaltyRentalRow[]> =>
    api("GET", `/api/penalties/rentals?name=${encodeURIComponent(name)}`).then((data) => data.rows || []);

  const toLinkPayload = (links: PenaltyLink[]) => links.map((l) => ({ sheetType: l.sheetType, rowId: l.rowId, cause: l.cause }));

  async function saveEditedLinks() {
    if (!editLinks) return;
    setSavingLinks(true);
    try {
      const data = await api("PUT", `/api/penalties/${editLinks.id}/links`, { links: toLinkPayload(editLinks.links) });
      setPenaltyDetails((current) => {
        const prev = current[editLinks.id];
        const events = prev && "events" in prev ? prev.events : [];
        return { ...current, [editLinks.id]: { events, links: data.links || [] } };
      });
      setEditLinks(null);
      refreshPenalties();
      showToast("연결된 기록을 저장했습니다.", "ok");
    } catch (err: any) {
      showToast("연결 저장 실패: " + err.message, "error");
    } finally {
      setSavingLinks(false);
    }
  }

  function refreshPenalties() {
    api("GET", "/api/penalties")
      .then((data) => setPenalties(data.penalties || []))
      .catch((err) => showToast("페널티 목록 불러오기 실패: " + err.message, "error"));
  }

  // 펼칠 때마다 다시 불러온다 — 그사이 반납되면 결과가 달라진다.
  function togglePenalty(id: number) {
    if (openPenaltyId === id) { setOpenPenaltyId(null); return; }
    setOpenPenaltyId(id);
    setPenaltyDetails((current) => (current[id] && !("error" in current[id]) ? current : { ...current, [id]: { loading: true } }));
    api("GET", `/api/penalties/${id}/details`)
      .then((data) => setPenaltyDetails((current) => ({ ...current, [id]: { events: data.events || [], links: data.links || [] } })))
      .catch((err) => setPenaltyDetails((current) => ({ ...current, [id]: { error: err.message } })));
  }

  function renderPenaltyDetail(state: PenaltyDetailState | undefined) {
    if (!state || "loading" in state) return <div style={{ color: TEXT_DIM }}>불러오는 중…</div>;
    if ("error" in state) return <div style={{ color: "#ef4444" }}>상세를 불러오지 못했습니다: {state.error}</div>;
    if (!state.events.length) return <div style={{ color: TEXT_DIM }}>직접 등록한 페널티라 자동으로 연결된 대여 기록은 없습니다.</div>;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {state.events.map((event, n) => {
          const pickup = event.eventType === "pickup_unconfirmed_4h";
          return (
            <div key={n} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ lineHeight: 1.6 }}>
                <div>
                  <strong style={{ color: "#ef4444" }}>{event.label}</strong>
                  {event.requestCode ? ` · 신청 ${event.requestCode}` : ""} · {event.borrowerName}{event.employeeId ? ` (${event.employeeId})` : ""}
                </div>
                <div style={{ color: TEXT_DIM }}>
                  {pickup ? "신청" : "대여 확인"} {shortTime(event.sourceAt)} → 기한 {shortTime(event.deadlineAt)} · 페널티 생성 {shortTime(event.occurredAt)}
                </div>
              </div>
              {event.items.map((item, i) => {
                // 이 페널티가 따지는 시각(대여 확인 또는 반납)만 기한을 넘겼으면 빨갛게 표시한다.
                const stamp = (label: string, value: string, judged: boolean, empty: string) => {
                  const late = judged && item.missed;
                  return (
                    <span style={{ display: "inline-flex", gap: 5, padding: "3px 8px", borderRadius: 6, background: late ? "rgba(239,68,68,.12)" : PANEL_BG, border: `1px solid ${late ? "rgba(239,68,68,.45)" : BORDER_COLOR}`, color: late ? "#ef4444" : TEXT_MAIN, fontWeight: late ? 700 : 500 }}>
                      <span style={{ color: late ? "#ef4444" : TEXT_DIM }}>{label}</span>{value || empty}
                    </span>
                  );
                };
                const result = !item.missed
                  ? item.exempt ? "장기 보관 물품 · 대상 아님" : "기한 내 처리"
                  : pickup
                    ? item.pickedUpAt ? `기한보다 ${overText(item.overMinutes)} 늦게 대여 확인` : "대여 확인 안 함 → 자동 취소"
                    : item.returnedAt ? `기한보다 ${overText(item.overMinutes)} 늦게 반납` : `아직 반납 안 함 · 기한 ${overText(item.overMinutes)} 지남`;
                return (
                  <div key={i} style={{ padding: "8px 10px", borderRadius: 8, background: PANEL_BG, border: `1px solid ${BORDER_COLOR}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <strong>{item.name} × {item.qty}</strong>
                      <span style={{ fontWeight: 700, color: item.missed ? "#ef4444" : item.exempt ? TEXT_DIM : "#16a34a" }}>{result}</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                      {stamp("신청", shortTime(item.appliedAt), false, "-")}
                      {stamp("대여 확인", shortTime(item.pickedUpAt), pickup, "안 함")}
                      {stamp("반납", item.returnedAt ? `${shortTime(item.returnedAt)} · ${item.state}` : "", !pickup, "아직 안 함")}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  /** 관리자가 원인으로 연결한 대여·반납 기록 + 수정 버튼. 상태는 지금 기록에서 읽은 값이다. */
  function renderPenaltyLinks(p: Penalty, state: PenaltyDetailState | undefined) {
    if (!state || "loading" in state || "error" in state) return null;
    const editing = editLinks?.id === p.id;
    return (
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${BORDER_COLOR}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <strong style={{ fontSize: 12 }}>원인 기록 (대여·반납 로그 연결)</strong>
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditLinks({ id: p.id, links: state.links })}
              style={{ marginLeft: "auto", background: "transparent", color: ACCENT, border: `1px solid ${ACCENT}66`, borderRadius: 7, padding: "4px 10px", fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}
            >
              {state.links.length ? "연결 수정" : "기록 연결"}
            </button>
          ) : null}
        </div>
        {editing && editLinks ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <PenaltyLinkPicker
              name={p.name || ""}
              value={editLinks.links}
              onChange={(links) => setEditLinks({ id: p.id, links })}
              colors={{ text: TEXT_MAIN, dim: TEXT_DIM, border: BORDER_COLOR, panel: PANEL_BG, input: INPUT_BG, accent: ACCENT }}
              load={loadPenaltyRentals}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" onClick={saveEditedLinks} disabled={savingLinks} style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: 800, cursor: savingLinks ? "wait" : "pointer", opacity: savingLinks ? 0.6 : 1 }}>
                {savingLinks ? "저장 중…" : "저장"}
              </button>
              <button type="button" onClick={() => setEditLinks(null)} disabled={savingLinks} style={{ background: "transparent", color: TEXT_DIM, border: `1px solid ${BORDER_COLOR}`, borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                취소
              </button>
            </div>
          </div>
        ) : state.links.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {state.links.map((l) => (
              <div key={linkKey(l)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: PANEL_BG, border: `1px solid ${BORDER_COLOR}` }}>
                <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 999, color: "#fff", background: CAUSE_COLOR[l.cause] }}>{CAUSE_LABEL[l.cause]}</span>
                <div style={{ minWidth: 0, lineHeight: 1.5 }}>
                  <div style={{ fontWeight: 800, overflowWrap: "anywhere" }}>{rentalTitle(l)}</div>
                  <div style={{ fontSize: 11, color: TEXT_DIM }}>{rentalMeta(l)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: TEXT_DIM }}>연결된 기록이 없습니다. 사유 글만 남아 있습니다.</div>
        )}
      </div>
    );
  }

  // SID 탭을 처음 열 때만 불러온다(설정 화면 진입 시마다 6천 행짜리 조회를 미리 하지 않도록).
  useEffect(() => {
    if (tab !== "scenarios") return;
    if (!sidListLoaded) {
      api("GET", "/api/scenarios")
        .then((data) => { setSidList(data.sids || []); setSidListLoaded(true); })
        .catch((err) => showToast("SID 목록 불러오기 실패: " + err.message, "error"));
    }
    if (!objCatalogLoaded) {
      fetchScenarioObjectsForAdmin(GAS_URL)
        .then((items) => { setObjCatalog(items); setObjCatalogLoaded(true); })
        .catch((err) => showToast("시나리오 물품 카탈로그를 불러오지 못했습니다: " + err.message, "error"));
    }
  }, [tab, sidListLoaded, objCatalogLoaded]); // eslint-disable-line

  const filteredSidList = sidList.filter((s) => smartMatch([s.sid, s.instructionKo], sidSearch));
  const filteredBorrowers = borrowerSearch.trim()
    ? borrowers.filter((user) => smartMatch([user.name, user.employee_id], borrowerSearch))
    : borrowers;
  const filteredObjCatalog = objSearch.trim()
    ? objCatalog.filter((o) => smartMatch([o.id, o.name], objSearch)).slice(0, 8)
    : [];

  function openSid(sid: string) {
    setSelectedSid(sid);
    setSidDetail(null);
    setObjSearch("");
    setSidDetailLoading(true);
    api("GET", `/api/scenarios/${encodeURIComponent(sid)}`)
      .then((data) => setSidDetail({
        sid: data.sid || sid,
        found: !!data.found,
        instructionEn: data.instructionEn || "",
        instructionKo: data.instructionKo || "",
        objects: (data.objects || []).map((o: any) => ({ objectId: o.objectId, objectName: o.objectName, quantity: o.quantity })),
      }))
      .catch((err) => { showToast("SID 정보를 불러오지 못했습니다: " + err.message, "error"); setSelectedSid(null); })
      .finally(() => setSidDetailLoading(false));
  }

  function openNewSid() {
    const sid = newSidInput.trim();
    if (!sid) { showToast("SID를 입력해 주세요.", "warn"); return; }
    setSelectedSid(sid);
    setSidDetail({ sid, found: false, instructionEn: "", instructionKo: "", objects: [] });
    setNewSidInput("");
    setObjSearch("");
  }

  function closeSidEditor() {
    setSelectedSid(null);
    setSidDetail(null);
  }

  function updateSidObjectQty(idx: number, raw: string) {
    if (!sidDetail) return;
    const n = Number(raw);
    setSidDetail({
      ...sidDetail,
      objects: sidDetail.objects.map((o, i) => (i === idx ? { ...o, quantity: raw === "" ? "" : (Number.isFinite(n) ? n : o.quantity) } : o)),
    });
  }

  function removeSidObject(idx: number) {
    if (!sidDetail) return;
    setSidDetail({ ...sidDetail, objects: sidDetail.objects.filter((_, i) => i !== idx) });
  }

  function addSidObject(obj: ScenarioObjectAdmin) {
    if (!sidDetail) return;
    if (sidDetail.objects.some((o) => o.objectId === obj.id)) { showToast("이미 추가된 오브젝트입니다.", "warn"); return; }
    setSidDetail({ ...sidDetail, objects: [...sidDetail.objects, { objectId: obj.id, objectName: obj.name, quantity: 1 }] });
    setObjSearch("");
  }

  async function saveSidDetail() {
    if (!sidDetail || !selectedSid) return;
    for (const o of sidDetail.objects) {
      if (!Number(o.quantity) || Number(o.quantity) <= 0) {
        showToast(`"${o.objectName}"의 수량을 확인해 주세요.`, "warn");
        return;
      }
    }
    setSidSaving(true);
    try {
      await api("PUT", `/api/scenarios/${encodeURIComponent(selectedSid)}`, {
        instructionEn: sidDetail.instructionEn,
        instructionKo: sidDetail.instructionKo,
        objects: sidDetail.objects.map((o) => ({ objectId: o.objectId, quantity: Number(o.quantity) })),
      });
      showToast(`${selectedSid} 저장되었습니다.`, "ok");
      setSidListLoaded(false); // 목록으로 돌아가면 개수/안내문이 최신으로 다시 불러와지도록
      closeSidEditor();
    } catch (err: any) {
      showToast("저장 실패: " + err.message, "error");
    } finally {
      setSidSaving(false);
    }
  }

  async function deleteSid() {
    if (!selectedSid) return;
    if (!window.confirm(`${selectedSid}의 오브젝트 요구사항을 전부 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
    try {
      await api("DELETE", `/api/scenarios/${encodeURIComponent(selectedSid)}`);
      showToast(`${selectedSid} 삭제되었습니다.`, "info");
      setSidListLoaded(false);
      closeSidEditor();
    } catch (err: any) {
      showToast("삭제 실패: " + err.message, "error");
    }
  }

  async function addAdmin() {
    if (!newAdmin.loginId.trim() || !newAdmin.password.trim()) {
      showToast("아이디와 비밀번호를 입력해 주세요.", "warn");
      return;
    }
    try {
      await api("POST", "/api/admin/users", newAdmin);
      setNewAdmin({ loginId: "", password: "", name: "" });
      refreshAdmins();
      showToast("관리자 계정이 추가되었습니다.", "ok");
    } catch (err: any) {
      showToast("관리자 추가 실패: " + err.message, "error");
    }
  }

  async function deleteAdmin(id: number) {
    if (!window.confirm("이 관리자 계정을 삭제하시겠습니까?")) return;
    try {
      await api("DELETE", `/api/admin/users/${id}`);
      refreshAdmins();
      showToast("관리자 계정이 삭제되었습니다.", "info");
    } catch (err: any) {
      showToast("삭제 실패: " + err.message, "error");
    }
  }

  async function addPenalty() {
    if (!newPenalty.name.trim()) {
      showToast("이름을 입력해 주세요.", "warn");
      return;
    }
    try {
      await api("POST", "/api/penalties", {
        name: newPenalty.name.trim(),
        maxTypes: newPenalty.maxTypes ? Number(newPenalty.maxTypes) : null,
        reason: newPenalty.reason.trim(),
        expiresAt: newPenalty.expiresAt.trim(),
        links: toLinkPayload(newPenaltyLinks),
      });
      setNewPenalty({ name: "", maxTypes: "", reason: "", expiresAt: "" });
      setNewPenaltyLinks([]);
      refreshPenalties();
      showToast("페널티가 등록되었습니다.", "ok");
    } catch (err: any) {
      showToast("페널티 등록 실패: " + err.message, "error");
    }
  }

  async function deletePenalty(id: number) {
    if (!window.confirm("이 페널티를 삭제하시겠습니까?")) return;
    try {
      await api("DELETE", `/api/penalties/${id}`);
      refreshPenalties();
      showToast("페널티가 삭제되었습니다.", "info");
    } catch (err: any) {
      showToast("삭제 실패: " + err.message, "error");
    }
  }

  async function runImport() {
    if (!importFile) {
      showToast("xlsx 파일을 선택해 주세요.", "warn");
      return;
    }
    if (!window.confirm("xlsx 파일과 현재 데이터를 비교해 달라진 내용만 반영합니다. 계속하시겠습니까?")) return;
    setImporting(true);
    setImportSummary(null);
    try {
      const form = new FormData();
      form.append("file", importFile);
      const res = await fetch("/api/admin/import-xlsx", { method: "POST", headers: tokenHeaders(), body: form });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "임포트 실패");
      setImportSummary(data.summary);
      showToast("xlsx 임포트가 완료되었습니다. 새로고침하면 최신 데이터가 반영됩니다.", "ok");
    } catch (err: any) {
      showToast("xlsx 임포트 실패: " + err.message, "error");
    } finally {
      setImporting(false);
    }
  }

  async function runExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/admin/export-xlsx", { headers: tokenHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `출력 실패 (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "wms-db.xlsx";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("현재 DB를 xlsx 파일로 출력했습니다.", "ok");
    } catch (err: any) {
      showToast("xlsx 출력 실패: " + err.message, "error");
    } finally {
      setExporting(false);
    }
  }

  const allTabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: "signups", label: signups.length + adminSignups.length ? `가입 승인 (${signups.length + adminSignups.length})` : "가입 승인", icon: <UserCheck size={14} /> },
    { key: "admins", label: "Admin 계정", icon: <Users size={14} /> },
    { key: "borrowers", label: "대여자 계정", icon: <Users size={14} /> },
    { key: "penalties", label: "페널티", icon: <ShieldAlert size={14} /> },
    { key: "scenarios", label: "SID 편집", icon: <ScrollText size={14} /> },
    { key: "import", label: "xlsx 입력/추출", icon: <FileSpreadsheet size={14} /> },
  ];
  const tabs = visibleTabs ? allTabs.filter((t) => visibleTabs.includes(t.key)) : allTabs;

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: INPUT_BG,
    border: `1px solid ${BORDER_COLOR}`,
    borderRadius: 8,
    padding: "8px 10px",
    color: TEXT_MAIN,
    fontSize: 13,
    outline: "none",
  };
  const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: TEXT_DIM, marginBottom: 4, display: "block" };

  return (
    <div
      onClick={embedded ? undefined : onClose}
      style={embedded ? undefined : { position: "fixed", inset: 0, zIndex: 4000, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
        style={
          embedded
            ? { width: "100%", maxWidth: 760, color: TEXT_MAIN }
            : { width: "100%", maxWidth: 640, maxHeight: "88vh", overflowY: "auto", background: PANEL_BG, border: `1px solid ${BORDER_COLOR}`, borderRadius: 20, padding: 28, color: TEXT_MAIN }
        }
      >
        {showHeader && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800 }}>연결 설정</h2>
          {!embedded && (
            <button onClick={onClose} style={{ background: "transparent", border: "none", color: TEXT_DIM, cursor: "pointer" }}>
              <X size={20} />
            </button>
          )}
        </div>}

        {showTabs && <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: tab === t.key ? ACCENT : "transparent",
                color: tab === t.key ? "#fff" : TEXT_DIM,
                border: `1px solid ${tab === t.key ? ACCENT : BORDER_COLOR}`,
              }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>}

        {tab === "signups" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.6 }}>
              대여자 로그인 화면에서 들어온 가입 신청입니다. 사번과 이름을 확인하고 승인하면 대여자 계정에 등록되어 바로 로그인할 수 있습니다. 이름에 오타가 있으면 고친 뒤 승인하세요.
            </p>
            {signups.map((r) => (
              <div key={r.id} style={{ padding: "12px 14px", border: `1px solid ${BORDER_COLOR}`, borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 800, color: ACCENT }}>사번 {r.employee_id}</span>
                  <input
                    style={{ ...inputStyle, flex: "1 1 160px", width: "auto", fontSize: 14, fontWeight: 700 }}
                    value={signupNames[r.id] ?? r.name}
                    onChange={(e) => setSignupNames((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  />
                  <button
                    onClick={() => resolveSignup(r, "approve")}
                    disabled={signupBusy === r.id}
                    style={{ display: "flex", alignItems: "center", gap: 5, background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", opacity: signupBusy === r.id ? 0.6 : 1 }}
                  >
                    <Check size={14} /> 승인
                  </button>
                  <button
                    onClick={() => resolveSignup(r, "reject")}
                    disabled={signupBusy === r.id}
                    style={{ background: "transparent", color: "#ef4444", border: `1px solid #ef444466`, borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}
                  >
                    거절
                  </button>
                </div>
                <div style={{ fontSize: 11, color: TEXT_DIM }}>
                  신청 {r.created_at}
                  {r.previousName ? <span style={{ color: "#d97706", fontWeight: 700 }}> · 예전에 삭제한 사번입니다(당시 이름: {r.previousName}). 승인하면 다시 살아납니다.</span> : null}
                </div>
              </div>
            ))}
            {signups.length === 0 && <div style={{ fontSize: 12, color: TEXT_DIM }}>대기 중인 대여자 가입 신청이 없습니다.</div>}

            <div style={{ height: 1, background: BORDER_COLOR, margin: "6px 0" }} />
            <p style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.6 }}>
              <strong style={{ color: "#7c3aed" }}>관리자 가입 신청</strong> — 관리자 로그인 화면에서 Scenario Manager 계정의 아이디·비밀번호로 신청한 건입니다(두 계정이 같은 것은 서버가 확인했습니다). 승인하면 모든 관리자 기능을 쓰는 계정이 만들어지니, 아는 사람이 맞는지 확인한 뒤 승인하세요.
            </p>
            {adminSignups.map((r) => (
              <div key={r.id} style={{ padding: "12px 14px", border: `1px solid #7c3aed55`, borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 800, color: "#7c3aed" }}>{r.login_id}</span>
                  <input
                    style={{ ...inputStyle, flex: "1 1 160px", width: "auto", fontSize: 14, fontWeight: 700 }}
                    value={adminSignupNames[r.id] ?? r.name}
                    onChange={(e) => setAdminSignupNames((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  />
                  <button
                    onClick={() => resolveAdminSignup(r, "approve")}
                    disabled={adminSignupBusy === r.id}
                    style={{ display: "flex", alignItems: "center", gap: 5, background: "#16a34a", color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", opacity: adminSignupBusy === r.id ? 0.6 : 1 }}
                  >
                    <Check size={14} /> 승인
                  </button>
                  <button
                    onClick={() => resolveAdminSignup(r, "reject")}
                    disabled={adminSignupBusy === r.id}
                    style={{ background: "transparent", color: "#ef4444", border: `1px solid #ef444466`, borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}
                  >
                    거절
                  </button>
                </div>
                <div style={{ fontSize: 11, color: TEXT_DIM }}>신청 {r.created_at}</div>
              </div>
            ))}
            {adminSignups.length === 0 && <div style={{ fontSize: 12, color: TEXT_DIM }}>대기 중인 관리자 가입 신청이 없습니다.</div>}
          </div>
        )}

        {tab === "admins" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <input style={inputStyle} placeholder="아이디" value={newAdmin.loginId} onChange={(e) => setNewAdmin({ ...newAdmin, loginId: e.target.value })} />
              <input style={inputStyle} placeholder="비밀번호" type="password" value={newAdmin.password} onChange={(e) => setNewAdmin({ ...newAdmin, password: e.target.value })} />
              <input style={inputStyle} placeholder="이름" value={newAdmin.name} onChange={(e) => setNewAdmin({ ...newAdmin, name: e.target.value })} />
            </div>
            <button
              onClick={addAdmin}
              style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, background: ACCENT, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >
              <Plus size={14} /> 계정 추가
            </button>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {admins.map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", border: `1px solid ${BORDER_COLOR}`, borderRadius: 8, fontSize: 12 }}>
                  <span>
                    <strong>{a.loginId}</strong> {a.name ? `· ${a.name}` : ""}
                  </span>
                  <button onClick={() => deleteAdmin(a.id)} style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer" }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {admins.length === 0 && <div style={{ fontSize: 12, color: TEXT_DIM }}>등록된 관리자 계정이 없습니다.</div>}
            </div>
          </div>
        )}

        {tab === "borrowers" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.6 }}>
              WMS에 로그인하고 대여·양도를 받을 수 있는 사용자를 관리합니다. 이름과 4자리 사번을 직접 추가할 수 있습니다.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input style={inputStyle} placeholder="이름" value={newBorrower.name} onChange={(e) => setNewBorrower({ ...newBorrower, name: e.target.value })} />
              <input style={inputStyle} placeholder="사번 (4자리)" inputMode="numeric" maxLength={4} value={newBorrower.employeeId} onChange={(e) => setNewBorrower({ ...newBorrower, employeeId: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
            </div>
            <button
              onClick={addBorrower}
              style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, background: ACCENT, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >
              <Plus size={14} /> 대여자 추가
            </button>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: TEXT_DIM }} />
              <input style={{ ...inputStyle, paddingLeft: 34 }} placeholder="이름 또는 사번 검색" value={borrowerSearch} onChange={(e) => setBorrowerSearch(e.target.value)} />
            </div>
            <div style={{ fontSize: 11, color: TEXT_DIM }}>등록된 대여자 {borrowers.length}명</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {filteredBorrowers.map((user) => (
                <div key={user.employee_id} style={{ padding: "8px 12px", border: `1px solid ${BORDER_COLOR}`, borderRadius: 8, fontSize: 12 }}>
                  {editingBorrowerId === user.employee_id ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 8 }}>
                        <input style={{ ...inputStyle, color: TEXT_DIM }} value={user.employee_id} disabled />
                        <input style={inputStyle} placeholder="이름" value={editBorrowerName} onChange={(e) => setEditBorrowerName(e.target.value)} />
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => saveEditBorrower(user.employee_id)} style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>저장</button>
                        <button onClick={() => setEditingBorrowerId(null)} style={{ background: "transparent", border: `1px solid ${BORDER_COLOR}`, color: TEXT_DIM, borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>취소</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>
                        <strong>{user.name}</strong>
                        <span style={{ marginLeft: 6, fontWeight: 700, color: ACCENT, fontFamily: "monospace" }}>사번 {user.employee_id}</span>
                        {user.source === "signup" ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 800, color: "#16a34a", border: "1px solid #16a34a55", borderRadius: 999, padding: "1px 7px" }}>가입 승인</span> : null}
                      </span>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => startEditBorrower(user)} style={{ background: "transparent", border: "none", color: ACCENT, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>편집</button>
                        <button onClick={() => deleteBorrower(user.employee_id)} style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer" }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {filteredBorrowers.length === 0 && <div style={{ fontSize: 12, color: TEXT_DIM }}>표시할 대여자 계정이 없습니다.</div>}
            </div>
          </div>
        )}

        {tab === "penalties" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <input style={inputStyle} placeholder="이름" value={newPenalty.name} onChange={(e) => setNewPenalty({ ...newPenalty, name: e.target.value })} />
              <input style={inputStyle} placeholder="최대 종류" type="number" value={newPenalty.maxTypes} onChange={(e) => setNewPenalty({ ...newPenalty, maxTypes: e.target.value })} />
              <input style={inputStyle} placeholder="사유" value={newPenalty.reason} onChange={(e) => setNewPenalty({ ...newPenalty, reason: e.target.value })} />
              <input style={inputStyle} placeholder="만료일 (YYYY-MM-DD)" value={newPenalty.expiresAt} onChange={(e) => setNewPenalty({ ...newPenalty, expiresAt: e.target.value })} />
            </div>
            <PenaltyLinkPicker
              name={newPenalty.name}
              value={newPenaltyLinks}
              onChange={setNewPenaltyLinks}
              colors={{ text: TEXT_MAIN, dim: TEXT_DIM, border: BORDER_COLOR, panel: PANEL_BG, input: INPUT_BG, accent: ACCENT }}
              load={loadPenaltyRentals}
            />
            <button
              onClick={addPenalty}
              style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, background: ACCENT, color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
            >
              <Plus size={14} /> 페널티 등록
            </button>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {penalties.map((p) => {
                const open = openPenaltyId === p.id;
                return (
                  <div key={p.id} style={{ border: `1px solid ${open ? ACCENT : BORDER_COLOR}`, borderRadius: 8, fontSize: 12, overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px" }}>
                      <button
                        onClick={() => togglePenalty(p.id)}
                        aria-expanded={open}
                        title="어떤 대여 때문에 생긴 페널티인지 보기"
                        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, background: "transparent", border: 0, padding: 0, color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}
                      >
                        <ChevronRight size={14} style={{ flexShrink: 0, color: TEXT_DIM, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                        <span>
                          <strong>{p.name}</strong> · 최대 {p.max_types ?? "-"}종 · {p.reason || "-"} · 만료 {p.expires_at || "-"}
                          {p.link_count ? <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 800, color: ACCENT, border: `1px solid ${ACCENT}66`, borderRadius: 999, padding: "1px 7px" }}>기록 {p.link_count}건 연결</span> : null}
                        </span>
                      </button>
                      <button onClick={() => deletePenalty(p.id)} aria-label={`${p.name || ""} 페널티 삭제`} style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", flexShrink: 0 }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {open ? (
                      <div style={{ borderTop: `1px solid ${BORDER_COLOR}`, background: INPUT_BG, padding: "10px 12px 12px" }}>
                        {renderPenaltyDetail(penaltyDetails[p.id])}
                        {renderPenaltyLinks(p, penaltyDetails[p.id])}
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {penalties.length === 0 && <div style={{ fontSize: 12, color: TEXT_DIM }}>등록된 페널티가 없습니다.</div>}
            </div>
          </div>
        )}

        {tab === "scenarios" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {!selectedSid ? (
              <>
                <p style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.6, margin: 0 }}>
                  SID(시나리오)별로 요구되는 오브젝트 종류·수량을 여기서 직접 수정할 수 있습니다.
                  통합 시트를 다시 올리면 시트 값으로 덮어써지니, 시트에도 반영이 필요하면 함께 갱신해 주세요.
                </p>
                <div style={{ position: "relative" }}>
                  <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: TEXT_DIM }} />
                  <input
                    style={{ ...inputStyle, paddingLeft: 32 }}
                    placeholder="SID 또는 안내문으로 검색..."
                    value={sidSearch}
                    onChange={(e) => setSidSearch(e.target.value)}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    style={inputStyle}
                    placeholder="새 SID 추가 (예: S2000)"
                    value={newSidInput}
                    onChange={(e) => setNewSidInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") openNewSid(); }}
                  />
                  <button
                    onClick={openNewSid}
                    style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, background: ACCENT, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                  >
                    <Plus size={14} /> 새 SID
                  </button>
                </div>
                <div style={{ maxHeight: 340, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
                  {filteredSidList.map((s) => (
                    <div
                      key={s.sid}
                      onClick={() => openSid(s.sid)}
                      style={{ padding: "9px 12px", border: `1px solid ${BORDER_COLOR}`, borderRadius: 8, cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700 }}>
                        <span>{s.sid}</span>
                        <span style={{ fontWeight: 500, color: TEXT_DIM, fontSize: 11 }}>{s.objectCount}종</span>
                      </div>
                      {s.instructionKo ? (
                        <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.instructionKo}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {sidListLoaded && filteredSidList.length === 0 ? (
                    <div style={{ fontSize: 12, color: TEXT_DIM, textAlign: "center", padding: "20px 0" }}>검색 결과가 없습니다.</div>
                  ) : null}
                  {!sidListLoaded ? (
                    <div style={{ fontSize: 12, color: TEXT_DIM, textAlign: "center", padding: "20px 0" }}>불러오는 중...</div>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <button
                  onClick={closeSidEditor}
                  style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", color: TEXT_DIM, cursor: "pointer", fontSize: 12, fontWeight: 700, padding: 0 }}
                >
                  <ChevronLeft size={15} /> 목록으로
                </button>
                <div style={{ fontSize: 15, fontWeight: 800 }}>
                  {selectedSid}
                  {sidDetail && !sidDetail.found ? <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: "#f59e0b" }}>새 SID</span> : null}
                </div>
                {sidDetailLoading || !sidDetail ? (
                  <div style={{ fontSize: 12, color: TEXT_DIM, padding: "16px 0" }}>불러오는 중...</div>
                ) : (
                  <>
                    <div>
                      <label style={labelStyle}>안내문 (한글)</label>
                      <textarea
                        style={{ ...inputStyle, minHeight: 56, resize: "vertical", fontFamily: "inherit" }}
                        value={sidDetail.instructionKo}
                        onChange={(e) => setSidDetail({ ...sidDetail, instructionKo: e.target.value })}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>안내문 (영문)</label>
                      <textarea
                        style={{ ...inputStyle, minHeight: 56, resize: "vertical", fontFamily: "inherit" }}
                        value={sidDetail.instructionEn}
                        onChange={(e) => setSidDetail({ ...sidDetail, instructionEn: e.target.value })}
                      />
                    </div>

                    <div>
                      <label style={labelStyle}>필요 오브젝트 ({sidDetail.objects.length}종)</label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {sidDetail.objects.map((o, idx) => (
                          <div key={o.objectId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", border: `1px solid ${BORDER_COLOR}`, borderRadius: 8 }}>
                            <span style={{ flex: 1, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              [{o.objectId}] {o.objectName}
                            </span>
                            <input
                              type="number"
                              min={1}
                              value={o.quantity}
                              onChange={(e) => updateSidObjectQty(idx, e.target.value)}
                              style={{ ...inputStyle, width: 64, textAlign: "right" }}
                            />
                            <button onClick={() => removeSidObject(idx)} style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", flexShrink: 0 }}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                        {sidDetail.objects.length === 0 ? (
                          <div style={{ fontSize: 12, color: TEXT_DIM }}>등록된 오브젝트가 없습니다. 아래에서 검색해 추가해 주세요.</div>
                        ) : null}
                      </div>
                    </div>

                    <div style={{ position: "relative" }}>
                      <label style={labelStyle}>오브젝트 추가</label>
                      <input
                        style={inputStyle}
                        placeholder="물품명 또는 ID로 검색..."
                        value={objSearch}
                        onChange={(e) => setObjSearch(e.target.value)}
                      />
                      {filteredObjCatalog.length > 0 ? (
                        <div style={{ marginTop: 4, border: `1px solid ${BORDER_COLOR}`, borderRadius: 8, overflow: "hidden" }}>
                          {filteredObjCatalog.map((o) => (
                            <div
                              key={o.id}
                              onClick={() => addSidObject(o)}
                              style={{ padding: "8px 10px", fontSize: 12, cursor: "pointer", borderBottom: `1px solid ${BORDER_COLOR}` }}
                            >
                              [{o.id}] {o.name} {o.category ? `· ${o.category}` : ""}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {!objCatalogLoaded ? <div style={{ fontSize: 11, color: TEXT_DIM, marginTop: 4 }}>물품 카탈로그 불러오는 중...</div> : null}
                    </div>

                    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                      <button
                        onClick={saveSidDetail}
                        disabled={sidSaving}
                        style={{ display: "flex", alignItems: "center", gap: 6, background: ACCENT, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: sidSaving ? 0.6 : 1 }}
                      >
                        {sidSaving ? "저장 중..." : "저장"}
                      </button>
                      {sidDetail.found ? (
                        <button
                          onClick={deleteSid}
                          style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", color: "#ef4444", border: `1px solid #ef444455`, borderRadius: 8, padding: "9px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                        >
                          <Trash2 size={13} /> 이 SID 삭제
                        </button>
                      ) : null}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {tab === "import" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: INPUT_BG, border: `1px solid ${BORDER_COLOR}`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: TEXT_MAIN, marginBottom: 6 }}>DB → xlsx 추출</div>
              <p style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.6, marginBottom: 12 }}>
                현재 SQLite DB의 모든 테이블을 시트별로 나눈 xlsx 파일을 다운로드합니다.
              </p>
              <button
                onClick={runExport}
                disabled={exporting}
                style={{ display: "flex", alignItems: "center", gap: 6, background: ACCENT, color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: exporting ? "wait" : "pointer", opacity: exporting ? 0.6 : 1 }}
              >
                <Download size={14} /> {exporting ? "출력 중..." : "DB를 xlsx로 추출"}
              </button>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, color: TEXT_MAIN, marginTop: 4 }}>xlsx → DB 입력</div>
            <p style={{ fontSize: 12, color: TEXT_DIM, lineHeight: 1.6 }}>
              통합 시트 xlsx 파일을 업로드하면 <strong>기존 데이터와 비교해 달라진 내용만 갱신</strong>합니다(새 항목 추가 · 바뀐 값 수정). 앱에서 실시간으로 쌓인 대여/반납 기록이나 이미지, 시나리오 물품 속성(파손주의 등)은 지워지지 않습니다.
            </p>
            <label
              htmlFor="xlsx-import-file"
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
                border: `2px dashed ${importFile ? ACCENT : BORDER_COLOR}`, borderRadius: 14, padding: "28px 16px",
                background: INPUT_BG, cursor: "pointer", textAlign: "center",
              }}
            >
              <FileSpreadsheet size={28} color={importFile ? ACCENT : TEXT_DIM} />
              <span style={{ fontSize: 14, fontWeight: 700, color: importFile ? ACCENT : TEXT_MAIN }}>
                {importFile ? importFile.name : "xlsx 파일 선택"}
              </span>
              <span style={{ fontSize: 11, color: TEXT_DIM }}>{importFile ? "다른 파일을 선택하려면 다시 클릭하세요" : "클릭해서 통합 시트 파일을 선택하세요"}</span>
              <input
                id="xlsx-import-file"
                type="file"
                accept=".xlsx"
                onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                style={{ display: "none" }}
              />
            </label>
            <button
              onClick={runImport}
              disabled={importing}
              style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, background: "#f59e0b", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: importing ? 0.6 : 1 }}
            >
              <Upload size={14} /> {importing ? "입력 진행 중..." : "xlsx 입력 실행"}
            </button>
            {importing && (
              <div style={{ width: "100%", height: 6, borderRadius: 4, overflow: "hidden", background: INPUT_BG, border: `1px solid ${BORDER_COLOR}` }}>
                <div
                  style={{
                    width: "40%", height: "100%", borderRadius: 4, background: ACCENT,
                    animation: "wms-import-progress 1.1s ease-in-out infinite",
                  }}
                />
                <style>{`@keyframes wms-import-progress { 0% { margin-left: -40%; } 100% { margin-left: 100%; } }`}</style>
              </div>
            )}
            {importSummary && (
              <pre style={{ fontSize: 11, background: INPUT_BG, border: `1px solid ${BORDER_COLOR}`, borderRadius: 8, padding: 12, overflowX: "auto", color: TEXT_DIM }}>
                {JSON.stringify(importSummary, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
