# WMS 접속 경로

**사내망 IP로만 접속한다: `http://192.168.100.152:3000/`**

미니 PC(`configds@192.168.100.152`)에서 `wms.service`(systemd)로 3000번 포트에 상시 떠 있고,
같은 사내망에 있으면 어느 층에서든 바로 열린다. ufw가 `192.168.0.0/16`과 `100.64.0.0/10`에서
3000/tcp를 허용한다.

## 외부 공개는 하지 않는다

예전에는 Tailscale Funnel(`https://configds.tailf2d168.ts.net`)로 사외에서도 열어뒀지만
2026-09-07에 완전히 접었다. 이유는 둘이다.

1. **전사 장애 이력** — 미니 PC가 *개인* 테일넷(`tailf2d168`)에 물려 있었는데, 회사 PC들은
   회사 테일넷(`tailb971f6`)의 Split DNS가 `ts.net.` 전체를 테일넷 리졸버로 보낸다.
   그 리졸버가 다른 테일넷 이름을 모르니 NXDOMAIN을 뱉었고, 회사 PC들이 깨진 IPv6로
   빠지면서 사내 전체가 멈췄다. (2026-08-26)
2. **공개 노출** — Funnel은 로그인 없이 열리는 페이지까지 인터넷에 그대로 드러낸다.

그래서 지금은 **사외 접속이 없다**(재택 필요 없음으로 합의). ngrok 백업 터널도 함께 정리했다.

## 정리한 것 (2026-09-07)

- `funnel-watchdog` 타이머/서비스 — Funnel 주소를 3분마다 두드리고 실패하면 `tailscaled`를
  재시작하던 스크립트. 로그아웃 상태에서 매번 실패해 계속 재시작을 반복하고 있었다.
- `tailscale serve` 설정 — 남겨두면 나중에 테일넷에 다시 로그인할 때 **새 이름으로 공개가
  되살아난다.** 그래서 로그인보다 먼저 지워야 한다.

## 나중에 테일넷을 다시 붙인다면

Scenario Manager 연동처럼 **서버에서 사내 다른 테일넷 서비스로 나가야 할 때**만 고려한다.
그때도 공개(Funnel/serve)는 켜지 않고, 나가는 연결만 쓴다.

```bash
sudo tailscale serve reset                                  # 남은 공개 설정부터 제거
sudo tailscale logout
sudo tailscale up --accept-dns=false --hostname=wms-server  # 반드시 회사 계정으로
```

`--accept-dns=false`가 중요하다. 이걸 빼면 서버의 DNS가 테일넷 리졸버로 바뀐다. 위 장애가
DNS 경로에서 났던 만큼 서버 DNS는 건드리지 않고, 필요한 상대는 `/etc/hosts`에 테일넷 IP로
직접 적는다(테일넷 IP는 노드마다 고정이다).
