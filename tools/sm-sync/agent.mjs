/**
 * 관리자 PC에서 상주하는 동기화 에이전트.
 *
 * 두 가지를 한다:
 *   1) WMS 관리자 로그인 화면이 보내온 ID/비밀번호로 Scenario Manager에 로그인해
 *      세션을 확보한다. (WMS 관리자 계정과 SM 계정이 같은 것을 전제로 한다)
 *   2) WMS에서 대여 확인·반납이 일어나면 달라진 물품만 SM에 즉시 반영한다.
 *
 * 비밀번호는 로그인 요청에만 쓰고 즉시 버린다 — 파일에도, 로그에도 남기지 않는다.
 * 남는 것은 SM 세션 쿠키뿐이고, 그것도 이 프로세스의 메모리에만 있다.
 * 그래서 PC를 재부팅하거나 에이전트를 다시 켜면 관리자가 WMS에 다시 로그인할 때까지
 * 동기화가 멈춘다 — 자격증명을 디스크에 두지 않기 위해 감수하는 부분이다.
 *
 * 왜 이 PC에서 도는가: SM은 테일넷 안에서만 열리고 WMS 서버는 테일넷에서 빠져 있다.
 * 브라우저의 WMS 화면도 다른 도메인인 SM을 직접 조작할 수 없다.
 *
 *   node agent.mjs                 # 127.0.0.1:8787 에서 대기하며 15초마다 확인
 *   node agent.mjs --port=9000 --interval=30
 *   node agent.mjs --dry-run       # 무엇을 처리할지 기록만 하고 쓰지 않는다
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { smLogin, makeSmFetch, reconcile, wmsSnapshot, WMS } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG = path.join(__dirname, "agent.log");
const STATE = path.join(__dirname, ".watch-state.json");

const args = process.argv.slice(2);
const arg = (k, d) => Number((args.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1]) || d;
const PORT = arg("port", 8787);
const INTERVAL = arg("interval", 15);
const DRY = args.includes("--dry-run");

let cookie = "";     // SM 세션. 메모리에만 둔다.
let account = "";    // 지금 세션의 계정 — 로그에 "누가 처리 중인지" 남기기 위해서만 쓴다.
let busy = false;

function log(msg) {
  const line = `[${new Date().toLocaleString("ko-KR", { hour12: false })}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + "\n", "utf-8"); } catch { /* 로그 실패로 멈추지 않는다 */ }
}

const smFetch = makeSmFetch(() => cookie);

// ── WMS 로그인 화면이 자격증명을 넘겨주는 창구 ────────────────
// 루프백에서만 받는다. 다른 PC에서는 접근할 수 없다.
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  // WMS 화면에서 온 요청만 받아준다. 아무 웹페이지나 이 포트를 두드리지 못하게 막는다.
  const allowed = origin === WMS || origin.startsWith("http://192.168.") || origin.startsWith("http://localhost");
  res.setHeader("Access-Control-Allow-Origin", allowed ? origin : "null");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }

  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, loggedIn: !!cookie, account, interval: INTERVAL, dryRun: DRY }));
    return;
  }

  if (req.method === "POST" && req.url === "/sm-login") {
    if (!allowed) { res.writeHead(403).end('{"ok":false,"error":"허용되지 않은 출처"}'); return; }
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on("end", async () => {
      let creds;
      try { creds = JSON.parse(body || "{}"); } catch { creds = {}; }
      const username = String(creds.username || "").trim();
      const password = String(creds.password || "");
      creds = null; body = "";                       // 원문은 곧바로 버린다
      if (!username || !password) { res.writeHead(400).end('{"ok":false,"error":"ID/비밀번호가 없습니다"}'); return; }
      try {
        cookie = await smLogin(username, password);
        account = username;
        log(`SM 로그인 성공 — 이후 동기화는 ${username} 계정으로 기록됩니다.`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        tick();                                      // 로그인하자마자 한 번 맞춘다
      } catch (e) {
        log(`SM 로그인 실패: ${e.message}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404).end();
});

// ── 변화 감시 ──────────────────────────────────────────────

const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf-8")); } catch { return null; } };
const saveState = (m) => fs.writeFileSync(STATE, JSON.stringify(m), "utf-8");

async function tick() {
  if (busy) return;
  busy = true;
  try {
    const now = await wmsSnapshot();
    const prev = loadState();
    if (!prev) {
      saveState(now);
      log(`기준 상태를 저장했습니다 (물품 ${Object.keys(now).length}종). 지금부터의 변화만 따라갑니다.`);
      return;
    }
    const changed = Object.keys(now).filter((id) => now[id] !== prev[id]);
    if (!changed.length) return;

    if (!cookie) {
      log(`변화 ${changed.length}종 — SM 세션이 없어 미뤄둡니다. 관리자가 WMS에 로그인하면 처리됩니다.`);
      return;                                        // 상태를 저장하지 않는다 → 로그인 후 다시 잡힌다
    }

    log(`변화 ${changed.length}종: ${changed.slice(0, 10).join(", ")}${changed.length > 10 ? " …" : ""}`);
    const r = await reconcile(smFetch, changed, { dryRun: DRY, log });
    log(`  → 수량 ${r.quantity}건 · 대여 ${r.borrow}건${r.failed.length ? ` · 실패 ${r.failed.length}건` : ""}`);
    saveState(await wmsSnapshot());                  // 처리 중 또 바뀌었으면 다음 회차에 잡힌다
  } catch (e) {
    if (e.needsLogin) { cookie = ""; log("SM 세션이 만료됐습니다. 관리자가 WMS에 다시 로그인하면 이어집니다."); }
    else log(`오류: ${e.message}`);
  } finally {
    busy = false;
  }
}

server.listen(PORT, "127.0.0.1", () => {
  log(`에이전트 시작 · 127.0.0.1:${PORT} · ${INTERVAL}초 간격${DRY ? " · 확인용(쓰지 않음)" : ""}`);
  log("WMS 관리자 로그인을 기다립니다 (그때 받은 계정으로 SM에 로그인합니다).");
  tick();
  setInterval(tick, INTERVAL * 1000);
});
