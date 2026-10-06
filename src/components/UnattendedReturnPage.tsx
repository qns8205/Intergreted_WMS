import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Camera, CheckCircle2, IdCard, ImageOff, LockKeyhole, LogOut, MessageCircle, RotateCcw, Search, ShieldAlert, Wrench } from "lucide-react";
import CameraCaptureModal from "./CameraCaptureModal";
import { setAdminToken } from "../utils/adminAuth";
import { fetchSeatMap, SeatFloor } from "../utils/borrowApi";
import { BorrowedTool, fetchMyTools, ToolRequestReceipt } from "../utils/warehouseManualApi";
import { kioskPalette } from "../utils/kioskTheme";
import UnattendedToolBorrowForm from "./UnattendedToolBorrowForm";
import UnattendedToolReturnForm from "./UnattendedToolReturnForm";

type Item = {
  key: string; sheetType: "scenario" | "general"; rowIndex: number;
  borrowerName: string; employeeId: string; itemId: string; itemName: string;
  quantity: number; location: string; image?: string; pickedUp: boolean;
  variantId?: number | null; variantPending?: boolean;
};
type Mode = "return" | "pickup";
type Done =
  | { kind: "return"; qr?: string }
  | { kind: "pickup" }
  | { kind: "toolBorrow"; receipt: ToolRequestReceipt; floor: string }
  | { kind: "toolReturn"; items: { name: string; qty: number; pending: boolean }[] };
type NextAction = "return" | "pickup" | "toolBorrow" | "toolReturn";

// 아무것도 누르지 않은 채 이만큼 지나면 로그아웃한다. 마지막 몇 초는 화면에 미리 알린다.
const IDLE_LOGOUT_MS = 180_000;
const IDLE_WARN_SECONDS = 20;
const DONE_LOGOUT_SECONDS = 15;
// 담당자 부재 중 문제가 생기면 연락할 Slack 이름. 첫 화면에 띄운다.
const HELP_SLACK_NAME = "sungmin";

const DEV_DEMO_ENABLED = !!(import.meta as any).env?.DEV;
const DEV_DEMO_EMPLOYEE_ID = "9999";
const demoImage = (emoji: string, background: string) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360"><rect width="360" height="360" rx="48" fill="${background}"/><text x="180" y="210" text-anchor="middle" font-size="128">${emoji}</text></svg>`
)}`;
const DEV_DEMO_ITEMS: Item[] = [
  { key: "demo-return-1", sheetType: "scenario", rowIndex: -101, borrowerName: "테스트 사용자", employeeId: DEV_DEMO_EMPLOYEE_ID, itemId: "000101", itemName: "LED 조명 키트", quantity: 1, location: "A랙 · 1단", image: demoImage("💡", "#dbeafe"), pickedUp: true },
  { key: "demo-return-2", sheetType: "scenario", rowIndex: -102, borrowerName: "테스트 사용자", employeeId: DEV_DEMO_EMPLOYEE_ID, itemId: "000102", itemName: "무선 마이크 세트", quantity: 2, location: "A랙 · 2단", image: demoImage("🎤", "#ede9fe"), pickedUp: true },
  { key: "demo-return-3", sheetType: "general", rowIndex: -103, borrowerName: "테스트 사용자", employeeId: DEV_DEMO_EMPLOYEE_ID, itemId: "000103", itemName: "촬영용 삼각대", quantity: 1, location: "B랙 · 1단", image: demoImage("📐", "#dcfce7"), pickedUp: true },
  { key: "demo-return-4", sheetType: "general", rowIndex: -104, borrowerName: "테스트 사용자", employeeId: DEV_DEMO_EMPLOYEE_ID, itemId: "000104", itemName: "휴대용 모니터", quantity: 1, location: "B랙 · 3단", image: demoImage("🖥️", "#fee2e2"), pickedUp: true },
  { key: "demo-pickup-1", sheetType: "scenario", rowIndex: -105, borrowerName: "테스트 사용자", employeeId: DEV_DEMO_EMPLOYEE_ID, itemId: "000201", itemName: "DSLR 카메라", quantity: 1, location: "C랙 · 1단", image: demoImage("📷", "#fef3c7"), pickedUp: false },
  { key: "demo-pickup-2", sheetType: "general", rowIndex: -106, borrowerName: "테스트 사용자", employeeId: DEV_DEMO_EMPLOYEE_ID, itemId: "000202", itemName: "연장 케이블", quantity: 3, location: "C랙 · 2단", image: demoImage("🔌", "#cffafe"), pickedUp: false },
];

function ItemThumb({ item, C, size = 76 }: { item: Item; C: any; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.image]);
  return <div style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}`, background: C.bg, display: "grid", placeItems: "center" }}>
    {item.image && !failed ? <img src={item.image} alt={`${item.itemName} 사진`} loading="lazy" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} /> : <div style={{ display: "grid", justifyItems: "center", gap: 4, color: C.dim }}><ImageOff size={20} /><span style={{ fontSize: 9, fontWeight: 700 }}>사진 없음</span></div>}
  </div>;
}

const TOKEN_KEY = "wms_unattended_device";
const makeClientId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;

