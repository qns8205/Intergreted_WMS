# WMS 접속 경로

**사내망에서 HTTPS로 접속한다: `https://cos-management.duckdns.org/`**

2026-10-06부터 기존 `http://192.168.100.152:3000/` 주소는 위 HTTPS 주소로 연결한다.
기존 `https://cos-management.duckdns.org:3443/` 주소도 계속 지원한다.
QR 주소는 `https://cos-management.duckdns.org:3445/pickup/4e91c7b2a860`이며 기존 3002번
QR 주소도 새 주소로 연결한다. HTTPS 포트 443/3443/3445는 사내망 `192.168.0.0/16`만 허용한다.

## 기본 HTTPS 포트 (443)

- `deploy/wms.socket`을 systemd 시스템 소켓으로 활성화한다. `192.168.100.152:443`만 수신하고,
  `FreeBind=yes`로 부팅 시 주소 할당 전에도 소켓을 준비한다.
- systemd가 명명된 소켓(`wms-https`)을 `wms.service`의 Node 프로세스에 전달한다. 앱은 계속
  일반 사용자 `configds`로 실행되며 root 실행, Node 실행 파일 권한 변경, 프록시 신뢰 설정은 필요 없다.
- 443도 앱이 직접 TLS를 처리하며 같은 인증서 자동 갱신이 적용된다. 클라이언트 IP와 인증 제한은 유지한다.
- 최초 설치는 `deploy/activate-standard-https.sh`를 사용한다. 서버 파일을 백업한 후 `wms` 중지 →
  `wms.socket` 활성화 → `wms` 시작 순서로 적용한다. 서비스가 이미 실행 중이면 새 소켓 시작은 거부된다.
  기존 전체 허용 443 규칙 대신 `sudo ufw allow from 192.168.0.0/16 to any port 443 proto tcp`만 유지한다.
  적용 후 일반 배포 재시작은 기존처럼 `sudo systemctl restart wms`를 사용한다.
- 되돌리기: `sudo systemctl disable --now wms.socket`, 기본 접속 origin을 `:3443`으로 되돌린 뒤
  `sudo systemctl restart wms`. 기존 3443/3445 리스너와 데이터는 변경하지 않는다.

## HTTPS와 대여자 인증

- Duck DNS의 A 레코드는 내부 IP `192.168.100.152`, AAAA 레코드는 비워 둔다. 공유기 포트 전달은 필요 없다.
- 인증서는 Let's Encrypt DNS-01 방식으로 발급한다. 인증서 발급·갱신은 회사 Tailscale 설정과 독립적이다.
- 대여자는 사번·SM 비밀번호와 본인 좌석을 한 화면에서 입력한다. SM 인증 성공 시 선택한 좌석으로 로그인한다.
  비밀번호·SM 로그인 쿠키는 WMS에 저장하지 않는다.
- 비밀번호 입력 후 좌석 칸으로 이동하면 자동으로 로그인 정보를 확인한다. 성공한 뒤에만 개인 대여 이력의
  자주 사용하는 유닛을 최대 3개 표시한다. 추천 또는 직접 지정한 좌석으로 로그인 버튼을 한 번 누르면 된다.
  자동 확인 중 로그인 버튼을 눌러도 동일한 인증 요청을 공유하며, 사번 변경 시 기존 인증·추천을 폐기한다.
- WMS 로그인은 실제 TLS 연결만 허용하며, 세션 쿠키는 Secure/HttpOnly/SameSite=Strict이다.
- SM 자체 연결은 기존 사내 Tailscale 경로를 유지한다. SM 연결을 외부 인터넷에 공개하지 않는다.
- 토큰은 `/home/configds/.local/share/wms-tls/duckdns.token`에 소유자 전용 권한 600으로 보관한다.
  변경은 `bash /home/configds/wms/deploy/set-duckdns-token.sh`로 직접 입력한다. 토큰·비밀 로그를 채팅에 붙여넣지 않는다.
- `configds` crontab이 매일 서버 시각 03:15에 `/home/configds/wms/deploy/renew-https.sh`를 실행한다.
  기존 Duck DNS 작업은 그대로 유지한다. 인증서 갱신 후 WMS가 1분 이내 인증서를 다시 읽는다.
- 수동 갱신 확인: `bash /home/configds/wms/deploy/renew-https.sh` (sudo 불필요).
- 실패 로그는 `wms-tls/acme-renew.log`에 비공개로 저장한다. DNS 토큰이 포함될 수 있으므로 그대로 공유하지 않는다.
- 발급 도구는 공식 acme.sh 3.1.6 릴리스의 서명을 검증하여 설치했다. 자동 소프트웨어 업그레이드는 설정하지 않는다.

아래는 기존 HTTP 포트와 외부 공개 중단에 대한 이력이다.

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
