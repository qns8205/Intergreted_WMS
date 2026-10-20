# 배포 계획 삭제 (2026-10-19)

배포된 계획의 삭제 버튼은 `DELETE /api/plans/:id`를 호출해 `plans.status='deleted'`로 바꾼다.
삭제한 계획은 배포 목록·상세·내 계획·KPI·날짜별 집계에서 제외하고 PATCH로 재배포할 수 없다.
원본 컬렉션, plan_rentals, plan_progress와 실제 WMS 대여·예약은 지우거나 취소하지 않는다.

엑셀 컬렉션 삭제 시 연결된 계획도 삭제하는 옵션을 기본으로 표시한다.
`DELETE /api/upload-collections/:id?deletePlans=1`은 원본 삭제 표시와 연결 계획 삭제를 하나의
SQLite 트랜잭션으로 처리한다. 기존 클라이언트와 `deletePlans=0`은 원본만 삭제한다.
이미 14일 경과로 원본이 삭제된 경우에도 연결 계획을 정리할 수 있다. 자동 만료 정책은 원본에만 적용한다.

검증: Shoot Planner 테스트 44개 통과. 운영의 `Temp 261016` 컬렉션(id 1),
연결 계획(id 1·2)은 전체 DB 백업 후 정확한 이름·연결·ID 확인을 거쳐 삭제 상태로 전환한다.