async function call(path: string, body?: unknown) {
  const response = await fetch(`/api/unattended/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-unattended-device": localStorage.getItem(TOKEN_KEY) || "" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

export default function UnattendedReturnPage({ onAdminExit, isLightMode, showToast }: {
  onAdminExit: (user: { id: string; name?: string }) => void; isLightMode: boolean;
  showToast: (message: string, type?: "info" | "ok" | "warn" | "error") => void;
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [borrowerName, setBorrowerName] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [mode, setMode] = useState<Mode>("return");
  const [actionSelected, setActionSelected] = useState(false);
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [damaged, setDamaged] = useState<Record<string, boolean>>({});
  const [damageReason, setDamageReason] = useState<Record<string, string>>({});
  const [damagePhoto, setDamagePhoto] = useState("");
  const [damageCamera, setDamageCamera] = useState(false);
  const [captureMode, setCaptureMode] = useState<Mode | null>(null);
  const [damageConfirm, setDamageConfirm] = useState(false);
  // "예/아니요"부터 먼저 묻는다 — 곧장 물품별 체크리스트를 보여주면 다들 안 보고
  // 넘겨버리는 경우가 많았다. "아니요"는 5초 뒤에야 고를 수 있고, "예"를 고르면
  // 기존과 같은 물품별 체크리스트(list 단계)로 넘어간다.
  const [damageStage, setDamageStage] = useState<"ask" | "list">("ask");
  const [returnConfirmCount, setReturnConfirmCount] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 공구(COS 물품) 대여·반납. 시나리오 물품과 달리 이름을 직접 적고 사진을 찍어 신청하므로 따로 둔다.
  const [toolScreen, setToolScreen] = useState<"borrow" | "return" | null>(null);
  const [myTools, setMyTools] = useState<BorrowedTool[]>([]);
  const [toolsError, setToolsError] = useState("");
  const [floors, setFloors] = useState<SeatFloor[]>([]);
  const [floorsLoaded, setFloorsLoaded] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  // 완료 화면의 "이어서 하기"는 남은 물품을 다시 불러온 뒤에 띄운다(방금 처리한 물품이 남아 보이지 않게).
  const [nextReady, setNextReady] = useState(false);
  const [logoutSeconds, setLogoutSeconds] = useState(DONE_LOGOUT_SECONDS);
  const [idleLeft, setIdleLeft] = useState<number | null>(null);
  const [adminLoginOpen, setAdminLoginOpen] = useState(false);
  const [adminLoginId, setAdminLoginId] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  const attempt = useRef(makeClientId());

  const C = kioskPalette(isLightMode);
  const hasScenarioItems = items.length > 0;
  const returnItems = useMemo(() => items.filter((item) => item.pickedUp), [items]);
  const pickupItems = useMemo(() => items.filter((item) => !item.pickedUp), [items]);
  const visibleItems = mode === "return" ? returnItems : pickupItems;
  const chosen = visibleItems.filter((item) => (selected[item.key] || 0) > 0);
  const hasDamage = chosen.some((item) => damaged[item.key]);

  function chooseMode(next: Mode) {
    setMode(next);
    setActionSelected(true);
    // 무인 처리에서는 편의성보다 실물 대조가 우선이다. 기본 선택은 두지 않고 사용자가
    // 실제 물품을 확인한 뒤 각 항목을 하나씩 직접 체크하게 한다.
    setSelected({}); setDamaged({}); setDamageReason({}); setDamagePhoto(""); setError("");
  }
  // 반납은 초록, 대여 확인은 파랑 — 업무 선택 카드와 같은 색으로 화면 전체에서 지금 뭘
  // 하고 있는지 한눈에 알아보게 한다.
  const modeAccent = C.accent;
  const modeAccentSoft = "rgba(37,224,189,.13)";
  const stepProgress = !loggedIn ? 18 : !actionSelected && !toolScreen ? 54 : 86;
  function returnToActionChoice() {
    setActionSelected(false);
    setSelected({}); setDamaged({}); setDamageReason({}); setDamagePhoto(""); setError("");
  }
  function openReturnConfirm() {
    setError("");
    setReturnConfirmCount(5);
    setDamageStage("ask");
    setDamageConfirm(true);
  }
  // 로그아웃할 때마다 바뀐다. 늦게 도착한 조회 결과가 다음 사람 화면에 섞이지 않게 한다.
  const sessionRef = useRef(0);
  async function refreshMyTools(id = employeeId) {
    const session = sessionRef.current;
    try { const tools = await fetchMyTools(id); if (session === sessionRef.current) { setMyTools(tools); setToolsError(""); } }
    catch (e: any) { if (session === sessionRef.current) setToolsError(e.message || "공구 대여 내역을 확인하지 못했습니다."); }
  }
  // 할 수 있는 일이 하나뿐이면 업무 선택 화면을 건너뛴다. 무인 처리에서는 실물 대조가 우선이라
  // 어떤 경우에도 미리 체크해 두지 않는다 — 실물을 보고 하나씩 직접 체크한다.
  function applyScenarioList(list: Item[]) {
    const returns = list.filter((item) => item.pickedUp);
    const pickups = list.filter((item) => !item.pickedUp);
    setItems(list); setMode(returns.length ? "return" : "pickup");
    setActionSelected((returns.length > 0) !== (pickups.length > 0));
    setSelected({}); setDamaged({}); setDamageReason({}); setDamagePhoto("");
  }
  // 한 가지를 끝낸 뒤 남은 일을 다시 불러온다. 실패하면 해당 "이어서 하기" 버튼만 숨긴다.
  async function refreshAfterDone() {
    const session = sessionRef.current;
    setNextReady(false);
    attempt.current = makeClientId();
    const list = await call("find-mine", { employeeId }).then((data) => (data.items || []) as Item[], () => [] as Item[]);
    await refreshMyTools();
    if (session !== sessionRef.current) return;
    applyScenarioList(list);
    setNextReady(true);
  }
  function openToolScreen(kind: "borrow" | "return") {
    setError(""); setToolScreen(kind);
    if (kind === "return" && !demoMode) void refreshMyTools();
  }
  function continueWith(next: NextAction) {
    setDone(null); setError("");
    if (next === "toolBorrow" || next === "toolReturn") openToolScreen(next === "toolBorrow" ? "borrow" : "return");
    else { setToolScreen(null); chooseMode(next); }
  }
  function logout() {
    sessionRef.current += 1;
    setToolScreen(null); setMyTools([]); setToolsError("");
    setEmployeeId(""); setBorrowerName(""); setLoggedIn(false); setItems([]); setSelected({}); setActionSelected(false);
    setDemoMode(false);
    setDamaged({}); setDamageReason({}); setDamagePhoto(""); setDamageConfirm(false); setDamageStage("ask");
    setCaptureMode(null); setProcessing(false); setReturnConfirmCount(0); setLogoutSeconds(DONE_LOGOUT_SECONDS); setError(""); setDone(null);
    setNextReady(false); setIdleLeft(null); attempt.current = makeClientId();
  }

  useEffect(() => {
    if (!done) return;
    setLogoutSeconds(DONE_LOGOUT_SECONDS);
    const id = window.setInterval(() => setLogoutSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearInterval(id);
  }, [done]);
  useEffect(() => { if (done && logoutSeconds === 0) logout(); }, [done, logoutSeconds]);
  useEffect(() => {
    // 조회에 실패해도 막지 않는다. 층 목록이 비어 있으면 신청 폼이 층을 직접 입력받는다.
    fetchSeatMap("/api/gas").then((m) => setFloors(m.floors || [])).catch(() => {}).finally(() => setFloorsLoaded(true));
  }, []);
  useEffect(() => {
    // 사진을 저장하거나 카메라를 쓰는 동안은 세지 않는다. 화면을 누르거나 키를 치면 처음부터 다시 센다.
    let last = Date.now();
    const busyNow = processing || damageCamera || !!captureMode;
    const touch = () => { last = Date.now(); setIdleLeft(null); };
    const tick = window.setInterval(() => {
      if (busyNow) { last = Date.now(); return; }
      const left = Math.ceil((IDLE_LOGOUT_MS - (Date.now() - last)) / 1000);
      if (left <= 0) { last = Date.now(); setIdleLeft(null); logout(); return; }
      // 완료 화면은 자체 카운트다운이 있고, 로그인 전에는 입력하던 사번만 지우면 되므로 알리지 않는다.
      setIdleLeft(loggedIn && !done && left <= IDLE_WARN_SECONDS ? left : null);
    }, 1000);
    ["pointerdown", "keydown"].forEach((event) => window.addEventListener(event, touch));
    return () => { window.clearInterval(tick); ["pointerdown", "keydown"].forEach((event) => window.removeEventListener(event, touch)); };
  }, [processing, damageCamera, captureMode, loggedIn, done]);
  useEffect(() => {
    if (!damageConfirm || returnConfirmCount <= 0) return;
    const timer = window.setTimeout(() => setReturnConfirmCount((count) => Math.max(0, count - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [damageConfirm, returnConfirmCount]);
  async function login() {
    if (!/^\d{4}$/.test(employeeId)) { setError("4자리 사번을 입력해주세요."); return; }
    if (DEV_DEMO_ENABLED && employeeId === DEV_DEMO_EMPLOYEE_ID) {
      startDemo();
      return;
    }
    setBusy(true); setError("");
    try {
      // 공구 대여 내역은 별도 기록이다. 확인에 실패해도 시나리오 물품 처리는 막지 않는다.
      const toolsP = fetchMyTools(employeeId).then(
        (tools) => ({ tools, toolError: "" }),
        (e: any) => ({ tools: [] as BorrowedTool[], toolError: e.message || "공구 대여 내역을 확인하지 못했습니다." }),
      );
      const data = await call("find-mine", { employeeId });
      const list: Item[] = data.items || [];
      const { tools, toolError } = await toolsP;
      setMyTools(tools); setToolsError(toolError);
      setBorrowerName(data.borrowerName || ""); setLoggedIn(true);
      applyScenarioList(list);
      // 반납할 것이 먼저 보이고, 공구는 오른쪽 위 버튼으로 추가 대여한다. 처리할 시나리오 물품이 아예
      // 없으면 곧바로 공구 화면으로 간다(반납할 공구가 있으면 반납, 없으면 대여).
      setToolScreen(list.length ? null : tools.length ? "return" : "borrow");
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  function startDemo() {
    setEmployeeId(DEV_DEMO_EMPLOYEE_ID);
    setBorrowerName("테스트 사용자");
    setItems(DEV_DEMO_ITEMS);
    setLoggedIn(true);
    setDemoMode(true);
    setMode("return");
    setActionSelected(false);
    setSelected({}); setDamaged({}); setDamageReason({}); setDamagePhoto(""); setError("");
  }

  const payload = () => chosen.map((item) => ({
    sheetType: item.sheetType, rowIndex: item.rowIndex, quantity: selected[item.key],
    damaged: !!damaged[item.key], reason: damageReason[item.key] || "", variantId: item.variantId,
  }));

  async function finishReturn(returnPhoto: string) {
    setProcessing(true); setError("");
    try {
      const data = await call("return", { clientId: attempt.current, items: payload(), photo: returnPhoto, ...(hasDamage ? { damagePhoto } : {}) });
      const link = `${location.protocol}//${location.hostname}:3002${data.lookupPath}?employeeId=${encodeURIComponent(employeeId)}&returnBatch=${data.batchId}`;
      const qr = await QRCode.toDataURL(link, { width: 360, margin: 2 });
      setDone({ kind: "return", qr }); setDamageConfirm(false);
      void refreshAfterDone();
    } catch (e: any) { setError(e.message); setDamageConfirm(false); }
    finally { setProcessing(false); }
  }

  function beginReturn() {
    if (!chosen.length) return;
    if (hasDamage) {
      const missing = chosen.find((item) => damaged[item.key] && !String(damageReason[item.key] || "").trim());
      if (missing) { setError(`'${missing.itemName}'의 파손 사유를 입력해주세요.`); return; }
      if (!demoMode && !damagePhoto) { setError("파손된 물품 사진을 촬영해주세요."); return; }
    }
    setDamageConfirm(false);
    if (demoMode) { setDone({ kind: "return" }); return; }
    setCaptureMode("return");
  }

  async function finishPickup(pickupPhoto: string) {
    if (!chosen.length) return;
    setProcessing(true); setError("");
    try {
      await call("confirm-pickup", { clientId: attempt.current, items: payload(), photo: pickupPhoto });
      showToast("대여 확인 사진을 저장하고 처리를 완료했습니다.", "ok"); setDone({ kind: "pickup" });
      void refreshAfterDone();
    } catch (e: any) { setError(e.message); }
    finally { setProcessing(false); }
  }

  async function loginAsAdmin(event: React.FormEvent) {
    event.preventDefault();
    if (!adminLoginId.trim() || !adminPassword) { setAdminError("관리자 ID와 비밀번호를 입력해주세요."); return; }
    setAdminBusy(true); setAdminError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: adminLoginId.trim(), password: adminPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || "관리자 계정 정보를 확인해주세요.");
      setAdminToken(data.token);
      // 관리자가 일반 모드로 돌아오면 무인 모드도 끈다 — 켜 둔 채로 두면 미수령 기준·위반 기록·
      // 위치 숨김이 계속 무인 모드로 동작한다. 끄기에 실패해도 로그인 전환은 막지 않는다.
      const off = await fetch("/api/unattended/mode", {
        method: "PUT", headers: { "Content-Type": "application/json", "x-admin-token": data.token },
        body: JSON.stringify({ enabled: false }),
      }).then((r) => r.ok).catch(() => false);
      onAdminExit({ id: data.user.loginId, name: data.user.name });
      if (!off) showToast("무인 모드를 끄지 못했습니다. 관리자 설정에서 직접 꺼주세요.", "warn");
    } catch (e: any) { setAdminError(e.message || "관리자 로그인에 실패했습니다."); }
    finally { setAdminBusy(false); }
  }

  const adminFooter = <footer style={{ width: "100%", maxWidth: 900, margin: "24px auto 0", padding: "16px 0 2px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "center" }}>
    <button onClick={() => { setAdminError(""); setAdminLoginOpen(true); }} style={{ ...ghost(C), color: C.dim, background: "transparent", borderColor: "transparent" }}><LockKeyhole size={15} /> 관리자 로그인 · 일반 모드 전환</button>
  </footer>;
  const adminLoginModal = adminLoginOpen ? <div style={{ ...overlay, zIndex: 7000 }}><form onSubmit={loginAsAdmin} style={{ ...panel(C), width: "min(440px,100%)", padding: 26 }}>
    <div style={{ width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: "rgba(37,224,189,.13)", color: C.accent, marginBottom: 14 }}><LockKeyhole size={23} /></div>
    <h2 style={{ margin: "0 0 7px" }}>관리자 로그인</h2><p style={{ margin: "0 0 20px", color: C.dim, fontSize: 13, lineHeight: 1.6 }}>인증이 완료되면 무인 화면을 종료하고 일반 관리자 모드로 전환합니다.</p>
    <div style={{ display: "grid", gap: 10 }}><input autoFocus autoComplete="username" placeholder="관리자 ID" value={adminLoginId} onChange={(e) => setAdminLoginId(e.target.value)} style={{ ...input(C), width: "100%" }} /><input type="password" autoComplete="current-password" placeholder="비밀번호" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} style={{ ...input(C), width: "100%" }} /></div>
    {adminError ? <p style={errorStyle}>{adminError}</p> : null}
    <button type="submit" disabled={adminBusy} style={{ ...primary, width: "100%", justifyContent: "center", marginTop: 16, opacity: adminBusy ? .6 : 1 }}>{adminBusy ? "로그인 확인 중..." : "일반 모드로 전환"}</button>
    <button type="button" disabled={adminBusy} onClick={() => { setAdminLoginOpen(false); setAdminPassword(""); setAdminError(""); }} style={{ ...ghost(C), width: "100%", justifyContent: "center", marginTop: 8 }}>취소</button>
  </form></div> : null;

  if (done) {
    const title = { return: "반납이 완료되었습니다", pickup: "대여 확인이 완료되었습니다", toolBorrow: "공구 대여 신청이 완료되었습니다", toolReturn: "공구 반납이 완료되었습니다" }[done.kind];
    // 남은 일이 있으면 사번을 다시 넣지 않고 이어서 한다. 공구 대여는 언제든 할 수 있으므로 항상 둔다.
    const nextActions: { key: NextAction; label: string; icon: React.ReactNode }[] = [];
    if (!demoMode && nextReady) {
      if (pickupItems.length) nextActions.push({ key: "pickup", label: `빌릴 물품 받기 (${pickupItems.length})`, icon: <CheckCircle2 size={20} /> });
      if (returnItems.length) nextActions.push({ key: "return", label: `물품 반납하기 (${returnItems.length})`, icon: <LogOut size={20} style={{ transform: "rotate(180deg)" }} /> });
      if (myTools.length) nextActions.push({ key: "toolReturn", label: `공구 반납하기 (${myTools.length})`, icon: <RotateCcw size={20} /> });
      nextActions.push({ key: "toolBorrow", label: "공구 대여하기", icon: <Wrench size={20} /> });
    }
    const lines = done.kind === "toolBorrow"
      ? done.receipt.items.map((item) => ({ name: item.name, qty: item.qty, ok: item.status === "resolved", note: item.status === "resolved" ? `${item.type === "소모" ? "소모" : "대여"} 처리 완료` : `관리자 확인 대기 · ${item.reason || "재고 연결 필요"}` }))
      : done.kind === "toolReturn"
        ? done.items.map((item) => ({ name: item.name, qty: item.qty, ok: !item.pending, note: item.pending ? "재고 연결 전 반납 · 기록 저장" : "재고 복구됨" }))
        : null;
    return <main style={{ minHeight: "100vh", background: mainBg(C, isLightMode), color: C.text, display: "flex", flexDirection: "column", padding: 28, textAlign: "center" }}><style>{sectionSlideCss}</style><div style={{ flex: 1, display: "grid", placeItems: "center" }}><div key="done" className="wms-section-slide wms-panel" style={{ ...panel(C), maxWidth: 760, width: "100%", padding: "48px clamp(28px,6vw,58px)", display: "grid", justifyItems: "center" }}>
      <div style={{ width: 82, height: 82, borderRadius: 999, display: "grid", placeItems: "center", color: C.accent, background: "rgba(37,224,189,.13)", marginBottom: 20 }}><CheckCircle2 size={50} /></div><h1 style={{ margin: "0 0 12px", fontSize: 32 }}>{title}</h1>
      {done.kind === "return" && done.qr ? <><p style={{ color: C.dim, margin: "0 0 18px", fontSize: 18, lineHeight: 1.65 }}>QR을 열어 보관 위치를 확인하고 물품을 제자리에 놓아주세요.</p><img src={done.qr} alt="물품 위치 확인 QR" style={{ width: "min(360px,72vw)", background: "#fff", padding: 10, borderRadius: 16 }} /></>
        : lines ? <>
          <p style={{ color: C.dim, margin: "0 0 16px", fontSize: 18 }}>{done.kind === "toolBorrow" ? `신청 #${done.receipt.requestId} · 사용 층 ${done.floor}` : "반납한 공구와 촬영 사진을 저장했습니다."}</p>
          <div style={{ width: "100%", textAlign: "left", border: `1px solid ${C.border}`, borderRadius: 18, overflow: "hidden" }}>
            {lines.map((line, n) => <div key={n} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", padding: "14px 18px", borderTop: n ? `1px solid ${C.border}` : 0, background: C.surface }}>
              <b style={{ fontSize: 19 }}>{line.name} × {line.qty}</b>
              <span style={{ fontSize: 15, fontWeight: 800, color: line.ok ? C.accent : "#d97706" }}>{line.note}</span>
            </div>)}
          </div>
          {done.kind === "toolBorrow" && done.receipt.pending ? <p style={{ color: C.dim, margin: "14px 0 0", fontSize: 15, lineHeight: 1.6 }}>확인 대기 물품은 사진과 함께 기록되었습니다. 관리자가 재고를 연결하면 재고와 대여 장부에 반영됩니다.</p> : null}
        </>
        : <p style={{ color: C.dim, margin: "0 0 22px", fontSize: 18 }}>{demoMode ? "테스트 처리가 완료되었습니다. 실제 데이터는 변경되지 않았습니다." : done.kind === "return" ? "반납 처리가 완료되었습니다." : "촬영한 대여 확인 사진이 안전하게 저장되었습니다."}</p>}
      {nextActions.length ? <div style={{ width: "100%", marginTop: 26, paddingTop: 20, borderTop: `1px solid ${C.border}` }}>
        <div style={{ color: C.dim, fontSize: 16, fontWeight: 800, marginBottom: 12 }}>이어서 할 일이 있으면 누르세요</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          {nextActions.map((action) => <button key={action.key} onClick={() => continueWith(action.key)} style={{ ...ghost(C), justifyContent: "center", minHeight: 60, fontSize: 18 }}>{action.icon} {action.label}</button>)}
        </div>
      </div> : null}
      <div style={{ marginTop: 22, padding: "9px 16px", borderRadius: 999, background: "rgba(37,224,189,.13)", color: C.accent, fontSize: 16, fontWeight: 850 }}><b style={{ fontSize: 22 }}>{logoutSeconds}</b>초 후 자동 로그아웃</div>
      <button className="wms-primary-action" onClick={logout} style={{ ...primary, width: "100%", justifyContent: "center", marginTop: 16, minHeight: 64, fontSize: 18 }}><LogOut size={21} /> 지금 로그아웃</button>
    </div></div>{adminFooter}{adminLoginModal}</main>;
  }

  const headSub = !loggedIn ? "사번 4자리로 시작하세요"
    : toolScreen === "borrow" ? "사용할 층과 물품 이름을 적고 사진을 찍으세요"
    : toolScreen === "return" ? "반납할 공구를 고르고 사진을 찍으세요"
    : !actionSelected ? "할 일을 골라주세요"
    : mode === "return" ? "반납할 물품을 하나씩 확인하세요" : "가져갈 물품을 하나씩 확인하세요";

  return <main style={{ minHeight: "100vh", background: mainBg(C, isLightMode), color: C.text, padding: "24px clamp(18px,4vw,48px) 20px", display: "flex", flexDirection: "column" }}><style>{sectionSlideCss}</style><div style={{ maxWidth: 1280, margin: "0 auto", width: "100%", flex: 1, display: "flex", flexDirection: "column" }}>
    <header className="wms-kiosk-head" style={{ position: "relative", textAlign: "center", margin: "4px 0 22px", padding: "0 72px" }}>
      {loggedIn && !toolScreen && actionSelected && returnItems.length > 0 && pickupItems.length > 0 ? <button onClick={returnToActionChoice} style={{ ...ghost(C), position: "absolute", left: 0, top: 6, minHeight: 50, paddingInline: 17, fontSize: 16 }}><ArrowLeft size={20} /> 이전</button> : null}
      <h1 style={{ margin: 0, fontSize: "clamp(28px,4vw,36px)", fontWeight: 900, letterSpacing: "-.035em" }}>무인 대여 · 반납</h1>
      <div style={{ fontSize: 16, color: C.dim, marginTop: 7, fontWeight: 700 }}>{headSub}</div>
      <div aria-label={`진행률 ${stepProgress}%`} style={{ width: "min(520px,72vw)", height: 6, margin: "16px auto 0", borderRadius: 999, overflow: "hidden", background: C.border }}><div style={{ width: `${stepProgress}%`, height: "100%", borderRadius: 999, background: C.accent, transition: "width .42s cubic-bezier(.16,1,.3,1)" }} /></div>
      {loggedIn ? <div className="wms-head-actions" style={{ position: "absolute", right: 0, top: 10, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {!demoMode && myTools.length > 0 && toolScreen !== "return" ? <button onClick={() => openToolScreen("return")} style={{ ...ghost(C), minHeight: 50 }}><RotateCcw size={16} /> 공구 반납 ({myTools.length})</button> : null}
        {!demoMode && toolScreen !== "borrow" ? <button onClick={() => openToolScreen("borrow")} style={{ ...ghost(C), minHeight: 50, borderColor: C.accent, color: C.accent }}><Wrench size={16} /> 공구 {hasScenarioItems || myTools.length > 0 ? "추가 " : ""}대여하기</button> : null}
        <button onClick={logout} style={{ ...ghost(C), minHeight: 50 }}><LogOut size={16} /> 로그아웃</button>
      </div> : null}
    </header>

    {!loggedIn ? <section key="login" className="wms-section-slide wms-panel" style={{ ...panel(C), width: "100%", maxWidth: 820, margin: "auto", padding: "0", overflow: "hidden" }}>
      <div style={{ padding: "46px clamp(28px,6vw,58px) 44px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ width: 58, height: 58, borderRadius: 17, display: "grid", placeItems: "center", background: "rgba(37,224,189,.13)", color: C.accent, flexShrink: 0 }}><IdCard size={30} /></span>
          <h2 style={{ margin: 0, fontSize: 31, fontWeight: 900 }}>사번을 입력하세요</h2>
        </div>
        <p style={{ color: C.dim, fontSize: 18, lineHeight: 1.65, margin: "4px 0 28px 68px" }}>담당자가 부재중입니다. 대여·반납은 직접 처리해 주세요.</p>
        <div style={formRow}>
          <div style={{ position: "relative", flex: 1, minWidth: 120 }}>
            <IdCard size={18} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: C.dim }} />
            <input autoFocus aria-label="4자리 사번" placeholder="0000" inputMode="numeric" maxLength={4} value={employeeId} onChange={(e) => setEmployeeId(e.target.value.replace(/\D/g, "").slice(0, 4))} onKeyDown={(e) => e.key === "Enter" && login()} style={{ ...input(C), width: "100%", minHeight: 78, paddingLeft: 50, fontSize: 30, fontWeight: 900, letterSpacing: "0.2em" }} />
          </div>
          <button className="wms-primary-action" disabled={busy || employeeId.length !== 4} onClick={login} style={{ ...primary, minHeight: 78, paddingInline: 38, fontSize: 21, opacity: busy || employeeId.length !== 4 ? 0.55 : 1 }}><Search size={25} /> {busy ? "찾는 중" : "다음"}</button>
        </div>
        {DEV_DEMO_ENABLED ? <button type="button" className="wms-demo-entry" onClick={startDemo} style={{ ...ghost(C), width: "100%", minHeight: 58, justifyContent: "center", marginTop: 14, borderStyle: "dashed", color: C.accent, background: "rgba(37,224,189,.08)", fontSize: 17 }}><span style={{ fontSize: 21 }}>🧪</span> 테스트 사번 9999로 체험하기</button> : null}
        {error ? <p style={errorStyle}>{error}</p> : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px clamp(28px,6vw,58px)", borderTop: `1px solid ${C.border}`, background: C.surface, fontSize: 18, lineHeight: 1.5 }}>
        <MessageCircle size={24} color={C.accent} style={{ flexShrink: 0 }} />
        <span>문제가 생기면 Slack에서 <b>{HELP_SLACK_NAME}</b>에게 DM을 보내주세요.</span>
      </div>
    </section> : toolScreen ? <div key="tools" className="wms-section-slide">
      <section className="wms-panel" style={{ ...panel(C), marginBottom: 16, borderLeft: `7px solid ${C.accent}`, padding: "24px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: 0, fontSize: 27, fontWeight: 900 }}>{borrowerName}님</h2>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10, padding: "7px 14px", borderRadius: 999, background: modeAccentSoft, color: modeAccent, fontSize: 16, fontWeight: 850 }}>
              {toolScreen === "borrow" ? <Wrench size={17} /> : <RotateCcw size={17} />}{toolScreen === "borrow" ? "공구 대여 · 사용할 층 → 물품 이름 → 사진" : `공구 반납 · ${myTools.length}건`}
            </div>
          </div>
          {hasScenarioItems ? <button onClick={() => setToolScreen(null)} style={{ ...ghost(C), minHeight: 50, paddingInline: 17 }}><ArrowLeft size={18} /> 대여·반납 물품으로</button> : null}
          {myTools.length > 0 && toolScreen === "borrow" ? <button onClick={() => openToolScreen("return")} style={{ ...ghost(C), minHeight: 50, paddingInline: 17 }}><RotateCcw size={16} /> 공구 반납하기 ({myTools.length})</button> : null}
        </div>
        {toolsError ? <p style={errorStyle} role="alert">{toolsError} <button onClick={() => void refreshMyTools()} style={{ ...ghost(C), display: "inline-flex", padding: "4px 10px" }}>다시 확인</button></p> : null}
      </section>
    </div> : !actionSelected ? <div key="action" className="wms-section-slide" style={{ width: "100%", margin: "auto 0" }}>
      <section className="wms-panel" style={{ ...panel(C), marginBottom: 14, textAlign: "center", padding: "46px clamp(26px,5vw,54px)" }}><h2 style={{ margin: "0 0 9px", fontSize: 32 }}>{borrowerName}님, 무엇을 할까요?</h2><div style={{ color: C.dim, fontSize: 18 }}>가능한 업무만 표시했습니다.</div><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 18, marginTop: 32 }}>
        {pickupItems.length ? <button className="wms-action-card" onClick={() => chooseMode("pickup")} style={actionCard(C, C.accent, false)}><span style={{ ...actionIcon, color: C.accent, background: "rgba(37,224,189,.13)" }}><CheckCircle2 size={38} /></span><span style={{ fontSize: 26, fontWeight: 900 }}>빌릴 물품 받기</span><span style={{ color: C.dim, fontSize: 18 }}>{pickupItems.length}건을 확인하고 가져갑니다</span></button> : null}
        {returnItems.length ? <button className="wms-action-card" onClick={() => chooseMode("return")} style={actionCard(C, C.accent, false)}><span style={{ ...actionIcon, color: C.accent, background: "rgba(37,224,189,.13)" }}><LogOut size={38} style={{ transform: "rotate(180deg)" }} /></span><span style={{ fontSize: 26, fontWeight: 900 }}>물품 반납하기</span><span style={{ color: C.dim, fontSize: 18 }}>{returnItems.length}건을 반납합니다</span></button> : null}
        {!demoMode && myTools.length ? <button className="wms-action-card" onClick={() => openToolScreen("return")} style={actionCard(C, C.accent, false)}><span style={{ ...actionIcon, color: C.accent, background: "rgba(37,224,189,.13)" }}><RotateCcw size={38} /></span><span style={{ fontSize: 26, fontWeight: 900 }}>공구 반납하기</span><span style={{ color: C.dim, fontSize: 18 }}>{myTools.length}건을 반납합니다</span></button> : null}
        {!demoMode ? <button className="wms-action-card" onClick={() => openToolScreen("borrow")} style={actionCard(C, C.accent, false)}><span style={{ ...actionIcon, color: C.accent, background: "rgba(37,224,189,.13)" }}><Wrench size={38} /></span><span style={{ fontSize: 26, fontWeight: 900 }}>공구 대여하기</span><span style={{ color: C.dim, fontSize: 18 }}>층수·물품 이름을 적고 사진을 찍습니다</span></button> : null}
      </div>{!pickupItems.length && !returnItems.length && !myTools.length && demoMode ? <p style={{ color: C.dim, margin: "20px 0 0" }}>현재 처리할 대여 또는 반납 물품이 없습니다.</p> : null}</section>
    </div> : <div key={`items-${mode}`} className="wms-section-slide">
      <section className="wms-panel" style={{ ...panel(C), marginBottom: 16, borderLeft: `7px solid ${modeAccent}`, padding: "24px 28px" }}><div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}><div><div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><h2 style={{ margin: 0, fontSize: 27, fontWeight: 900 }}>{borrowerName}님</h2>{demoMode ? <span style={{ padding: "5px 10px", borderRadius: 999, background: "rgba(37,224,189,.13)", color: C.accent, fontSize: 13, fontWeight: 900 }}>🧪 테스트 모드</span> : null}</div><div style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 10, padding: "7px 14px", borderRadius: 999, background: modeAccentSoft, color: modeAccent, fontSize: 16, fontWeight: 850 }}>{mode === "return" ? <LogOut size={17} style={{ transform: "rotate(180deg)" }} /> : <CheckCircle2 size={17} />}{mode === "return" ? `물품 반납 · ${returnItems.length}건` : `빌릴 물품 받기 · ${pickupItems.length}건`}</div></div></div></section>
      <section className="wms-panel" style={{ ...panel(C), marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16 }}>
          <span style={{ width: 46, height: 46, borderRadius: 12, display: "grid", placeItems: "center", background: modeAccentSoft, color: modeAccent, flexShrink: 0 }}>{mode === "return" ? <LogOut size={23} style={{ transform: "rotate(180deg)" }} /> : <CheckCircle2 size={23} />}</span>
          <div><h2 style={{ margin: 0, fontSize: 27, fontWeight: 900 }}>{mode === "return" ? "반납할 물품을 하나씩 확인하세요" : "가져갈 물품을 하나씩 확인하세요"}</h2><div style={{ marginTop: 6, color: C.dim, fontSize: 16 }}>{chosen.length ? `${chosen.length}건 확인 완료 · 실물과 일치하는 항목만 선택하세요.` : "실물과 화면을 대조한 뒤 해당 물품을 직접 선택하세요."}</div></div>
        </div>
        {!visibleItems.length ? <div style={{ padding: 30, textAlign: "center", color: C.dim }}>처리할 물품이 없습니다.</div> : <div className="wms-item-grid">{visibleItems.map((item) => {
          const isChosen = (selected[item.key] || 0) > 0;
          return <label className="wms-item-card" key={item.key} style={{ position: "relative", display: "flex", alignItems: "center", gap: 17, border: `2px solid ${isChosen ? modeAccent : "transparent"}`, borderRadius: 22, padding: 16, minHeight: 124, cursor: "pointer", background: isChosen ? modeAccentSoft : C.surface, boxShadow: "none" }}>
            <input type="checkbox" checked={isChosen} onChange={(e) => setSelected((current) => ({ ...current, [item.key]: e.target.checked ? item.quantity : 0 }))} style={{ width: 36, height: 36, flexShrink: 0, accentColor: modeAccent }} />
            <ItemThumb item={item} C={C} size={82} /><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 21, fontWeight: 900, lineHeight: 1.35 }}>{item.itemName}</div><div style={{ fontSize: 16, color: C.dim, marginTop: 7 }}>{item.itemId} · {item.location || "위치 미등록"}</div><div style={{ marginTop: 8, color: isChosen ? modeAccent : C.dim, fontSize: 14, fontWeight: 900 }}>{isChosen ? "✓ 실물 확인 완료" : "실물 확인 후 선택"}</div></div>{item.quantity > 1 ? <><input aria-label={`${item.itemName} 수량`} type="number" min={0} max={item.quantity} value={selected[item.key] || 0} onChange={(e) => setSelected((current) => ({ ...current, [item.key]: Math.min(item.quantity, Math.max(0, Number(e.target.value) || 0)) }))} style={{ ...input(C), flex: "none", width: 86, minHeight: 58, fontSize: 21, fontWeight: 850 }} /><span style={{ whiteSpace: "nowrap", fontSize: 19, fontWeight: 800 }}>/ {item.quantity}</span></> : <span style={{ whiteSpace: "nowrap", fontSize: 20, fontWeight: 850 }}>1개</span>}
          </label>;
        })}
      </div>}{visibleItems.length ? <div className="wms-action-dock" style={{ position: "sticky", bottom: 14, marginTop: 22, padding: 14, borderRadius: 22, background: C.panel, border: `1px solid ${C.border}`, boxShadow: "0 14px 40px rgba(15,23,42,.2)", zIndex: 5 }}><div style={{ textAlign: "center", color: chosen.length ? modeAccent : C.dim, fontSize: 16, fontWeight: 900, marginBottom: 10 }}>{chosen.length ? `${chosen.length}건 실물 확인 완료` : "확인한 물품을 하나 이상 선택해주세요"}</div><button className="wms-primary-action" disabled={!chosen.length || busy || processing} onClick={() => mode === "return" ? openReturnConfirm() : demoMode ? setDone({ kind: "pickup" }) : setCaptureMode("pickup")} style={{ ...primary, width: "100%", minHeight: 70, justifyContent: "center", fontSize: 21, opacity: !chosen.length ? .45 : 1, background: modeAccent }}>{processing ? "처리 중..." : mode === "return" ? "확인한 물품 반납하기" : demoMode ? "확인한 물품 테스트 완료" : "확인한 물품 사진 찍기"}</button></div> : null}{error ? <p style={errorStyle}>{error}</p> : null}</section>
    </div>}
    {loggedIn && !demoMode ? <div style={{ maxWidth: 900, width: "100%", margin: "0 auto", display: toolScreen ? "block" : "none" }}>
      {/* 공구도 시나리오 물품처럼 완료 화면 → 자동 로그아웃으로 끝낸다. 다음 사람이 앞사람 사번으로 신청하는 일을 막는다. */}
      <UnattendedToolBorrowForm kiosk active={toolScreen === "borrow"} enabled employeeId={employeeId} name={borrowerName}
        floors={floors} floorsLoaded={floorsLoaded} isLightMode={isLightMode}
        onFinished={(receipt, floor) => { setDone({ kind: "toolBorrow", receipt, floor }); void refreshAfterDone(); }} />
      <UnattendedToolReturnForm kiosk active={toolScreen === "return"} enabled employeeId={employeeId} items={myTools}
        isLightMode={isLightMode} onRefresh={() => void refreshMyTools()}
        onFinished={(result) => { setDone({ kind: "toolReturn", items: result.items }); void refreshAfterDone(); }} />
    </div> : null}
  </div>{adminFooter}

  <CameraCaptureModal open={damageCamera} onClose={() => setDamageCamera(false)} onCapture={(photo) => { setDamagePhoto(photo); setDamageCamera(false); setDamageConfirm(true); }} title="파손된 물품 촬영" isLightMode={isLightMode} />
  <CameraCaptureModal open={captureMode !== null} onClose={() => setCaptureMode(null)} onCapture={(photo) => { const target = captureMode; setCaptureMode(null); if (target === "return") void finishReturn(photo); else if (target === "pickup") void finishPickup(photo); }} title={captureMode === "return" ? "반납 상태 확인 사진 촬영" : "대여 수령 확인 사진 촬영"} isLightMode={isLightMode} />
  {adminLoginModal}
  {damageConfirm ? <div style={overlay}><div style={{ ...panel(C), maxWidth: 760, width: "100%", maxHeight: "92vh", overflowY: "auto", padding: "34px clamp(24px,5vw,44px)" }}>
    {damageStage === "ask" ? (
      <div style={{ textAlign: "center", padding: "6px 4px" }}>
        <div className="wms-warn-badge" style={{ width: 86, height: 86, borderRadius: 999, background: "rgba(245,158,11,.14)", display: "grid", placeItems: "center", margin: "0 auto 22px" }}>
          <ShieldAlert size={48} color="#f59e0b" />
        </div>
        <h2 style={{ fontSize: 30, fontWeight: 900, margin: "0 0 14px", color: "#fbbf24", lineHeight: 1.35 }}>
          파손되었거나<br />정상 사용이 어려운 물품이 있나요?
        </h2>
        <p style={{ color: C.dim, fontSize: 18, lineHeight: 1.65, margin: "0 auto 28px", maxWidth: 520 }}>
          반납 전 마지막 확인입니다. 파손된 채로 반납하면 다음 사람이 모르고 그대로 사용하게 됩니다 — 꼭 확인해주세요.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={() => setDamageStage("list")}
            style={{ ...primary, width: "100%", justifyContent: "center", minHeight: 68, background: "#dc2626", fontSize: 20 }}
          >
            <ShieldAlert size={18} /> 예, 파손된 물품이 있습니다
          </button>
          <button
            disabled={processing || returnConfirmCount > 0}
            onClick={beginReturn}
            style={{
              ...ghost(C), width: "100%", justifyContent: "center", minHeight: 68, fontSize: 20,
              opacity: returnConfirmCount > 0 ? .55 : 1, cursor: returnConfirmCount > 0 ? "not-allowed" : "pointer",
            }}
          >
            <CheckCircle2 size={18} /> {returnConfirmCount > 0 ? `아니요, 없습니다 (${returnConfirmCount}초 후 선택 가능)` : "아니요, 없습니다"}
          </button>
          <button
            disabled={processing}
            onClick={() => { setDamageConfirm(false); setReturnConfirmCount(0); setError(""); }}
            style={{ border: "none", background: "transparent", color: C.dim, fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: "6px 0" }}
          >
            물품 선택으로 돌아가기
          </button>
        </div>
        {error ? <p style={errorStyle}>{error}</p> : null}
      </div>
    ) : <>
      <ShieldAlert size={40} color="#f59e0b" /><h2 style={{ fontWeight: 900 }}>어느 물품이 파손됐나요?</h2><p style={{ color: C.dim }}>파손된 물품만 선택하고 사유를 작성한 뒤, 파손된 부분이 보이도록 사진을 촬영해주세요.</p>{chosen.map((item) => <div key={item.key} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}><label style={{ display: "flex", gap: 10, alignItems: "center" }}><input type="checkbox" checked={!!damaged[item.key]} onChange={(e) => { setDamaged((current) => ({ ...current, [item.key]: e.target.checked })); setError(""); }} /><ItemThumb item={item} C={C} size={54} /><span style={{ flex: 1, fontWeight: 800 }}>{item.itemName} × {selected[item.key]}</span><span style={{ color: damaged[item.key] ? "#dc2626" : C.dim, fontWeight: 800 }}>{damaged[item.key] ? "파손" : "정상"}</span></label>{damaged[item.key] ? <textarea placeholder="파손 상태와 확인이 필요한 내용을 적어주세요" value={damageReason[item.key] || ""} onChange={(e) => setDamageReason((current) => ({ ...current, [item.key]: e.target.value }))} style={{ ...input(C), width: "100%", minHeight: 72, marginTop: 9, resize: "vertical" }} /> : null}</div>)}{hasDamage && !demoMode ? <button onClick={() => { setDamageConfirm(false); setDamageCamera(true); }} style={{ ...ghost(C), width: "100%", justifyContent: "center", marginTop: 14 }}><Camera size={17} /> {damagePhoto ? "파손 사진 다시 촬영" : "파손 사진 촬영"}</button> : null}<button disabled={processing || (!hasDamage && returnConfirmCount > 0)} onClick={beginReturn} style={{ ...primary, width: "100%", justifyContent: "center", marginTop: 14, background: hasDamage ? "#dc2626" : "#25e0bd", color: hasDamage ? "#fff" : "#0d1c18", opacity: !hasDamage && returnConfirmCount > 0 ? .55 : 1, cursor: !hasDamage && returnConfirmCount > 0 ? "not-allowed" : "pointer" }}>{demoMode ? "테스트 반납 완료하기" : hasDamage ? "파손 포함 · 반납 사진 촬영" : returnConfirmCount > 0 ? `파손 없음 · ${returnConfirmCount}초 후 촬영 가능` : "파손 없음 · 반납 사진 촬영"}</button><button disabled={processing} onClick={() => setDamageStage("ask")} style={{ ...ghost(C), width: "100%", justifyContent: "center", marginTop: 8 }}>다시 묻기</button>{error ? <p style={errorStyle}>{error}</p> : null}
    </>}
  </div></div> : null}
  {idleLeft !== null ? <div role="alertdialog" aria-live="assertive" aria-label="자동 로그아웃 안내" style={{ ...overlay, zIndex: 8000 }}><div style={{ ...panel(C), width: "min(480px,100%)", textAlign: "center", padding: "34px 30px" }}>
    <div style={{ fontSize: 56, fontWeight: 900, color: C.accent, lineHeight: 1 }}>{idleLeft}</div>
    <h2 style={{ margin: "14px 0 10px", fontSize: 26, fontWeight: 900 }}>곧 자동으로 로그아웃됩니다</h2>
    <p style={{ color: C.dim, fontSize: 17, margin: "0 0 22px", lineHeight: 1.6 }}>계속하려면 화면을 눌러주세요. 로그아웃되면 작성 중인 내용은 지워집니다.</p>
    <button className="wms-primary-action" onClick={() => setIdleLeft(null)} style={{ ...primary, width: "100%", justifyContent: "center", minHeight: 64, fontSize: 19 }}>계속하기</button>
  </div></div> : null}
  {processing ? <div style={{ ...overlay, zIndex: 6000 }}><div style={{ ...panel(C), width: "min(440px,100%)", textAlign: "center", padding: 30 }}><div style={{ fontSize: 54 }}>⏳</div><h2>촬영한 사진을 저장하고 있습니다</h2><p style={{ color: C.dim }}>창을 닫지 말고 처리가 끝날 때까지 잠시 기다려주세요.</p></div></div> : null}
  </main>;
}

