# QR 안내 완료 후 물품 위치 찾기

픽업·반납 안내를 모두 마치면 '혹시 놓친 것이 있나요?'와 물품 이름 입력창을 표시한다.
물품 이름을 제출하면 시나리오 물품과 COS 물품의 보관 위치를 읽기 전용으로 안내한다.
이 검색은 실제 대여·반납이나 QR 동선의 완료 체크를 변경하지 않는다.

`GET <QR_LOOKUP_PATH>/item-locations?employeeId=...&q=...`:

- 등록된 활성 사번과 1~80자의 이름을 받는다. 빈 이름으로 전체 목록을 내리지 않는다.
- 대소문자·띄어쓰기·여러 단어를 비교하고 최대 20개를 반환한다. 보관 처리된 물품은 제외한다.
- 응답에는 물품 이름·종류·보관 위치·내부 사진 주소만 포함한다. 구매 정보, 관리자 정보, 다른 사람의 대여 기록은 포함하지 않는다.
- 현재 사번의 예약 물품이 기존 QR 종류 한도 정책 때문에 숨겨져 있으면 검색에서도 해당 위치를 숨긴다.
- 자동 QR 갱신은 완료 화면의 입력·포커스·검색 결과를 유지한다. 다른 사번을 조회한 뒤 도착한 이전 결과는 무시한다.

검증:

```powershell
node --test server/routes/lookupItemLocations.test.js server/routes/requestLookupNotice.test.js server/routes/myRentalLookup.test.js server/routes/reservationQrVisibility.test.js tools/qr-forgotten-items.test.mjs
```

23개 테스트 통과. 합성 데이터의 실제 브라우저에서 공통 안내 → 마지막 물품 → 완료 질문 → 이름 검색 → 위치 표시를 확인했다.
