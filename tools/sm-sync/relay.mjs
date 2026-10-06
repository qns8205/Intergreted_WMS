/**
 * Scenario Manager 중계.
 *
 * WMS 서버(미니PC)는 테일넷에 없어서 SM에 닿지 못한다. 반면 관리자 PC는 테일넷에 붙어 있다.
 * 그래서 이 PC가 사내망과 테일넷 사이에서 요청만 그대로 넘겨준다.
 *
 *   WMS 서버 ──사내망──▶ (이 중계) ──테일넷──▶ scenario-manager
 *
 * 하는 일은 전달뿐이다. 무엇을 동기화할지는 전부 WMS 서버가 정하므로,
 * 기능이 바뀌어도 이 프로그램은 다시 배포할 필요가 없다.
 *
 * 아무나 이 포트로 사내 테일넷 서비스에 드나들 수 있으면 안 되므로,
 * 허용한 IP(기본: WMS 서버)에서 온 요청만 받는다.
 *
 *   node relay.mjs
 *   node relay.mjs --port=8788 --allow=192.168.100.152
 */
import http from "node:http";

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;

const PORT = Number(opt("port", 8788));
const TARGET = opt("target", "http://scenario-manager");
// 쉼표로 여러 개. 루프백은 언제나 허용한다(같은 PC에서 시험할 때 쓴다).
const ALLOW = new Set(opt("allow", "192.168.100.152").split(",").map((s) => s.trim()).filter(Boolean));

const ts = () => new Date().toLocaleString("ko-KR", { hour12: false });

/** ::ffff:192.168.0.1 같은 IPv4 매핑 주소를 벗겨낸다. */
const plainIp = (addr) => String(addr || "").replace(/^::ffff:/, "");

const server = http.createServer(async (req, res) => {
  const from = plainIp(req.socket.remoteAddress);
  const isLocal = from === "127.0.0.1" || from === "::1";
  if (!isLocal && !ALLOW.has(from)) {
    console.log(`[${ts()}] 거부 ${from} ${req.method} ${req.url}`);
    res.writeHead(403).end("not allowed");
    return;
  }

  // 요청 본문을 그대로 모아 넘긴다.
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

  try {
    const upstream = await fetch(`${TARGET}${req.url}`, {
      method: req.method,
      // host 헤더는 대상 주소에 맞게 다시 붙어야 하므로 빼고 넘긴다.
      headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => k !== "host" && k !== "connection")),
      body,
      redirect: "manual",
    });

    const headers = {};
    upstream.headers.forEach((v, k) => {
      if (k === "content-encoding" || k === "transfer-encoding" || k === "content-length") return;
      headers[k] = v;
    });
    // 로그인 응답의 Set-Cookie는 여러 줄일 수 있어 따로 챙긴다.
    const setCookie = upstream.headers.getSetCookie?.() || [];
    if (setCookie.length) headers["set-cookie"] = setCookie;

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, headers);
    res.end(buf);
  } catch (e) {
    console.log(`[${ts()}] 실패 ${req.method} ${req.url} — ${e.message}`);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `중계 실패: ${e.message}` }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[${ts()}] 중계 시작 · 0.0.0.0:${PORT} → ${TARGET}`);
  console.log(`[${ts()}] 허용 IP: ${[...ALLOW].join(", ")} (+ 루프백)`);
  console.log(`[${ts()}] 이 창을 닫으면 중계도 멈춥니다.`);
});