// 16:9 키오스크 화면에서 두 열을 한눈에 훑고, 상태 변화는 짧고 부드럽게 느끼도록 한다.
// 계속 반복되는 장식 애니메이션은 두지 않고 직접 조작했을 때만 반응한다.
const sectionSlideCss = `
@keyframes wms-soft-enter {
  from { opacity: 0; transform: translateY(16px) scale(.988); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.wms-section-slide { animation: wms-soft-enter .42s cubic-bezier(.16,1,.3,1) both; }
.wms-panel { transition: border-color .24s ease, box-shadow .24s ease, transform .24s ease; }
.wms-item-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 16px; }
.wms-item-card { transition: transform .2s cubic-bezier(.16,1,.3,1), border-color .22s ease, background-color .22s ease, box-shadow .22s ease; }
.wms-action-card { transition: transform .22s cubic-bezier(.16,1,.3,1), box-shadow .22s ease, background-color .22s ease; }
.wms-primary-action { transition: transform .18s ease, filter .18s ease, box-shadow .18s ease; }
.wms-action-dock { transition: transform .24s ease, box-shadow .24s ease; }
@media (hover:hover) {
  .wms-item-card:hover { transform: translateY(-3px); box-shadow: 0 12px 28px rgba(0,0,0,.2) !important; }
  .wms-action-card:hover { transform: translateY(-5px); border-color: #25e0bd !important; box-shadow: 0 18px 38px rgba(0,0,0,.24) !important; }
  .wms-primary-action:not(:disabled):hover { transform: translateY(-2px); filter: brightness(1.04); box-shadow: 0 10px 24px rgba(37,224,189,.22); }
}
.wms-item-card:active, .wms-action-card:active, .wms-primary-action:not(:disabled):active { transform: scale(.985); }
@media (max-width:899px) {
  .wms-item-grid { grid-template-columns: minmax(0,1fr); gap: 12px; }
}
@media (max-width:1099px) {
  .wms-kiosk-head { padding: 0 !important; }
  .wms-kiosk-head .wms-head-actions { position: static !important; justify-content: center !important; margin-top: 14px; }
}
@media (prefers-reduced-motion:reduce) {
  .wms-section-slide { animation: none; }
  .wms-panel, .wms-item-card, .wms-action-card, .wms-primary-action, .wms-action-dock { transition: none; }
}
`;

