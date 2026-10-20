# Shoot Planner 대여 표시

관리자 대여 확인·반납 처리 화면은 실제 신청 번호와 사번으로 Shoot Planner 계획을 연결한다.
대여자 이름 옆에는 컬렉션 이름을, 신청 묶음에는 현재 루틴 번호를 표시한다.
다음 루틴은 신청 전 미리보기로 옅게 표시하고 펼치면 새로 빌릴 물품·수량과 계속 사용할 수량을 볼 수 있다.
미리보기는 계획 기준이며 Collector가 신청하면서 선택하는 종류·여분은 달라질 수 있다.
미리보기는 대여 행, 재고, 장바구니, 확인·반납 처리에 포함하지 않는다.

WMS는 관리자 `getUnreturnedItems` 응답에만 `planner` 표시 정보를 붙인다. Shoot Planner의
`GET /api/wms/rental-context`를 기존 서버 간 `x-planner-key`로 조회한다. 키를 브라우저에 전달하지 않는다.
일반 대여와 예약 자동 전환 모두 지원한다. 플래너가 아직 예약의 신청 번호를 갱신하지 않았어도 예약 ID로 연결한다.
루틴 변경은 기존 화면 갱신 주기에 따라 반영하며 중복 조회 캐시는 5초다. 이미 신청·예약·시작·완료한 다음 루틴,
종료된 계획과 마지막 루틴은 미리보기를 표시하지 않는다. 취소된 대여는 다시 미리보기할 수 있다.

기본 플래너 주소는 같은 서버의 `http://127.0.0.1:3010`이다. 별도 서버에서는 WMS의
`SHOOT_PLANNER_URL`로 설정한다. 기존 `PLANNER_BRIDGE_KEY` 또는 `PLANNER_BRIDGE_KEY_FILE`을 사용한다.
조회 제한 시간은 1.5초이며 실패하면 실제 대여 목록만 반환한다. 실패 뒤 오래된 미리보기는 사용하지 않는다.
이 조회는 Data Operator나 QA Tool에 요청하지 않으며 신청·진행 데이터를 수정하지 않는다.

검증:

```powershell
node --test server/lib/plannerRentalContext.test.js server/routes/plannerBridge.test.js src/utils/plannerRentalDisplay.test.ts
npm run build
```

Shoot Planner 소스의 `test/wms-context*.test.cjs`는 컬렉션·루틴 변경·예약 연결 및 서버 키 인증을 검증한다.
스키마 변경은 없다. 배포 스크립트는 양쪽 서비스 코드와 WMS 빌드 자산을 백업하고,
실패 시 코드·자산을 이전 버전으로 되돌린다. 사용자 데이터와 인증 설정 파일은 교체하지 않는다.