const primary: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, border: 0, borderRadius: 18, padding: "12px 18px", background: "#25e0bd", color: "#0d1c18", fontWeight: 850, cursor: "pointer" };
const formRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" };
// 업무 화면 자체가 가장 먼저 보이도록 광고처럼 시선을 끄는 장식 배경을 쓰지 않는다.
const mainBg = (C: any, _isLightMode: boolean) => C.bg;
const panel = (C: any): React.CSSProperties => ({ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 26, padding: 24, boxShadow: "0 12px 32px rgba(0,0,0,.09)" });
const input = (C: any): React.CSSProperties => ({ flex: 1, minWidth: 120, border: `1px solid ${C.border}`, background: C.surface, color: C.text, borderRadius: 18, padding: "12px 14px", fontSize: 15, fontFamily: "inherit", outlineColor: "#25e0bd" });
const ghost = (C: any): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: 7, border: `1px solid ${C.border}`, background: C.panel, color: C.text, borderRadius: 16, padding: "10px 14px", fontWeight: 800, cursor: "pointer" });
const tab = (C: any, active: boolean): React.CSSProperties => ({ border: 0, borderRadius: 9, padding: "9px 13px", background: active ? "#25e0bd" : C.surface, color: active ? "#0d1c18" : C.text, fontWeight: 800, cursor: "pointer" });
const actionCard = (C: any, _accent: string, disabled: boolean): React.CSSProperties => ({ minHeight: 230, border: `1px solid ${C.border}`, borderRadius: 26, background: C.surface, color: C.text, padding: 30, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 13, fontFamily: "inherit", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .45 : 1, boxShadow: "none" });
const actionIcon: React.CSSProperties = { width: 72, height: 72, borderRadius: 22, display: "grid", placeItems: "center", marginBottom: 3 };
const overlay: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 5000, background: "rgba(2,6,23,.78)", display: "grid", placeItems: "center", padding: 18 };
const errorStyle: React.CSSProperties = { color: "#dc2626", fontWeight: 750, fontSize: 13 };
